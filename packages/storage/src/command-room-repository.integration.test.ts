import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    await expect(second.listAgents('room-1')).resolves.toMatchObject([
      { id: 'agent-main', slotKey: 'MAIN', role: 'MAIN', state: 'AVAILABLE' },
      { id: 'agent-lead-1', slotKey: 'LEAD-1', role: 'LEAD', state: 'AVAILABLE' },
    ]);
    secondDatabase.close();
  });
});
