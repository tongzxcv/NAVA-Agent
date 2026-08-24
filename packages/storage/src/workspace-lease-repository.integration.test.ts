import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@lnwjud/workspace';
import { SqliteDatabase } from './database.js';
import { SqliteWorkspaceLeaseRepository } from './workspace-lease-repository.js';
import { SqliteWorkspaceRepository } from './workspace-repository.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteWorkspaceLeaseRepository', () => {
  it('coordinates leases across database connections and reclaims expired leases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-lease-'));
    temporaryRoots.push(root);
    const filename = path.join(root, 'state.db');
    let now = new Date('2026-08-25T00:00:00.000Z');
    const firstDatabase = new SqliteDatabase(filename);
    const workspace: Workspace = { id: 'ws-1', displayName: 'One', rootPath: 'C:\\one', realRootPath: 'C:\\one', createdAt: now.toISOString() };
    await new SqliteWorkspaceRepository(firstDatabase).insert(workspace);
    const secondDatabase = new SqliteDatabase(filename);
    const first = new SqliteWorkspaceLeaseRepository(firstDatabase, () => now);
    const second = new SqliteWorkspaceLeaseRepository(secondDatabase, () => now);

    const acquired = await first.acquire(workspace.id, 'chat-a', 300);
    expect(acquired).toMatchObject({ ok: true, value: { workspaceId: 'ws-1', owner: 'chat-a' } });
    await expect(second.acquire(workspace.id, 'chat-b', 300)).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(second.assertMutationAllowed(workspace.id)).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    if (!acquired.ok) throw new Error('lease should be acquired');
    await expect(second.assertMutationAllowed(workspace.id, acquired.value.leaseId)).resolves.toEqual({ ok: true, value: undefined });

    now = new Date('2026-08-25T00:06:00.000Z');
    await expect(second.acquire(workspace.id, 'chat-b', 300)).resolves.toMatchObject({ ok: true, value: { owner: 'chat-b' } });
    firstDatabase.close();
    secondDatabase.close();
  });

  it('renews and releases only with the matching opaque lease ID', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-lease-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    await new SqliteWorkspaceRepository(database).insert({ id: 'ws-1', displayName: 'One', rootPath: 'C:\\one', realRootPath: 'C:\\one', createdAt: new Date(0).toISOString() });
    const leases = new SqliteWorkspaceLeaseRepository(database);
    const acquired = await leases.acquire('ws-1', 'chat-a', 300);
    if (!acquired.ok) throw new Error('lease should be acquired');

    await expect(leases.renew('ws-1', 'wrong', 300)).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(leases.renew('ws-1', acquired.value.leaseId, 600)).resolves.toMatchObject({ ok: true, value: { owner: 'chat-a' } });
    await expect(leases.release('ws-1', 'wrong')).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(leases.release('ws-1', acquired.value.leaseId)).resolves.toEqual({ ok: true, value: { released: true } });
    await expect(leases.status('ws-1')).resolves.toEqual({ ok: true, value: [] });
    database.close();
  });
});
