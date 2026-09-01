import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import { SqliteDatabase, SqliteCommandRoomRepository } from '@lnwjud/storage';
import { CommandRoomBroker, type CommandRoomResourcePort, type CommandRoomWorkspaceLease, type CommandRoomWorkspaceLeasePort } from './command-room-broker.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function lease(workspaceId: string, leaseId: string, owner: string): CommandRoomWorkspaceLease {
  return { workspaceId, leaseId, owner, acquiredAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(), expiresAt: '9999-01-01T00:00:00.000Z' };
}

function fakeWorkspaceLeases(existing: readonly CommandRoomWorkspaceLease[]): { port: CommandRoomWorkspaceLeasePort; released: Array<{ workspaceId: string; leaseId: string }> } {
  const released: Array<{ workspaceId: string; leaseId: string }> = [];
  const port: CommandRoomWorkspaceLeasePort = {
    acquire: async () => { throw new Error('not used'); },
    status: async (): Promise<Result<readonly CommandRoomWorkspaceLease[]>> => ok(existing),
    renew: async () => { throw new Error('not used'); },
    release: async (workspaceId, leaseId) => {
      released.push({ workspaceId, leaseId });
      return ok({ released: true });
    },
  };
  return { port, released };
}

function fakeResources(): { port: CommandRoomResourcePort; releasedRooms: string[] } {
  const releasedRooms: string[] = [];
  const port = {
    releaseForRoom: async (roomId: string): Promise<number> => {
      releasedRooms.push(roomId);
      return 1;
    },
  } as unknown as CommandRoomResourcePort;
  return { port, releasedRooms };
}

describe('CommandRoomBroker room-close lease fan-out', () => {
  it('releases only the room-scoped workspace leases plus resource leases when a MAIN archives the room', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-broker-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const repository = new SqliteCommandRoomRepository(database);
    const existing = [
      lease('ws-1', 'lease-room', 'command-room:PLACEHOLDER:task-1'),
      lease('ws-2', 'lease-other', 'unrelated-owner'),
    ];
    const workspaceLeases = fakeWorkspaceLeases(existing);
    const resources = fakeResources();
    const broker = new CommandRoomBroker(repository, () => new Date('2026-09-02T00:00:00.000Z'), {
      workspaceLeases: workspaceLeases.port,
      resources: resources.port,
      workspaceExists: async (): Promise<boolean> => true,
    });

    const created = await broker.admin({ action: 'create', name: 'Gate room', idempotencyKey: 'create-key-1', leadSlots: 1 });
    if (!created.ok) throw new Error(created.error.message);
    const room = created.value.room;
    existing[0].owner = `command-room:${room.id}:task-1`;

    const mainJoinCode = created.value.joinCodes['MAIN'];
    if (mainJoinCode === undefined) throw new Error('create should return a MAIN join code');
    const joined = await broker.join({ roomId: room.id, slotKey: 'MAIN', joinCode: mainJoinCode, provider: 'CHATGPT', connectionEpoch: 1 });
    if (!joined.ok) throw new Error(joined.error.message);

    try {
      const archived = await broker.admin({
        action: 'archive',
        roomId: room.id,
        agentSessionId: joined.value.agentSessionId,
        expectedVersion: joined.value.roomVersion,
        idempotencyKey: 'archive-key-1',
      });
      if (!archived.ok) throw new Error(archived.error.message);
      expect(archived.value).toMatchObject({ action: 'archive', room: { status: 'ARCHIVED' } });
      expect(workspaceLeases.released).toEqual([{ workspaceId: 'ws-1', leaseId: 'lease-room' }]);
      expect(resources.releasedRooms).toEqual([room.id]);

      const replay = await broker.admin({
        action: 'archive',
        roomId: room.id,
        agentSessionId: joined.value.agentSessionId,
        expectedVersion: archived.value.room.version,
        idempotencyKey: 'archive-key-1',
      });
      expect(replay).toMatchObject({ ok: true, value: { duplicate: true } });
      expect(workspaceLeases.released).toHaveLength(1);
      expect(resources.releasedRooms).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
