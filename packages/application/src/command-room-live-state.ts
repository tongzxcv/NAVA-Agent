import type { CommandRoomAgentRecord, CommandRoomAgentState, CommandRoomTaskRecord } from '@lnwjud/domain';

/**
 * Manual ChatGPT/Codex sessions are considered stale when no heartbeat has
 * been observed for this bounded window. Keep the value deterministic so
 * Desktop, MCP status, and resume authority render the same truth.
 */
export const COMMAND_ROOM_HEARTBEAT_STALE_AFTER_MS = 15 * 60 * 1_000;

export interface CommandRoomAgentLiveStateInput {
  readonly agent: CommandRoomAgentRecord;
  readonly task?: CommandRoomTaskRecord | undefined;
  /** Required only for a RUNNING WRITE task. Undefined means lease truth is not observable. */
  readonly writerLeaseOwned?: boolean | undefined;
  readonly now?: Date | undefined;
  readonly staleAfterMs?: number | undefined;
}

export interface CommandRoomAgentLiveStateProjection {
  readonly state: CommandRoomAgentState;
  readonly stale: boolean;
  readonly lastActivityAt: string;
}

/** Pure read-time projection; never mutates persisted Command Room state. */
export function deriveCommandRoomAgentLiveState(input: CommandRoomAgentLiveStateInput): CommandRoomAgentLiveStateProjection {
  const { agent, task } = input;
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? COMMAND_ROOM_HEARTBEAT_STALE_AFTER_MS;
  const lastActivityAt = latestTimestamp(agent.updatedAt, agent.lastHeartbeatAt, task?.updatedAt);

  if (agent.state === 'SLEEPING') return { state: 'SLEEPING', stale: false, lastActivityAt };
  if (agent.state === 'OFFLINE') return { state: 'OFFLINE', stale: false, lastActivityAt };
  if (agent.sessionHash === undefined) return { state: 'AVAILABLE', stale: false, lastActivityAt };
  if (agent.lastHeartbeatAt === undefined) return { state: 'AVAILABLE', stale: false, lastActivityAt };

  const heartbeatMs = Date.parse(agent.lastHeartbeatAt);
  const stale = !Number.isFinite(heartbeatMs) || Math.max(0, now.getTime() - heartbeatMs) > staleAfterMs;
  if (stale) return { state: 'OFFLINE', stale: true, lastActivityAt };

  if (agent.currentTaskId === undefined) return { state: 'ONLINE', stale: false, lastActivityAt };
  if (task === undefined || task.id !== agent.currentTaskId) return { state: 'WAITING', stale: false, lastActivityAt };
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.state)) return { state: 'ONLINE', stale: false, lastActivityAt };
  if (task.state !== 'RUNNING') return { state: 'WAITING', stale: false, lastActivityAt };
  if (task.mutationMode === 'WRITE' && input.writerLeaseOwned === false) return { state: 'WAITING', stale: false, lastActivityAt };
  return { state: 'WORKING', stale: false, lastActivityAt };
}

function latestTimestamp(...values: readonly (string | undefined)[]): string {
  let latestValue = values.find((value): value is string => value !== undefined) ?? new Date(0).toISOString();
  let latestMs = Date.parse(latestValue);
  for (const value of values) {
    if (value === undefined) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && (!Number.isFinite(latestMs) || timestamp > latestMs)) {
      latestValue = value;
      latestMs = timestamp;
    }
  }
  return latestValue;
}
