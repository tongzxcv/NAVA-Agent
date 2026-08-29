import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRoomBroker, type CommandRoomTaskResponse } from '@lnwjud/application';
import type { Result } from '@lnwjud/domain';
import {
  SqliteCommandRoomRepository,
  SqliteCommandRoomResourceRepository,
  SqliteDatabase,
  SqliteWorkspaceLeaseRepository,
} from '@lnwjud/storage';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Command Room Phase 2B', () => {
  it('blocks same-workspace writers, permits different workspaces, queues resources, and recovers after reopen', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-phase2b-'));
    temporaryRoots.push(root);
    const filename = path.join(root, 'state.db');
    let now = new Date('2026-08-29T02:00:00.000Z');

    let database = new SqliteDatabase(filename);
    seedWorkspace(database, 'workspace-a', path.join(root, 'workspace-a'));
    seedWorkspace(database, 'workspace-b', path.join(root, 'workspace-b'));
    let broker = createBroker(database, () => now);

    const created = value(await broker.admin({ action: 'create', name: 'Phase 2B Room', idempotencyKey: 'phase2b-room', leadSlots: 3 }));
    const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead1 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead2 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-2', joinCode: created.joinCodes['LEAD-2'], provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead3 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-3', joinCode: created.joinCodes['LEAD-3'], provider: 'CODEX', connectionEpoch: 1 }));

    const missingWorkspace = await broker.task({
      action: 'assign',
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      assignedSlotKey: 'LEAD-1',
      projectKey: 'missing',
      workspaceId: 'workspace-missing',
      title: 'missing',
      brief: { summary: 'missing', acceptanceCriteria: ['registered workspace only'], evidenceRefs: [] },
      mutationMode: 'WRITE',
      expectedVersion: lead3.roomVersion,
      idempotencyKey: 'missing-workspace-assign',
    });
    expect(missingWorkspace).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_FOUND' } });

    const first = await assignWrite(broker, created.room.id, main.agentSessionId, 'LEAD-1', 'workspace-a', lead3.roomVersion, 'first');
    const firstClaimed = value(await broker.task({ action: 'claim', roomId: created.room.id, agentSessionId: lead1.agentSessionId, taskId: first.task.id, expectedVersion: 1, idempotencyKey: 'first-claim' }));
    const firstStarted = value(await broker.task({ action: 'start', roomId: created.room.id, agentSessionId: lead1.agentSessionId, taskId: first.task.id, expectedVersion: firstClaimed.task.version, idempotencyKey: 'first-start' }));
    expect(firstStarted).toMatchObject({ task: { state: 'RUNNING' }, workspaceLease: { workspaceId: 'workspace-a', owner: expect.stringContaining('LEAD-1') } });

    const collision = await assignWrite(broker, created.room.id, main.agentSessionId, 'LEAD-2', 'workspace-a', firstStarted.roomVersion, 'collision');
    const collisionClaimed = value(await broker.task({ action: 'claim', roomId: created.room.id, agentSessionId: lead2.agentSessionId, taskId: collision.task.id, expectedVersion: 1, idempotencyKey: 'collision-claim' }));
    const collisionStarted = value(await broker.task({ action: 'start', roomId: created.room.id, agentSessionId: lead2.agentSessionId, taskId: collision.task.id, expectedVersion: collisionClaimed.task.version, idempotencyKey: 'collision-start' }));
    expect(collisionStarted).toMatchObject({
      task: { state: 'WAITING' },
      leaseConflict: { workspaceId: 'workspace-a', retryable: true, message: expect.stringContaining('leased by') },
    });

    const second = await assignWrite(broker, created.room.id, main.agentSessionId, 'LEAD-3', 'workspace-b', collisionStarted.roomVersion, 'second');
    const secondClaimed = value(await broker.task({ action: 'claim', roomId: created.room.id, agentSessionId: lead3.agentSessionId, taskId: second.task.id, expectedVersion: 1, idempotencyKey: 'second-claim' }));
    const secondStarted = value(await broker.task({ action: 'start', roomId: created.room.id, agentSessionId: lead3.agentSessionId, taskId: second.task.id, expectedVersion: secondClaimed.task.version, idempotencyKey: 'second-start' }));
    expect(secondStarted).toMatchObject({ task: { state: 'RUNNING' }, workspaceLease: { workspaceId: 'workspace-b' } });

    const firstResource = value(await broker.resource({
      action: 'request',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: first.task.id,
      resourceKey: 'mt5-terminal-1',
      idempotencyKey: 'first-mt5',
    }));
    expect(firstResource.request).toMatchObject({ state: 'GRANTED', lease: { resourceKey: 'mt5-terminal-1' } });

    const queuedResource = value(await broker.resource({
      action: 'request',
      roomId: created.room.id,
      agentSessionId: lead3.agentSessionId,
      taskId: second.task.id,
      resourceKey: 'mt5-terminal-1',
      idempotencyKey: 'second-mt5',
    }));
    expect(queuedResource.request).toMatchObject({ state: 'QUEUED', queuePosition: 1 });

    const beforeRestart = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
    expect(beforeRestart).toMatchObject({
      workspaceLeases: { observable: true, entries: expect.arrayContaining([expect.objectContaining({ workspaceId: 'workspace-a' }), expect.objectContaining({ workspaceId: 'workspace-b' })]) },
      resources: { mode: 'SCHEDULED', queueDepth: 1, leases: [{ resourceKey: 'mt5-terminal-1' }] },
    });

    database.close();
    now = new Date('2026-08-29T02:01:00.000Z');
    database = new SqliteDatabase(filename);
    broker = createBroker(database, () => now);

    const recovered = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
    expect(recovered.workspaceLeases.entries).toHaveLength(2);
    expect(recovered.resources).toMatchObject({ queueDepth: 1, leases: [{ resourceKey: 'mt5-terminal-1' }] });

    const firstWaiting = value(await broker.task({
      action: 'wait',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: first.task.id,
      expectedVersion: firstStarted.task.version,
      reason: 'Release writer and terminal for the next Lead.',
      idempotencyKey: 'first-wait',
    }));
    expect(firstWaiting.task.state).toBe('WAITING');

    const promoted = value(await broker.resource({
      action: 'request',
      roomId: created.room.id,
      agentSessionId: lead3.agentSessionId,
      taskId: second.task.id,
      resourceKey: 'mt5-terminal-1',
      idempotencyKey: 'second-mt5',
    }));
    expect(promoted.request).toMatchObject({ state: 'GRANTED', duplicate: true });

    const submitted = value(await broker.task({
      action: 'submit',
      roomId: created.room.id,
      agentSessionId: lead3.agentSessionId,
      taskId: second.task.id,
      expectedVersion: secondStarted.task.version,
      result: { summary: 'Phase 2B evidence complete.', evidenceRefs: ['test:phase2b'] },
      idempotencyKey: 'second-submit',
    }));
    expect(submitted.task.state).toBe('REVIEW');

    const finalStatus = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
    expect(finalStatus.workspaceLeases.entries).toHaveLength(0);
    expect(finalStatus.resources.leases).toHaveLength(0);
    database.close();
  });
  it('moves expired or parked WRITE work to WAITING and releases every lease', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-phase2b-expiry-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    seedWorkspace(database, 'workspace-expiry', path.join(root, 'workspace-expiry'));
    let now = new Date('2026-08-29T03:00:00.000Z');
    const broker = createBroker(database, () => now);

    const created = value(await broker.admin({ action: 'create', name: 'Expiry Room', idempotencyKey: 'expiry-room', leadSlots: 1 }));
    const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));
    const assigned = await assignWrite(broker, created.room.id, main.agentSessionId, 'LEAD-1', 'workspace-expiry', lead.roomVersion, 'expiry');
    const claimed = value(await broker.task({ action: 'claim', roomId: created.room.id, agentSessionId: lead.agentSessionId, taskId: assigned.task.id, expectedVersion: 1, idempotencyKey: 'expiry-claim' }));
    const started = value(await broker.task({ action: 'start', roomId: created.room.id, agentSessionId: lead.agentSessionId, taskId: assigned.task.id, expectedVersion: claimed.task.version, idempotencyKey: 'expiry-start' }));
    value(await broker.resource({ action: 'request', roomId: created.room.id, agentSessionId: lead.agentSessionId, taskId: assigned.task.id, resourceKey: 'vps-nava-writer', idempotencyKey: 'expiry-vps' }));

    now = new Date('2026-08-29T03:16:00.000Z');
    value(await broker.presence({ action: 'heartbeat', roomId: created.room.id, agentSessionId: lead.agentSessionId }));
    const expired = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
    expect(expired.tasks.find((task) => task.id === assigned.task.id)?.state).toBe('WAITING');
    expect(expired.workspaceLeases.entries).toHaveLength(0);
    expect(expired.resources.leases).toHaveLength(0);

    const restarted = value(await broker.task({ action: 'start', roomId: created.room.id, agentSessionId: lead.agentSessionId, taskId: assigned.task.id, expectedVersion: started.task.version + 1, idempotencyKey: 'expiry-restart' }));
    expect(restarted.task.state).toBe('RUNNING');
    const parked = value(await broker.presence({ action: 'park', roomId: created.room.id, agentSessionId: lead.agentSessionId, lastCheckpointId: 'checkpoint-before-park' }));
    expect(parked.agent.state).toBe('SLEEPING');

    const afterPark = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
    expect(afterPark.tasks.find((task) => task.id === assigned.task.id)?.state).toBe('WAITING');
    expect(afterPark.workspaceLeases.entries).toHaveLength(0);
    database.close();
  });

});

