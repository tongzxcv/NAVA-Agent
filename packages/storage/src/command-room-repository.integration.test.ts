import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRoomAgentRecord } from '@lnwjud/domain';
import { SqliteCommandRoomRepository } from './command-room-repository.js';
import { SqliteDatabase } from './database.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteCommandRoomRepository', () => {
  it('applies migration 005 and preserves a room and its slots across reopen', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-'));
    temporaryRoots.push(root);
    const filename = path.join(root, 'state.db');
    const createdAt = '2026-08-28T00:00:00.000Z';

    const firstDatabase = new SqliteDatabase(filename);
    const first = new SqliteCommandRoomRepository(firstDatabase);
    await first.createRoom({
      room: {
        id: 'room-1',
        name: 'EA Command',
        status: 'ACTIVE',
        policy: { directLeadMessaging: false },
        version: 1,
        creationKey: 'create-room-1',
        createdAt,
        updatedAt: createdAt,
      },
      agents: [
        {
          id: 'agent-main',
          roomId: 'room-1',
          slotKey: 'MAIN',
          role: 'MAIN',
          provider: 'CHATGPT',
          state: 'AVAILABLE',
          connectionEpoch: 0,
          capabilities: [],
          joinCodeHash: 'main-hash',
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'agent-lead-1',
          roomId: 'room-1',
          slotKey: 'LEAD-1',
          role: 'LEAD',
          provider: 'CHATGPT',
          state: 'AVAILABLE',
          connectionEpoch: 0,
          capabilities: [],
          joinCodeHash: 'lead-hash',
          createdAt,
          updatedAt: createdAt,
        },
      ],
    });
    expect(firstDatabase.connection.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('005_command_room_core'))
      .toEqual({ id: '005_command_room_core' });
    firstDatabase.close();

    const secondDatabase = new SqliteDatabase(filename);
    const second = new SqliteCommandRoomRepository(secondDatabase);
    await expect(second.getRoom('room-1')).resolves.toMatchObject({
      id: 'room-1',
      name: 'EA Command',
      status: 'ACTIVE',
      policy: { directLeadMessaging: false },
      version: 1,
    });
    await expect(second.listRooms(20)).resolves.toMatchObject([{ id: 'room-1', name: 'EA Command', status: 'ACTIVE' }]);
    await expect(second.listAgents('room-1')).resolves.toMatchObject([
      { id: 'agent-main', slotKey: 'MAIN', role: 'MAIN', state: 'AVAILABLE' },
      { id: 'agent-lead-1', slotKey: 'LEAD-1', role: 'LEAD', state: 'AVAILABLE' },
    ]);
    secondDatabase.close();
  });

  it('adds a Lead slot atomically, replays idempotently, rejects stale versions, and survives reopen', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-add-lead-'));
    temporaryRoots.push(root);
    const filename = path.join(root, 'state.db');
    const createdAt = '2026-08-30T06:00:00.000Z';
    const database = new SqliteDatabase(filename);
    const repository = new SqliteCommandRoomRepository(database);
    const baseAgent = (id: string, slotKey: string, role: 'MAIN' | 'LEAD'): CommandRoomAgentRecord => ({
      id, roomId: 'room-add', slotKey, role, provider: 'CHATGPT' as const, state: 'AVAILABLE' as const,
      connectionEpoch: 0, capabilities: [], joinCodeHash: `${id}-hash`, createdAt, updatedAt: createdAt,
    });
    await repository.createRoom({
      room: { id: 'room-add', name: 'Expandable', status: 'ACTIVE', policy: { directLeadMessaging: false }, version: 1, creationKey: 'room-add-create', createdAt, updatedAt: createdAt },
      agents: [
        baseAgent('main-add', 'MAIN', 'MAIN'),
        baseAgent('lead-add-1', 'LEAD-1', 'LEAD'),
        baseAgent('lead-add-2', 'LEAD-2', 'LEAD'),
        baseAgent('lead-add-3', 'LEAD-3', 'LEAD'),
      ],
    });
    const lead4 = baseAgent('lead-add-4', 'LEAD-4', 'LEAD');
    const first = await repository.addLeadSlot({
      roomId: 'room-add', actorAgentId: 'main-add', agent: lead4, expectedVersion: 1,
      idempotencyKey: 'add-lead-4', occurredAt: '2026-08-30T06:00:01.000Z',
    });
    expect(first).toMatchObject({ outcome: 'updated', duplicate: false, room: { version: 2 }, agent: { slotKey: 'LEAD-4', connectionEpoch: 0 }, eventType: 'ADD_LEAD' });
    await expect(repository.addLeadSlot({
      roomId: 'room-add', actorAgentId: 'main-add', agent: baseAgent('ignored-replay', 'LEAD-5', 'LEAD'), expectedVersion: 1,
      idempotencyKey: 'add-lead-4', occurredAt: '2026-08-30T06:00:02.000Z',
    })).resolves.toMatchObject({ outcome: 'updated', duplicate: true, room: { version: 2 }, agent: { id: 'lead-add-4', slotKey: 'LEAD-4' } });
    await expect(repository.addLeadSlot({
      roomId: 'room-add', actorAgentId: 'main-add', agent: baseAgent('lead-add-5', 'LEAD-5', 'LEAD'), expectedVersion: 1,
      idempotencyKey: 'stale-lead-5', occurredAt: '2026-08-30T06:00:03.000Z',
    })).resolves.toEqual({ outcome: 'room_version_conflict', currentVersion: 2 });
    database.close();

    const reopenedDatabase = new SqliteDatabase(filename);
    const reopened = new SqliteCommandRoomRepository(reopenedDatabase);
    await expect(reopened.listAgents('room-add')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ slotKey: 'LEAD-4', id: 'lead-add-4' })]));
    await expect(reopened.getRoom('room-add')).resolves.toMatchObject({ version: 2 });
    reopenedDatabase.close();
  });

  it('deletes archived rooms only and cascades room-owned rows', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-delete-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const repository = new SqliteCommandRoomRepository(database);
    const createdAt = '2026-08-29T10:00:00.000Z';
    await repository.createRoom({
      room: { id: 'room-delete', name: 'Delete me', status: 'ACTIVE', policy: { directLeadMessaging: false }, version: 1, creationKey: 'delete-room', createdAt, updatedAt: createdAt },
      agents: [{ id: 'delete-main', roomId: 'room-delete', slotKey: 'MAIN', role: 'MAIN', provider: 'CHATGPT', state: 'AVAILABLE', connectionEpoch: 0, capabilities: [], joinCodeHash: 'delete-hash', createdAt, updatedAt: createdAt }],
    });

    await expect(repository.deleteArchivedRoom('room-delete')).resolves.toEqual({ deleted: false, reason: 'not_archived' });
    expect(await repository.getRoom('room-delete')).not.toBeNull();

    database.connection.prepare("UPDATE command_rooms SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?").run(createdAt, createdAt, 'room-delete');
    await expect(repository.deleteArchivedRoom('room-delete')).resolves.toEqual({ deleted: true });
    await expect(repository.getRoom('room-delete')).resolves.toBeNull();
    await expect(repository.listAgents('room-delete')).resolves.toEqual([]);
    database.close();
  });
});
