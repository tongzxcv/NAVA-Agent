import { readFile } from 'node:fs/promises';
import type { CommandRoomAgentRecord, CommandRoomTaskRecord } from '@lnwjud/domain';

export interface SupervisorCheckpoint {
  readonly id: string;
  readonly status?: 'WORKING' | 'DONE' | 'WAITING' | 'BLOCKED' | 'FAILED';
  readonly nextAction?: string;
  readonly safeToContinue?: boolean;
  readonly needsUser?: boolean;
  readonly blockers?: readonly string[];
}

export type SupervisorDecision =
  | { readonly action: 'WAIT'; readonly reason: string }
  | { readonly action: 'IDLE'; readonly reason: string }
  | { readonly action: 'CONTINUE'; readonly nextAction: string; readonly checkpointId: string }
  | { readonly action: 'ALERT'; readonly reason: string; readonly checkpointId?: string };

export function decideCommandRoomSupervisor(
  agent: CommandRoomAgentRecord,
  task: CommandRoomTaskRecord,
  checkpoint: SupervisorCheckpoint | null,
): SupervisorDecision {
  if (agent.state === 'WORKING') return { action: 'WAIT', reason: 'LEAD_WORKING' };
  if (['QUEUED', 'CLAIMED', 'RUNNING', 'REVIEW'].includes(task.state)) {
    return { action: 'WAIT', reason: 'TASK_ACTIVE' };
  }
  if (task.state === 'WAITING') {
    return { action: 'ALERT', reason: 'TASK_WAITING', ...(checkpoint === null ? {} : { checkpointId: checkpoint.id }) };
  }
  if (task.state === 'FAILED') {
    return { action: 'ALERT', reason: 'TASK_FAILED', ...(checkpoint === null ? {} : { checkpointId: checkpoint.id }) };
  }
  if (task.state !== 'COMPLETED') return { action: 'IDLE', reason: 'TASK_TERMINAL_NO_CONTINUATION' };
  if (checkpoint === null) return { action: 'IDLE', reason: 'NO_CHECKPOINT' };
  if (checkpoint.needsUser === true || checkpoint.status === 'WAITING' || checkpoint.status === 'BLOCKED' || checkpoint.status === 'FAILED') {
    return { action: 'ALERT', reason: checkpoint.needsUser === true ? 'NEEDS_USER' : `CHECKPOINT_${checkpoint.status}`, checkpointId: checkpoint.id };
  }
  const nextAction = typeof checkpoint.nextAction === 'string' ? checkpoint.nextAction.trim() : '';
  if (checkpoint.status === 'DONE' && checkpoint.safeToContinue === true && nextAction.length > 0 && (checkpoint.blockers?.length ?? 0) === 0) {
    return { action: 'CONTINUE', nextAction, checkpointId: checkpoint.id };
  }
  return { action: 'IDLE', reason: 'NOT_SAFE_TO_CONTINUE' };
}

export async function readSupervisorCheckpoints(path: string): Promise<ReadonlyMap<string, SupervisorCheckpoint>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { checkpoints?: unknown }).checkpoints)) return new Map();
    const result = new Map<string, SupervisorCheckpoint>();
    for (const value of (parsed as { checkpoints: unknown[] }).checkpoints) {
      if (typeof value !== 'object' || value === null) continue;
      const record = value as Record<string, unknown>;
      if (typeof record.id !== 'string') continue;
      const status = typeof record.status === 'string' && ['WORKING', 'DONE', 'WAITING', 'BLOCKED', 'FAILED'].includes(record.status)
        ? record.status as Exclude<SupervisorCheckpoint['status'], undefined>
        : undefined;
      const checkpoint: SupervisorCheckpoint = {
        id: record.id,
        ...(status === undefined ? {} : { status }),
        ...(typeof record.nextAction === 'string' ? { nextAction: record.nextAction } : {}),
        ...(typeof record.safeToContinue === 'boolean' ? { safeToContinue: record.safeToContinue } : {}),
        ...(typeof record.needsUser === 'boolean' ? { needsUser: record.needsUser } : {}),
        ...(Array.isArray(record.blockers) && record.blockers.every((entry) => typeof entry === 'string')
          ? { blockers: record.blockers as string[] } : {}),
      };
      result.set(checkpoint.id, checkpoint);
    }
    return result;
  } catch {
    return new Map();
  }
}