function createBroker(database: SqliteDatabase, now: () => Date): CommandRoomBroker {
  const workspaceLeases = new SqliteWorkspaceLeaseRepository(database, now);
  return new CommandRoomBroker(
    new SqliteCommandRoomRepository(database),
    now,
    {
      workspaceLeases,
      resources: new SqliteCommandRoomResourceRepository(database),
      workspaceExists: async (workspaceId) => database.connection.prepare('SELECT 1 AS found FROM workspaces WHERE id = ?').get(workspaceId) !== undefined,
    },
  );
}

async function assignWrite(
  broker: CommandRoomBroker,
  roomId: string,
  mainSessionId: string,
  slot: string,
  workspaceId: string,
  expectedVersion: number,
  key: string,
): Promise<CommandRoomTaskResponse> {
  return value(await broker.task({
    action: 'assign',
    roomId,
    agentSessionId: mainSessionId,
    assignedSlotKey: slot,
    projectKey: key,
    workspaceId,
    title: key,
    brief: { summary: key, acceptanceCriteria: ['bounded proof'], evidenceRefs: [] },
    mutationMode: 'WRITE',
    priority: -10,
    expectedVersion,
    idempotencyKey: `${key}-assign`,
  }));
}

function seedWorkspace(database: SqliteDatabase, id: string, rootPath: string): void {
  database.connection.prepare('INSERT INTO workspaces (id, display_name, root_path, real_root_path, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, id, rootPath, rootPath, '2026-08-29T02:00:00.000Z');
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
