import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCommandRoomBindingRepository } from './command-room-binding-repository.js';
import { SqliteCommandRoomSupervisorStateRepository } from './command-room-supervisor-state-repository.js';
import { SqliteDatabase } from './database.js';

const cleanup: string[] = [];
const NOW = '2026-09-05T00:00:00.000Z';

describe('SqliteCommandRoomSupervisorStateRepository', () => {
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('publishes from an active paired epoch without touching agent/task authority and recovers after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-supervisor-state-'));
    cleanup.push(directory);
    const filename = join(directory, 'nava.db');
    const database = new SqliteDatabase(filename);
    seed(database);
    const bindings = new SqliteCommandRoomBindingRepository(database);
    const states = new SqliteCommandRoomSupervisorStateRepository(database);
    await pair(bindings, 'binding-1', 'fingerprint-1');

    const published = await states.publish({
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      connectionEpoch: 1,
      bindingId: 'binding-1',
      bindingFingerprint: 'fingerprint-1',
      status: 'DONE',
      nextAction: 'Continue READY verification',
      safeToContinue: true,
      needsUser: false,
      checkpointId: 'checkpoint-1',
      durableTaskIds: [],
      publishedAt: NOW,
    });
    expect(published).toMatchObject({
      outcome: 'published',
      state: {
        slotKey: 'LEAD-1',
        connectionEpoch: 1,
        status: 'DONE',
        supervisorSync: 'OK',
        checkpointId: 'checkpoint-1',
      },
    });
    expect(database.connection.prepare(
      "SELECT connection_epoch, current_task_id FROM command_room_agents WHERE id = 'lead-1'",
    ).get()).toEqual({ connection_epoch: 1, current_task_id: null });
    expect(database.connection.prepare(
      "SELECT state, checkpoint_id FROM command_room_tasks WHERE id = 'legacy-task'",
    ).get()).toEqual({ state: 'QUEUED', checkpoint_id: null });

    expect(await states.markHandled({
      roomId: 'room-1',
      agentId: 'lead-1',
      checkpointId: 'checkpoint-1',
      action: 'CONTINUE',
      handledAt: '2026-09-05T00:00:01.000Z',
    })).toBe(true);
    database.close();

    const reopenedDatabase = new SqliteDatabase(filename);
    const reopened = new SqliteCommandRoomSupervisorStateRepository(reopenedDatabase);
    expect(await reopened.getForAgent('room-1', 'lead-1')).toMatchObject({
      status: 'DONE',
      supervisorSync: 'OK',
      lastHandledCheckpointId: 'checkpoint-1',
      lastHandledAction: 'CONTINUE',
    });
    reopenedDatabase.close();
  });

  it('fails closed for wrong identity, stale epoch, and replaced binding', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-supervisor-state-auth-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seed(database);
    const bindings = new SqliteCommandRoomBindingRepository(database);
    const states = new SqliteCommandRoomSupervisorStateRepository(database);
    await pair(bindings, 'binding-1', 'fingerprint-1');

    const base = {
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      connectionEpoch: 1,
      bindingId: 'binding-1',
      bindingFingerprint: 'fingerprint-1',
      status: 'WORKING' as const,
      safeToContinue: false,
      needsUser: false,
      checkpointId: 'checkpoint-1',
      durableTaskIds: [] as string[],
      publishedAt: NOW,
    };
    expect(await states.publish({ ...base, slotKey: 'LEAD-2' })).toEqual({ outcome: 'identity_mismatch' });
    expect(await states.publish({ ...base, connectionEpoch: 2 })).toEqual({ outcome: 'stale_epoch' });
    await bindings.replace('binding-1', '2026-09-05T00:00:02.000Z');
    expect(await states.publish(base)).toEqual({ outcome: 'binding_not_active' });
    database.close();
  });

  it('moves publication to a same-epoch continuation binding without re-handling the same checkpoint', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-supervisor-state-continuation-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seed(database);
    const bindings = new SqliteCommandRoomBindingRepository(database);
    const states = new SqliteCommandRoomSupervisorStateRepository(database);
    await pair(bindings, 'binding-old', 'fingerprint-old');

    const common = {
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      connectionEpoch: 1,
      status: 'DONE' as const,
      nextAction: 'Continue',
      safeToContinue: true,
      needsUser: false,
      checkpointId: 'checkpoint-stable',
      durableTaskIds: [] as string[],
    };
    expect((await states.publish({
      ...common,
      bindingId: 'binding-old',
      bindingFingerprint: 'fingerprint-old',
      publishedAt: NOW,
    })).outcome).toBe('published');
    await states.markHandled({
      roomId: 'room-1',
      agentId: 'lead-1',
      checkpointId: 'checkpoint-stable',
      action: 'CONTINUE',
      handledAt: '2026-09-05T00:00:01.000Z',
    });

    await pair(bindings, 'binding-new', 'fingerprint-new', '2026-09-05T00:00:02.000Z');
    expect(await bindings.getActiveBinding('room-1', 'lead-1', 1)).toMatchObject({
      id: 'binding-new',
      connectionEpoch: 1,
      state: 'PAIRED',
    });
    const republished = await states.publish({
      ...common,
      bindingId: 'binding-new',
      bindingFingerprint: 'fingerprint-new',
      publishedAt: '2026-09-05T00:00:03.000Z',
    });
    expect(republished).toMatchObject({
      outcome: 'published',
      state: {
        bindingId: 'binding-new',
        connectionEpoch: 1,
        lastHandledCheckpointId: 'checkpoint-stable',
        lastHandledAction: 'CONTINUE',
      },
    });
    expect(database.connection.prepare(
      "SELECT connection_epoch FROM command_room_agents WHERE id = 'lead-1'",
    ).get()).toEqual({ connection_epoch: 1 });
    database.close();
  });
});

