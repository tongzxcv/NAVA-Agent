import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandRoomAgentRecord, CommandRoomTaskRecord } from '@lnwjud/domain';
import { decideCommandRoomSupervisor, readSupervisorCheckpoints } from '../src/main/command-room-supervisor.js';

function agent(state: CommandRoomAgentRecord['state']): CommandRoomAgentRecord {
  return {
    id: 'lead-1', roomId: 'room-1', slotKey: 'LEAD-1', role: 'LEAD', provider: 'CHATGPT',
    state, connectionEpoch: 1, capabilities: [], createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function task(state: CommandRoomTaskRecord['state'], checkpointId = 'checkpoint-1'): CommandRoomTaskRecord {
  return {
    id: 'task-1', roomId: 'room-1', projectKey: 'RATCHET', title: 'Continue verified work',
    brief: { summary: 'bounded work', acceptanceCriteria: [], evidenceRefs: [] },
    mutationMode: 'READ_ONLY', state, priority: 0, assignedAgentId: 'lead-1', createdByAgentId: 'main',
    checkpointId, version: 4, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

describe('Command Room MAIN supervisor policy', () => {
  it('does nothing while the LEAD or task is still active', () => {
    const checkpoint = { id: 'checkpoint-1', status: 'DONE' as const, safeToContinue: true, nextAction: 'Continue' };
    expect(decideCommandRoomSupervisor(agent('WORKING'), task('COMPLETED'), checkpoint)).toEqual({ action: 'WAIT', reason: 'LEAD_WORKING' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('RUNNING'), checkpoint)).toEqual({ action: 'WAIT', reason: 'TASK_ACTIVE' });
  });

  it('continues only a completed task whose checkpoint explicitly permits the bounded next action', () => {
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

  it('alerts instead of blindly continuing WAITING, FAILED, BLOCKED, or user-decision work', () => {
    expect(decideCommandRoomSupervisor(agent('WAITING'), task('WAITING'), null)).toEqual({ action: 'ALERT', reason: 'TASK_WAITING' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('FAILED'), null)).toEqual({ action: 'ALERT', reason: 'TASK_FAILED' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'BLOCKED', safeToContinue: false,
    })).toEqual({ action: 'ALERT', reason: 'CHECKPOINT_BLOCKED', checkpointId: 'checkpoint-1' });
    expect(decideCommandRoomSupervisor(agent('ONLINE'), task('COMPLETED'), {
      id: 'checkpoint-1', status: 'DONE', safeToContinue: false, needsUser: true, nextAction: 'Wait for answer',
    })).toEqual({ action: 'ALERT', reason: 'NEEDS_USER', checkpointId: 'checkpoint-1' });
  });

  it('reads only bounded machine-readable checkpoint fields from continuity state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-supervisor-'));
    const file = path.join(root, 'continuity.json');
    await writeFile(file, JSON.stringify({
      checkpoints: [{
        id: 'checkpoint-1', status: 'DONE', safeToContinue: true, needsUser: false,
        nextAction: 'Continue safely', blockers: [], rawPrompt: 'must-not-be-surfaced',
      }],
    }));
    const checkpoints = await readSupervisorCheckpoints(file);
    expect(checkpoints.get('checkpoint-1')).toEqual({
      id: 'checkpoint-1', status: 'DONE', safeToContinue: true, needsUser: false, nextAction: 'Continue safely', blockers: [],
    });
    expect(JSON.stringify(checkpoints.get('checkpoint-1'))).not.toContain('rawPrompt');
  });
});
