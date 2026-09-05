import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CommandRoomAgentRecord,
  CommandRoomBindingRecord,
  CommandRoomSupervisorStateRecord,
  CommandRoomTaskRecord,
} from '@lnwjud/domain';
import {
  decideCommandRoomSupervisor,
  decideDedicatedSupervisorState,
  isDedicatedSupervisorStateValid,
  readSupervisorCheckpoints,
  resolveLatestSupervisorCheckpoint,
  shouldUseLegacySupervisorFallback,
} from '../src/main/command-room-supervisor.js';

function agent(state: CommandRoomAgentRecord['state']): CommandRoomAgentRecord {
  return {
    id: 'lead-1', roomId: 'room-1', slotKey: 'LEAD-1', role: 'LEAD', provider: 'CHATGPT',
    state, projectKey: 'beelzebub', workspaceId: 'workspace-beelzebub',
    connectionEpoch: 1, capabilities: [], createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function task(state: CommandRoomTaskRecord['state'], checkpointId = 'checkpoint-1'): CommandRoomTaskRecord {
  return {
    id: 'task-1', roomId: 'room-1', projectKey: 'RATCHET', title: 'Continue verified work',
    brief: { summary: 'bounded work', acceptanceCriteria: [], evidenceRefs: [] },
    mutationMode: 'READ_ONLY', state, priority: 0, assignedAgentId: 'lead-1', createdByAgentId: 'main',
    ...(checkpointId.length === 0 ? {} : { checkpointId }),
    version: 4, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function binding(overrides: Partial<CommandRoomBindingRecord> = {}): CommandRoomBindingRecord {
  return {
    id: 'binding-1', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
    extensionInstallationId: 'extension-installation-1',
    encryptedConversationRef: 'ciphertext',
    conversationRefFingerprint: 'fingerprint-1',
    connectionEpoch: 1, state: 'PAIRED',
    pairedAt: '2026-09-05T00:00:00.000Z', lastSeenAt: '2026-09-05T00:00:00.000Z',
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function dedicated(overrides: Partial<CommandRoomSupervisorStateRecord> = {}): CommandRoomSupervisorStateRecord {
  return {
    roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1',
    projectKey: 'beelzebub', workspaceId: 'workspace-beelzebub',
    connectionEpoch: 1, bindingId: 'binding-1', bindingFingerprint: 'fingerprint-1',
    status: 'DONE', nextAction: 'Continue verified work', safeToContinue: true, needsUser: false,
    checkpointId: 'checkpoint-1', durableTaskIds: [], supervisorSync: 'OK',
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('Command Room MAIN supervisor policy', () => {
  it('does nothing while the LEAD or task is still active', () => {
    const checkpoint = { id: 'checkpoint-1', status: 'DONE' as const, safeToContinue: true, nextAction: 'Continue' };
    expect(decideCommandRoomSupervisor(agent('WORKING'), task('COMPLETED'), checkpoint)).toEqual({ action: 'WAIT', reason: 'LEAD_WORKING' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('RUNNING'), checkpoint)).toEqual({ action: 'WAIT', reason: 'TASK_ACTIVE' });
  });

  it('continues only a completed legacy task whose checkpoint explicitly permits the bounded next action', () => {
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'DONE', safeToContinue: true, needsUser: false, blockers: [], nextAction: 'Run the next verified matrix',
    })).toEqual({
      action: 'CONTINUE', checkpointId: 'checkpoint-1', nextAction: 'Run the next verified matrix',
    });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'DONE', safeToContinue: false, nextAction: 'Do not infer this',
    })).toEqual({ action: 'IDLE', reason: 'NOT_SAFE_TO_CONTINUE' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), null)).toEqual({ action: 'IDLE', reason: 'NO_CHECKPOINT' });
  });

  it('uses dedicated state without requiring legacy queued task/checkpoint linkage', () => {
    const legacyQueued = task('QUEUED', '');
    expect(legacyQueued.state).toBe('QUEUED');
    expect(legacyQueued.checkpointId).toBeUndefined();

    expect(decideDedicatedSupervisorState(dedicated())).toEqual({
      action: 'CONTINUE', checkpointId: 'checkpoint-1', nextAction: 'Continue verified work',
    });
    expect(decideDedicatedSupervisorState(dedicated({ status: 'WORKING', safeToContinue: false, nextAction: undefined })))
      .toEqual({ action: 'WAIT', reason: 'LEAD_WORKING' });
    expect(decideDedicatedSupervisorState(dedicated({ status: 'WAITING', safeToContinue: false, needsUser: false })))
      .toEqual({ action: 'ALERT', reason: 'SUPERVISOR_STATE_WAITING', checkpointId: 'checkpoint-1' });
    expect(decideDedicatedSupervisorState(dedicated({ status: 'BLOCKED', safeToContinue: false })))
      .toEqual({ action: 'ALERT', reason: 'SUPERVISOR_STATE_BLOCKED', checkpointId: 'checkpoint-1' });
    expect(decideDedicatedSupervisorState(dedicated({ status: 'FAILED', safeToContinue: false })))
      .toEqual({ action: 'ALERT', reason: 'SUPERVISOR_STATE_FAILED', checkpointId: 'checkpoint-1' });
  });

  it('uses legacy task fallback only when no active browser binding and no dedicated state exist', () => {
    expect(shouldUseLegacySupervisorFallback({ latestBinding: null, dedicatedState: undefined })).toBe(true);
    expect(shouldUseLegacySupervisorFallback({ latestBinding: binding(), dedicatedState: undefined })).toBe(false);
    expect(shouldUseLegacySupervisorFallback({
      latestBinding: binding({ state: 'REVOKED', revokedAt: '2026-09-05T00:01:00.000Z' }),
      dedicatedState: undefined,
    })).toBe(false);
    expect(shouldUseLegacySupervisorFallback({ latestBinding: null, dedicatedState: dedicated() })).toBe(false);
  });

  it('suppresses auto-continuation while sync is degraded/failed or the checkpoint was already handled', () => {
    expect(decideDedicatedSupervisorState(dedicated({ supervisorSync: 'DEGRADED' })))
      .toEqual({ action: 'IDLE', reason: 'SUPERVISOR_SYNC_DEGRADED' });
    expect(decideDedicatedSupervisorState(dedicated({ supervisorSync: 'FAILED' })))
      .toEqual({ action: 'IDLE', reason: 'SUPERVISOR_SYNC_FAILED' });
    expect(decideDedicatedSupervisorState(dedicated({ lastHandledCheckpointId: 'checkpoint-1', lastHandledAction: 'CONTINUE' })))
      .toEqual({ action: 'IDLE', reason: 'CHECKPOINT_ALREADY_HANDLED' });
    expect(decideDedicatedSupervisorState(dedicated({ nextAction: undefined, safeToContinue: false })))
      .toEqual({ action: 'IDLE', reason: 'NO_NEXT_ACTION' });
  });

  it('validates active binding identity/fingerprint/epoch and freshness before MAIN can use dedicated state', () => {
    expect(isDedicatedSupervisorStateValid({
      agent: agent('ONLINE'), binding: binding(), state: dedicated(), now: '2026-09-05T00:04:00.000Z',
    })).toBe(true);
    expect(isDedicatedSupervisorStateValid({
      agent: agent('ONLINE'), binding: binding({ state: 'REPLACED', replacedAt: '2026-09-05T00:01:00.000Z' }),
      state: dedicated(), now: '2026-09-05T00:04:00.000Z',
    })).toBe(false);
    expect(isDedicatedSupervisorStateValid({
      agent: agent('ONLINE'), binding: binding(), state: dedicated({ bindingFingerprint: 'wrong' }), now: '2026-09-05T00:04:00.000Z',
    })).toBe(false);
    expect(isDedicatedSupervisorStateValid({
      agent: agent('ONLINE'), binding: binding(), state: dedicated({ connectionEpoch: 2 }), now: '2026-09-05T00:04:00.000Z',
    })).toBe(false);
    expect(isDedicatedSupervisorStateValid({
      agent: agent('ONLINE'), binding: binding(), state: dedicated(), now: '2026-09-05T00:06:00.001Z',
    })).toBe(false);
  });

  it('alerts instead of blindly continuing WAITING, FAILED, BLOCKED, or user-decision legacy work', () => {
    expect(decideCommandRoomSupervisor(agent('WAITING'), task('WAITING'), null)).toEqual({ action: 'ALERT', reason: 'TASK_WAITING' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('FAILED'), null)).toEqual({ action: 'ALERT', reason: 'TASK_FAILED' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'BLOCKED', safeToContinue: false,
    })).toEqual({ action: 'ALERT', reason: 'CHECKPOINT_BLOCKED', checkpointId: 'checkpoint-1' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'DONE', safeToContinue: false, needsUser: true, nextAction: 'Wait for answer',
    })).toEqual({ action: 'ALERT', reason: 'NEEDS_USER', checkpointId: 'checkpoint-1' });
  });

  it('reads only bounded machine-readable checkpoint fields and validates project/workspace ownership', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-supervisor-'));
    const file = path.join(root, 'continuity.json');
    await writeFile(file, JSON.stringify({
      checkpoints: [
        {
          id: 'wrong-workspace', createdAt: '2026-09-05T00:00:00.000Z',
          projectKey: 'beelzebub-ea-lab', workspaceId: 'workspace-other',
          status: 'DONE', safeToContinue: true, needsUser: false, nextAction: 'Never use',
        },
        {
          id: 'checkpoint-1', createdAt: '2026-09-05T00:01:00.000Z',
          projectKey: 'beelzebub-ea-lab', workspaceId: 'workspace-beelzebub',
          status: 'DONE', safeToContinue: true, needsUser: false,
          nextAction: 'Continue safely', blockers: [], durableTaskIds: ['durable-1'],
          rawPrompt: 'must-not-be-surfaced',
        },
      ],
    }));
    const checkpoints = await readSupervisorCheckpoints(file);
    expect(JSON.stringify(checkpoints.get('checkpoint-1'))).not.toContain('rawPrompt');

    expect(await resolveLatestSupervisorCheckpoint(file, {
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      acceptedProjectKeys: ['BEELZEBUB EA Lab'],
    })).toEqual({
      id: 'checkpoint-1',
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      status: 'DONE',
      nextAction: 'Continue safely',
      safeToContinue: true,
      needsUser: false,
      durableTaskIds: ['durable-1'],
    });
    expect(await resolveLatestSupervisorCheckpoint(file, {
      projectKey: 'ratchet',
      workspaceId: 'workspace-beelzebub',
      acceptedProjectKeys: ['RATCHET EA Lab'],
    })).toBeNull();

    await writeFile(file, JSON.stringify({
      checkpoints: [
        {
          id: 'structured-old', createdAt: '2026-09-05T00:01:00.000Z',
          projectKey: 'beelzebub-ea-lab', workspaceId: 'workspace-beelzebub',
          status: 'DONE', safeToContinue: true, needsUser: false, nextAction: 'Must not revive',
        },
        {
          id: 'automatic-newer', createdAt: '2026-09-05T00:02:00.000Z',
          projectKey: 'beelzebub-ea-lab', workspaceId: 'workspace-beelzebub',
          nextAction: 'Review automatic tool result',
        },
      ],
    }));
    expect(await resolveLatestSupervisorCheckpoint(file, {
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      acceptedProjectKeys: ['BEELZEBUB EA Lab'],
    })).toBeNull();
  });
});