function seed(database: SqliteDatabase): void {
  const c = database.connection;
  c.prepare(
    "INSERT INTO command_rooms (id, name, status, policy_json, version, creation_key, created_at, updated_at) VALUES (?, ?, 'ACTIVE', '{}', 1, ?, ?, ?)",
  ).run('room-1', 'Supervisor state test', 'supervisor-state-room', NOW, NOW);
  c.prepare(
    "INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, project_key, workspace_id, connection_epoch, capabilities_json, created_at, updated_at) VALUES (?, 'room-1', 'MAIN', 'MAIN', 'CHATGPT', 'ONLINE', NULL, NULL, 1, '[]', ?, ?)",
  ).run('main-1', NOW, NOW);
  c.prepare(
    "INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, project_key, workspace_id, connection_epoch, current_task_id, capabilities_json, created_at, updated_at) VALUES (?, 'room-1', 'LEAD-1', 'LEAD', 'CHATGPT', 'ONLINE', 'beelzebub', 'workspace-beelzebub', 1, NULL, '[]', ?, ?)",
  ).run('lead-1', NOW, NOW);
  c.prepare(
    "INSERT INTO command_room_tasks (id, room_id, project_key, workspace_id, title, brief_json, mutation_mode, state, priority, assigned_agent_id, created_by_agent_id, checkpoint_id, version, created_at, updated_at) VALUES ('legacy-task', 'room-1', 'beelzebub', 'workspace-beelzebub', 'Legacy queued', '{}', 'READ_ONLY', 'QUEUED', 0, 'lead-1', 'main-1', NULL, 1, ?, ?)",
  ).run(NOW, NOW);
}

async function pair(
  bindings: SqliteCommandRoomBindingRepository,
  bindingId: string,
  fingerprint: string,
  createdAt = NOW,
): Promise<void> {
  await bindings.createChallenge({
    id: bindingId,
    roomId: 'room-1',
    agentId: 'lead-1',
    slotKey: 'LEAD-1',
    provider: 'CHATGPT',
    connectionEpoch: 1,
    challengeHash: `sha256:${bindingId}`,
    challengeExpiresAt: '2099-01-01T00:00:00.000Z',
    createdAt,
  });
  const result = await bindings.confirmPairing({
    bindingId,
    roomId: 'room-1',
    agentId: 'lead-1',
    connectionEpoch: 1,
    challengeHash: `sha256:${bindingId}`,
    extensionInstallationId: 'extension-installation-1',
    encryptedConversationRef: `ciphertext:${bindingId}`,
    conversationRefFingerprint: fingerprint,
    confirmedAt: createdAt,
  });
  expect(result.outcome).toBe('paired');
}
