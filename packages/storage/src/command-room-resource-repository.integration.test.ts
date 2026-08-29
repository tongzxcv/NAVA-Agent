import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCommandRoomResourceRepository, type CommandRoomResourceRequestResult } from './command-room-resource-repository.js';
import { SqliteDatabase } from './database.js';

const cleanup: string[] = [];
const NOW = '2026-08-29T01:30:00.000Z';

describe('SqliteCommandRoomResourceRepository', () => {
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('migrates, seeds resources, enforces capacity, queues deterministically, and recovers after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-resource-'));
    cleanup.push(directory);
    const filename = join(directory, 'nava.db');

    const firstDatabase = new SqliteDatabase(filename);
    seedCommandRoom(firstDatabase);
    const first = new SqliteCommandRoomResourceRepository(firstDatabase);

    expect(firstDatabase.connection.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('006_command_room_resources'))
      .toEqual({ id: '006_command_room_resources' });

    const initial = await first.status({ roomId: 'room-1', now: NOW });
    expect(initial.resources).toHaveLength(11);
    expect(initial.resources.find((entry) => entry.resourceKey === 'cpu-heavy-project')?.capacity).toBe(2);
    const terminals = initial.resources.filter((entry) => entry.kind === 'MT5_TERMINAL');
    expect(terminals.map((entry) => entry.resourceKey)).toEqual([
      'mt5-terminal-1', 'mt5-terminal-2', 'mt5-terminal-3', 'mt5-terminal-4',
      'mt5-terminal-5', 'mt5-terminal-6', 'mt5-terminal-7',
    ]);
    expect(terminals.every((entry) => entry.capacity === 1)).toBe(true);
    for (const key of ['vps-nava-writer', 'managed-browser-writer', 'gpu-heavy']) {
      expect(initial.resources.find((entry) => entry.resourceKey === key)?.capacity).toBe(1);
    }

    const granted = await first.request({
      resourceKey: 'mt5-terminal-1',
      roomId: 'room-1',
      taskId: 'task-1',
      agentId: 'lead-1',
      units: 1,
      priority: 10,
      idempotencyKey: 'request-1',
      requestedAt: NOW,
      ttlSeconds: 900,
    });
    expect(granted.state).toBe('GRANTED');
    expect(granted.lease?.owner).toEqual({ roomId: 'room-1', taskId: 'task-1', agentId: 'lead-1' });
    const renewed = await first.renew({
      leaseId: granted.lease!.leaseId,
      agentId: 'lead-1',
      renewedAt: '2026-08-29T01:30:30.000Z',
      ttlSeconds: 900,
    });
    expect(renewed.heartbeatAt).toBe('2026-08-29T01:30:30.000Z');
    await expect(first.renew({
      leaseId: granted.lease!.leaseId,
      agentId: 'lead-2',
      renewedAt: '2026-08-29T01:30:31.000Z',
      ttlSeconds: 900,
    })).rejects.toThrow('not found or is not owned');

    const queued = await first.request({
      resourceKey: 'mt5-terminal-1',
      roomId: 'room-1',
      taskId: 'task-2',
      agentId: 'lead-2',
      units: 1,
      priority: 10,
      idempotencyKey: 'request-2',
      requestedAt: '2026-08-29T01:30:01.000Z',
      ttlSeconds: 900,
    });
    expect(queued).toMatchObject({ state: 'QUEUED', queuePosition: 1, duplicate: false });

    const replay = await first.request({
      resourceKey: 'mt5-terminal-1',
      roomId: 'room-1',
      taskId: 'task-2',
      agentId: 'lead-2',
      units: 1,
      priority: 10,
      idempotencyKey: 'request-2',
      requestedAt: '2026-08-29T01:30:01.000Z',
      ttlSeconds: 900,
    });
    expect(replay).toMatchObject({ state: 'QUEUED', queuePosition: 1, duplicate: true });

    firstDatabase.close();

    const reopenedDatabase = new SqliteDatabase(filename);
    const reopened = new SqliteCommandRoomResourceRepository(reopenedDatabase);
    const recovered = await reopened.status({ roomId: 'room-1', now: '2026-08-29T01:31:00.000Z' });
    expect(recovered.leases).toHaveLength(1);
    expect(recovered.queueDepth).toBe(1);

    await reopened.release({
      leaseId: granted.lease!.leaseId,
      agentId: 'lead-1',
      releasedAt: '2026-08-29T01:31:01.000Z',
    });
    expect(reopenedDatabase.connection.prepare(
      'SELECT state FROM command_room_resource_requests WHERE request_id = ?',
    ).get(granted.requestId)).toEqual({ state: 'RELEASED' });

    const promoted = await reopened.request({
      resourceKey: 'mt5-terminal-1',
      roomId: 'room-1',
      taskId: 'task-2',
      agentId: 'lead-2',
      units: 1,
      priority: 10,
      idempotencyKey: 'request-2',
      requestedAt: '2026-08-29T01:30:01.000Z',
      ttlSeconds: 900,
    });
    expect(promoted.state).toBe('GRANTED');
    expect(promoted.duplicate).toBe(true);

    reopenedDatabase.close();
  });
  it('closes queued requests when their task or room releases without an active resource lease', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-resource-queued-cleanup-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomResourceRepository(database);

    const holder = await request(repository, 'mt5-terminal-1', 'task-1', 'lead-1', 'cleanup-holder', 10, '2026-08-29T01:00:00.000Z');
    const queuedTask = await request(repository, 'mt5-terminal-1', 'task-2', 'lead-2', 'cleanup-queued-task', 10, '2026-08-29T01:00:01.000Z');
    expect(holder.state).toBe('GRANTED');
    expect(queuedTask).toMatchObject({ state: 'QUEUED', queuePosition: 1 });

    expect(await repository.releaseForTask('room-1', 'task-2', '2026-08-29T01:00:02.000Z')).toBe(0);
    expect(database.connection.prepare('SELECT state FROM command_room_resource_requests WHERE request_id = ?').get(queuedTask.requestId))
      .toEqual({ state: 'RELEASED' });

    await repository.release({ leaseId: holder.lease!.leaseId, agentId: 'lead-1', releasedAt: '2026-08-29T01:00:03.000Z' });
    const next = await request(repository, 'mt5-terminal-1', 'task-3', 'lead-3', 'cleanup-next', 10, '2026-08-29T01:00:04.000Z');
    expect(next.state).toBe('GRANTED');

    const roomQueued = await request(repository, 'mt5-terminal-2', 'task-2', 'lead-2', 'cleanup-room-queued', 10, '2026-08-29T01:00:05.000Z');
    expect(roomQueued.state).toBe('GRANTED');
    const anotherRoomQueued = await request(repository, 'mt5-terminal-2', 'task-3', 'lead-3', 'cleanup-room-waiter', 10, '2026-08-29T01:00:06.000Z');
    expect(anotherRoomQueued.state).toBe('QUEUED');
    await repository.releaseForRoom('room-1', '2026-08-29T01:00:07.000Z');
    expect(database.connection.prepare('SELECT state FROM command_room_resource_requests WHERE request_id = ?').get(anotherRoomQueued.requestId))
      .toEqual({ state: 'RELEASED' });
    expect((await repository.status({ roomId: 'room-1', now: '2026-08-29T01:00:08.000Z' })).queueDepth).toBe(0);
    database.close();
  });

  it('enforces capacity two and promotes queued work by priority aging then FIFO', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-resource-order-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomResourceRepository(database);

    const cpu1 = await request(repository, 'cpu-heavy-project', 'task-1', 'lead-1', 'cpu-1', 10, '2026-08-29T01:00:00.000Z');
    const cpu2 = await request(repository, 'cpu-heavy-project', 'task-2', 'lead-2', 'cpu-2', 10, '2026-08-29T01:00:01.000Z');
    const cpu3 = await request(repository, 'cpu-heavy-project', 'task-3', 'lead-3', 'cpu-3', 10, '2026-08-29T01:00:02.000Z');
    expect([cpu1.state, cpu2.state, cpu3.state]).toEqual(['GRANTED', 'GRANTED', 'QUEUED']);

    const holder = await request(repository, 'vps-nava-writer', 'task-1', 'lead-1', 'vps-holder', 100, '2026-08-29T01:00:00.000Z');
    const oldLow = await request(repository, 'vps-nava-writer', 'task-2', 'lead-2', 'vps-old', 0, '2026-08-29T01:00:01.000Z');
    const newerHigh = await request(repository, 'vps-nava-writer', 'task-3', 'lead-3', 'vps-new', 1, '2026-08-29T01:06:00.000Z');
    expect([holder.state, oldLow.state, newerHigh.state]).toEqual(['GRANTED', 'QUEUED', 'QUEUED']);

    await repository.release({ leaseId: holder.lease!.leaseId, agentId: 'lead-1', releasedAt: '2026-08-29T01:11:00.000Z' });
    const aged = await request(repository, 'vps-nava-writer', 'task-2', 'lead-2', 'vps-old', 0, '2026-08-29T01:11:00.000Z');
    expect(aged).toMatchObject({ state: 'GRANTED', duplicate: true });
    const status = await repository.status({ now: '2026-08-29T01:11:00.000Z' });
    expect(status.queueDepth).toBe(2);
    database.close();
  });

});

