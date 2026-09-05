import type {
  CommandRoomAgentRecord,
  CommandRoomBindingRecord,
  CommandRoomSupervisorStateRecord,
  CommandRoomTaskRecord,
} from '@lnwjud/domain';
import { readFile } from 'node:fs/promises';

export const SUPERVISOR_STATE_FRESH_MS = 5 * 60 * 1_000;

export interface SupervisorCheckpoint {
  readonly id: string;
  readonly createdAt?: string;
  readonly projectKey?: string;
  readonly workspaceId?: string;
  readonly status?: 'WORKING' | 'DONE' | 'WAITING' | 'BLOCKED' | 'FAILED';
  readonly nextAction?: string;
  readonly safeToContinue?: boolean;
  readonly needsUser?: boolean;
  readonly blockers?: readonly string[];
  readonly durableTaskIds?: readonly string[];
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

export function shouldUseLegacySupervisorFallback(input: {
  readonly latestBinding: CommandRoomBindingRecord | null;
  readonly dedicatedState: CommandRoomSupervisorStateRecord | undefined;
}): boolean {
  return input.latestBinding === null && input.dedicatedState === undefined;
}

export function decideDedicatedSupervisorState(state: CommandRoomSupervisorStateRecord): SupervisorDecision {
  if (state.supervisorSync !== 'OK') return { action: 'IDLE', reason: `SUPERVISOR_SYNC_${state.supervisorSync}` };
  if (state.lastHandledCheckpointId === state.checkpointId) return { action: 'IDLE', reason: 'CHECKPOINT_ALREADY_HANDLED' };
  if (state.status === 'WORKING') return { action: 'WAIT', reason: 'LEAD_WORKING' };
  if (state.needsUser || state.status === 'WAITING' || state.status === 'BLOCKED' || state.status === 'FAILED') {
    return {
      action: 'ALERT',
      reason: state.needsUser ? 'NEEDS_USER' : `SUPERVISOR_STATE_${state.status}`,
      checkpointId: state.checkpointId,
    };
  }
  const nextAction = state.nextAction?.trim() ?? '';
  if (state.status === 'DONE' && state.safeToContinue && nextAction.length > 0) {
    return { action: 'CONTINUE', nextAction, checkpointId: state.checkpointId };
  }
  return { action: 'IDLE', reason: nextAction.length === 0 ? 'NO_NEXT_ACTION' : 'NOT_SAFE_TO_CONTINUE' };
}

export function isDedicatedSupervisorStateValid(input: {
  readonly agent: CommandRoomAgentRecord;
  readonly binding: CommandRoomBindingRecord | null;
  readonly state: CommandRoomSupervisorStateRecord;
  readonly now: string;
  readonly freshMs?: number;
}): boolean {
  const { agent, binding, state } = input;
  if (binding === null || binding.state !== 'PAIRED') return false;
  if (
    state.roomId !== agent.roomId
    || state.agentId !== agent.id
    || state.slotKey !== agent.slotKey
    || state.projectKey !== agent.projectKey
    || state.workspaceId !== agent.workspaceId
    || state.connectionEpoch !== agent.connectionEpoch
    || state.bindingId !== binding.id
    || state.bindingFingerprint !== binding.conversationRefFingerprint
    || binding.connectionEpoch !== agent.connectionEpoch
  ) return false;
  const updated = Date.parse(state.updatedAt);
  const current = Date.parse(input.now);
  if (!Number.isFinite(updated) || !Number.isFinite(current) || updated > current + 5_000) return false;
  return current - updated <= (input.freshMs ?? SUPERVISOR_STATE_FRESH_MS);
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
        ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
        ...(typeof record.projectKey === 'string' ? { projectKey: record.projectKey } : {}),
        ...(typeof record.workspaceId === 'string' ? { workspaceId: record.workspaceId } : {}),
        ...(status === undefined ? {} : { status }),
        ...(typeof record.nextAction === 'string' ? { nextAction: record.nextAction } : {}),
        ...(typeof record.safeToContinue === 'boolean' ? { safeToContinue: record.safeToContinue } : {}),
        ...(typeof record.needsUser === 'boolean' ? { needsUser: record.needsUser } : {}),
        ...(Array.isArray(record.blockers) && record.blockers.every((entry) => typeof entry === 'string')
          ? { blockers: record.blockers as string[] } : {}),
        ...(Array.isArray(record.durableTaskIds) && record.durableTaskIds.every((entry) => typeof entry === 'string')
          ? { durableTaskIds: record.durableTaskIds as string[] } : {}),
      };
      result.set(checkpoint.id, checkpoint);
    }
    return result;
  } catch {
    return new Map();
  }
}

export async function resolveLatestSupervisorCheckpoint(path: string, input: {
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly acceptedProjectKeys?: readonly string[];
}): Promise<{
  readonly id: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly status: CommandRoomSupervisorStateRecord['status'];
  readonly nextAction?: string;
  readonly safeToContinue: boolean;
  readonly needsUser: boolean;
  readonly durableTaskIds: readonly string[];
} | null> {
  const checkpoints = await readSupervisorCheckpoints(path);
  const accepted = new Set([input.projectKey, ...(input.acceptedProjectKeys ?? [])].map(canonicalProjectKey));
  const candidates = [...checkpoints.values()]
    .filter((checkpoint) => checkpoint.workspaceId === input.workspaceId)
    .filter((checkpoint) => checkpoint.projectKey !== undefined && accepted.has(canonicalProjectKey(checkpoint.projectKey)))
    .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
  const checkpoint = candidates.at(-1);
  if (checkpoint === undefined || checkpoint.status === undefined) return null;
  return {
    id: checkpoint.id,
    projectKey: input.projectKey,
    workspaceId: input.workspaceId,
    status: checkpoint.status,
    ...(checkpoint.nextAction === undefined ? {} : { nextAction: checkpoint.nextAction }),
    safeToContinue: checkpoint.safeToContinue === true,
    needsUser: checkpoint.needsUser === true,
    durableTaskIds: checkpoint.durableTaskIds ?? [],
  };
}

function canonicalProjectKey(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length === 0 ? 'global' : normalized;
}
