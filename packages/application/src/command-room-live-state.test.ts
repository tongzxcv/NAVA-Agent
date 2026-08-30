import { describe, expect, it } from 'vitest';
import type { CommandRoomAgentRecord, CommandRoomTaskRecord } from '@lnwjud/domain';
import { COMMAND_ROOM_HEARTBEAT_STALE_AFTER_MS, deriveCommandRoomAgentLiveState } from './command-room-live-state.js';

const NOW = new Date('2026-08-30T13:30:00.000Z');

function agent(overrides: Partial<CommandRoomAgentRecord> = {}): CommandRoomAgentRecord {
  return {
    id: 'agent-1', roomId: 'room-1', slotKey: 'LEAD-4', role: 'LEAD', provider: 'CHATGPT',
    state: 'ONLINE', connectionEpoch: 1, capabilities: [], sessionHash: 'session-hash',
    lastHeartbeatAt: '2026-08-30T13:29:00.000Z', createdAt: '2026-08-30T13:00:00.000Z', updatedAt: '2026-08-30T13:29:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<CommandRoomTaskRecord> = {}): CommandRoomTaskRecord {
  return {
    id: 'task-1', roomId: 'room-1', projectKey: 'hermes', title: 'Forward validation',
    brief: { summary: 'Validate', acceptanceCriteria: [], evidenceRefs: [] }, mutationMode: 'READ_ONLY',
    state: 'RUNNING', priority: 0, assignedAgentId: 'agent-1', createdByAgentId: 'main-1', version: 1,
    createdAt: '2026-08-30T13:10:00.000Z', updatedAt: '2026-08-30T13:28:00.000Z',
    ...overrides,
  };
}

describe('Command Room live-state projection', () => {
  it('keeps never-joined slots AVAILABLE and parked sessions SLEEPING', () => {
    expect(deriveCommandRoomAgentLiveState({ agent: agent({ state: 'AVAILABLE', connectionEpoch: 0, sessionHash: undefined, lastHeartbeatAt: undefined }), now: NOW }).state).toBe('AVAILABLE');
    expect(deriveCommandRoomAgentLiveState({ agent: agent({ state: 'SLEEPING' }), now: NOW }).state).toBe('SLEEPING');
  });

  it('marks a joined session OFFLINE after the deterministic heartbeat threshold', () => {
    const lastHeartbeatAt = new Date(NOW.getTime() - COMMAND_ROOM_HEARTBEAT_STALE_AFTER_MS - 1).toISOString();
    expect(deriveCommandRoomAgentLiveState({ agent: agent({ lastHeartbeatAt }), now: NOW })).toMatchObject({ state: 'OFFLINE', stale: true });
  });

  it('uses task and writer-lease truth for WORKING versus WAITING', () => {
    const active = agent({ currentTaskId: 'task-1' });
    expect(deriveCommandRoomAgentLiveState({ agent: active, task: task(), now: NOW }).state).toBe('WORKING');
    expect(deriveCommandRoomAgentLiveState({ agent: active, task: task({ mutationMode: 'WRITE', workspaceId: 'ws-hermes' }), writerLeaseOwned: false, now: NOW }).state).toBe('WAITING');
    expect(deriveCommandRoomAgentLiveState({ agent: active, task: task({ mutationMode: 'WRITE', workspaceId: 'ws-hermes' }), writerLeaseOwned: true, now: NOW }).state).toBe('WORKING');
    expect(deriveCommandRoomAgentLiveState({ agent: active, task: task({ state: 'REVIEW' }), now: NOW }).state).toBe('WAITING');
  });

  it('reports last activity from the newest heartbeat, agent mutation, or task mutation', () => {
    expect(deriveCommandRoomAgentLiveState({
      agent: agent({ updatedAt: '2026-08-30T13:20:00.000Z' }),
      task: task({ updatedAt: '2026-08-30T13:29:30.000Z' }),
      now: NOW,
    }).lastActivityAt).toBe('2026-08-30T13:29:30.000Z');
  });
});