async function request(
  repository: SqliteCommandRoomResourceRepository,
  resourceKey: string,
  taskId: string,
  agentId: string,
  idempotencyKey: string,
  priority: number,
  requestedAt: string,
): Promise<CommandRoomResourceRequestResult> {
  return repository.request({ resourceKey, roomId: 'room-1', taskId, agentId, units: 1, priority, idempotencyKey, requestedAt, ttlSeconds: 900 });
}

function seedCommandRoom(database: SqliteDatabase): void {
  const connection = database.connection;
  connection.prepare(
    "INSERT INTO command_rooms (id, name, status, policy_json, version, creation_key, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, 1, ?, ?, ?)",
  ).run('room-1', 'Phase 2B test', JSON.stringify({ directLeadMessaging: false }), 'create-room-1', NOW, NOW);
  for (const [id, slot] of [['main-1', 'MAIN'], ['lead-1', 'LEAD-1'], ['lead-2', 'LEAD-2'], ['lead-3', 'LEAD-3']] as const) {
    connection.prepare(
      "INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, connection_epoch, capabilities_json, created_at, updated_at) VALUES (?, 'room-1', ?, ?, 'CHATGPT', 'ONLINE', 1, '[]', ?, ?)",
    ).run(id, slot, slot === 'MAIN' ? 'MAIN' : 'LEAD', NOW, NOW);
  }
  for (const [id, agent] of [['task-1', 'lead-1'], ['task-2', 'lead-2'], ['task-3', 'lead-3']] as const) {
    connection.prepare(
      "INSERT INTO command_room_tasks (id, room_id, project_key, workspace_id, title, brief_json, mutation_mode, state, priority, assigned_agent_id, created_by_agent_id, version, created_at, updated_at) VALUES (?, 'room-1', 'project', 'workspace', ?, ?, 'WRITE', 'RUNNING', 10, ?, 'main-1', 1, ?, ?)",
    ).run(id, id, JSON.stringify({ summary: id, acceptanceCriteria: [], evidenceRefs: [] }), agent, NOW, NOW);
  }
}
