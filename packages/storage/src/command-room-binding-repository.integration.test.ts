import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCommandRoomBindingRepository } from './command-room-binding-repository.js';
import { SqliteDatabase } from './database.js';

const cleanup: string[] = [];
const NOW = '2026-08-30T00:00:00.000Z';

describe('SqliteCommandRoomBindingRepository', () => {
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('pairs one exact epoch, replaces stale authority, deduplicates wake events, and recovers after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-binding-repository-'));
    cleanup.push(directory);
    const filename = join(directory, 'nava.db');
    const database = new SqliteDatabase(filename);
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomBindingRepository(database);

    const firstChallenge = await repository.createChallenge({
      id: 'binding-old-challenge',
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      provider: 'CHATGPT',
      connectionEpoch: 1,
      challengeHash: 'sha256:old-challenge',
      challengeExpiresAt: '2026-08-30T00:05:00.000Z',
      createdAt: NOW,
    });
    expect(firstChallenge.state).toBe('CHALLENGED');

    const challenge = await repository.createChallenge({
      id: 'binding-1',
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      provider: 'CHATGPT',
      connectionEpoch: 1,
      challengeHash: 'sha256:challenge-1',
      challengeExpiresAt: '2026-08-30T00:05:00.000Z',
      createdAt: '2026-08-30T00:00:01.000Z',
    });
    expect(challenge).toMatchObject({ state: 'CHALLENGED', challengeHash: 'sha256:challenge-1' });
    expect((await repository.getBinding('binding-old-challenge'))?.state).toBe('REPLACED');

    await expect(repository.createChallenge({
      id: 'stale-challenge',
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      provider: 'CHATGPT',
      connectionEpoch: 0,
      challengeHash: 'sha256:stale',
      challengeExpiresAt: '2026-08-30T00:05:00.000Z',
      createdAt: '2026-08-30T00:00:02.000Z',
    })).rejects.toThrow('connection epoch is stale');

    expect(await repository.confirmPairing({
      bindingId: 'binding-1', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:wrong', extensionInstallationId: 'ext-random-1',
      encryptedConversationRef: 'ciphertext:v1:conversation-1', conversationRefFingerprint: 'hmac:conversation-1',
      confirmedAt: '2026-08-30T00:00:03.000Z',
    })).toEqual({ outcome: 'challenge_mismatch' });

    const paired = await repository.confirmPairing({
      bindingId: 'binding-1', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:challenge-1', extensionInstallationId: 'ext-random-1',
      encryptedConversationRef: 'ciphertext:v1:conversation-1', conversationRefFingerprint: 'hmac:conversation-1',
      confirmedAt: '2026-08-30T00:00:04.000Z',
    });
    expect(paired.outcome).toBe('paired');
    if (paired.outcome !== 'paired') throw new Error('Expected paired result.');
    expect(paired.binding).toMatchObject({
      state: 'PAIRED', connectionEpoch: 1, extensionInstallationId: 'ext-random-1',
      conversationRefFingerprint: 'hmac:conversation-1',
    });
    expect(paired.binding.challengeHash).toBeUndefined();

    const wake = await repository.enqueueWake({
      id: 'wake-1', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-1',
      eventKey: 'TASK_ASSIGNED:task-1', taskId: 'task-1', reason: 'TASK_ASSIGNED',
      nextEligibleAt: '2026-08-30T00:00:04.000Z', createdAt: '2026-08-30T00:00:04.000Z',
    });
    expect(wake).toMatchObject({ outcome: 'queued', duplicate: false });

    const duplicateWake = await repository.enqueueWake({
      id: 'wake-duplicate-id-is-ignored', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-1',
      eventKey: 'TASK_ASSIGNED:task-1', taskId: 'task-1', reason: 'TASK_ASSIGNED',
      nextEligibleAt: '2026-08-30T00:00:05.000Z', createdAt: '2026-08-30T00:00:05.000Z',
    });
    expect(duplicateWake).toMatchObject({ outcome: 'queued', duplicate: true, delivery: { id: 'wake-1' } });

    database.connection.prepare(
      "UPDATE command_room_agents SET connection_epoch = 2, updated_at = ? WHERE id = 'lead-1'",
    ).run('2026-08-30T00:01:00.000Z');
    expect(await repository.enqueueWake({
      id: 'wake-stale', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-1',
      eventKey: 'USER_WAKE:stale', reason: 'USER_WAKE',
      nextEligibleAt: '2026-08-30T00:01:00.000Z', createdAt: '2026-08-30T00:01:00.000Z',
    })).toEqual({ outcome: 'stale_epoch' });

    expect((await repository.replace('binding-1', '2026-08-30T00:01:01.000Z'))?.state).toBe('REPLACED');
    expect(await repository.getWake('wake-1')).toMatchObject({ state: 'CANCELLED', lastErrorCode: 'BINDING_REPLACED' });
    const epoch2 = await repository.createChallenge({
      id: 'binding-2', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 2, challengeHash: 'sha256:challenge-2', challengeExpiresAt: '2026-08-30T00:06:00.000Z',
      createdAt: '2026-08-30T00:01:02.000Z',
    });
    expect(epoch2.state).toBe('CHALLENGED');
    const paired2 = await repository.confirmPairing({
      bindingId: 'binding-2', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 2,
      challengeHash: 'sha256:challenge-2', extensionInstallationId: 'ext-random-1',
      encryptedConversationRef: 'ciphertext:v1:conversation-2', conversationRefFingerprint: 'hmac:conversation-2',
      confirmedAt: '2026-08-30T00:01:03.000Z',
    });
    expect(paired2.outcome).toBe('paired');

    database.close();

    const reopenedDatabase = new SqliteDatabase(filename);
    const reopened = new SqliteCommandRoomBindingRepository(reopenedDatabase);
    expect(await reopened.getActiveBinding('room-1', 'lead-1', 1)).toBeNull();
    expect(await reopened.getActiveBinding('room-1', 'lead-1', 2)).toMatchObject({
      id: 'binding-2', state: 'PAIRED', connectionEpoch: 2,
    });
    expect(await reopened.getWake('wake-1')).toMatchObject({ state: 'CANCELLED', attemptCount: 0, lastErrorCode: 'BINDING_REPLACED' });
    reopenedDatabase.close();
  });

  it('atomically moves one paired conversation to a new binding on the same epoch and preserves the old binding on failed confirmation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-binding-continuation-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomBindingRepository(database);

    await repository.createChallenge({
      id: 'binding-old', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 1, challengeHash: 'sha256:old', challengeExpiresAt: '2026-08-30T00:05:00.000Z', createdAt: NOW,
    });
    expect((await repository.confirmPairing({
      bindingId: 'binding-old', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:old', extensionInstallationId: 'extension-installation-1',
      encryptedConversationRef: 'ciphertext:v1:old', conversationRefFingerprint: 'hmac:old',
      confirmedAt: '2026-08-30T00:00:01.000Z',
    })).outcome).toBe('paired');

    await repository.createChallenge({
      id: 'binding-next', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 1, challengeHash: 'sha256:next', challengeExpiresAt: '2026-08-30T00:05:00.000Z',
      createdAt: '2026-08-30T00:00:02.000Z',
    });
    expect(await repository.getActiveBinding('room-1', 'lead-1', 1)).toMatchObject({ id: 'binding-old', state: 'PAIRED' });
    expect((await repository.getBinding('binding-next'))?.state).toBe('CHALLENGED');

    expect(await repository.confirmPairing({
      bindingId: 'binding-next', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:wrong', extensionInstallationId: 'extension-installation-1',
      encryptedConversationRef: 'ciphertext:v1:new', conversationRefFingerprint: 'hmac:new',
      confirmedAt: '2026-08-30T00:00:03.000Z',
    })).toEqual({ outcome: 'challenge_mismatch' });
    expect(await repository.getActiveBinding('room-1', 'lead-1', 1)).toMatchObject({ id: 'binding-old', state: 'PAIRED' });

    const moved = await repository.confirmPairing({
      bindingId: 'binding-next', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:next', extensionInstallationId: 'extension-installation-1',
      encryptedConversationRef: 'ciphertext:v1:new', conversationRefFingerprint: 'hmac:new',
      confirmedAt: '2026-08-30T00:00:04.000Z',
    });
    expect(moved).toMatchObject({ outcome: 'paired', binding: { id: 'binding-next', connectionEpoch: 1, state: 'PAIRED' } });
    expect(await repository.getActiveBinding('room-1', 'lead-1', 1)).toMatchObject({ id: 'binding-next', connectionEpoch: 1 });
    expect(await repository.getBinding('binding-old')).toMatchObject({ state: 'REPLACED', replacedAt: '2026-08-30T00:00:04.000Z' });
    database.close();
  });

  it('rejects an expired challenge without turning it into a paired binding', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-binding-expired-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomBindingRepository(database);

    await repository.createChallenge({
      id: 'expired-binding', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 1, challengeHash: 'sha256:expired', challengeExpiresAt: '2026-08-30T00:00:01.000Z',
      createdAt: NOW,
    });
    expect(await repository.confirmPairing({
      bindingId: 'expired-binding', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:expired', extensionInstallationId: 'ext-random-expired',
      encryptedConversationRef: 'ciphertext:v1:expired', conversationRefFingerprint: 'hmac:expired',
      confirmedAt: '2026-08-30T00:00:02.000Z',
    })).toEqual({ outcome: 'challenge_expired' });
    expect((await repository.getBinding('expired-binding'))?.state).toBe('CHALLENGED');
    database.close();
  });

  it('keeps delivered/submitted separate from task claim state and enforces the three-attempt budget', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-wake-state-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomBindingRepository(database);

    await repository.createChallenge({
      id: 'binding-wake', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 1, challengeHash: 'sha256:wake', challengeExpiresAt: '2026-08-30T00:05:00.000Z', createdAt: NOW,
    });
    const paired = await repository.confirmPairing({
      bindingId: 'binding-wake', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:wake', extensionInstallationId: 'ext-wake',
      encryptedConversationRef: 'ciphertext:v1:wake', conversationRefFingerprint: 'hmac:wake',
      confirmedAt: '2026-08-30T00:00:01.000Z',
    });
    expect(paired.outcome).toBe('paired');

    await repository.enqueueWake({
      id: 'wake-state', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-wake',
      eventKey: 'TASK_ASSIGNED:task-1', taskId: 'task-1', reason: 'TASK_ASSIGNED',
      nextEligibleAt: NOW, createdAt: NOW,
    });
    expect(await repository.beginWakeAttempt('wake-state', '2026-08-30T00:00:02.000Z', '2026-08-30T00:01:02.000Z'))
      .toMatchObject({ state: 'ATTEMPTING', attemptCount: 1 });
    expect(await repository.markWakeDelivered('wake-state', '2026-08-30T00:00:03.000Z'))
      .toMatchObject({ state: 'DELIVERED', attemptCount: 1 });

    expect(database.connection.prepare('SELECT state FROM command_room_tasks WHERE id = ?').get('task-1'))
      .toEqual({ state: 'QUEUED' });

    expect(await repository.markWakeSubmitted('wake-state', '2026-08-30T00:00:04.000Z'))
      .toMatchObject({ state: 'SUBMITTED', attemptCount: 1 });
    expect(database.connection.prepare('SELECT state FROM command_room_tasks WHERE id = ?').get('task-1'))
      .toEqual({ state: 'QUEUED' });

    await repository.enqueueWake({
      id: 'wake-failed', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-wake',
      eventKey: 'USER_WAKE:failed', reason: 'USER_WAKE', nextEligibleAt: NOW, createdAt: NOW,
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const attemptedAt = `2026-08-30T00:1${attempt}:00.000Z`;
      const retryAt = `2026-08-30T00:1${attempt}:59.000Z`;
      await repository.beginWakeAttempt('wake-failed', attemptedAt, retryAt);
      await repository.markWakeDelivered('wake-failed', attemptedAt);
      expect(await repository.markWakeAttemptFailed('wake-failed', attemptedAt, retryAt, 'DOM_MISMATCH')).toMatchObject({
        state: attempt === 3 ? 'DEAD_LETTER' : 'QUEUED',
        attemptCount: attempt,
        lastErrorCode: 'DOM_MISMATCH',
      });
    }

    await repository.enqueueWake({
      id: 'wake-budget', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-wake',
      eventKey: 'USER_WAKE:budget', reason: 'USER_WAKE', nextEligibleAt: NOW, createdAt: NOW,
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const at = `2026-08-30T00:0${attempt}:00.000Z`;
      expect(await repository.beginWakeAttempt('wake-budget', at, at)).toMatchObject({
        state: 'ATTEMPTING', attemptCount: attempt,
      });
      expect(await repository.markWakeDelivered('wake-budget', at)).toMatchObject({ state: 'DELIVERED' });
    }
    await expect(repository.beginWakeAttempt('wake-budget', '2026-08-30T00:04:00.000Z', '2026-08-30T00:05:00.000Z'))
      .rejects.toThrow('exhausted its attempt budget');
    expect(await repository.markWakeDeadLetter('wake-budget', '2026-08-30T00:04:01.000Z', 'ATTEMPT_LIMIT'))
      .toMatchObject({ state: 'DEAD_LETTER', attemptCount: 3, lastErrorCode: 'ATTEMPT_LIMIT' });

    await repository.enqueueWake({
      id: 'wake-revoke-pending', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-wake',
      eventKey: 'USER_WAKE:revoke-pending', reason: 'USER_WAKE', nextEligibleAt: NOW, createdAt: NOW,
    });
    expect((await repository.revoke('binding-wake', '2026-08-30T00:05:00.000Z'))?.state).toBe('REVOKED');
    expect(await repository.getWake('wake-revoke-pending')).toMatchObject({
      state: 'CANCELLED', lastErrorCode: 'BINDING_REVOKED',
    });
    expect(await repository.getWake('wake-state')).toMatchObject({ state: 'SUBMITTED' });

    database.close();
  });

  it('derives coalescing, hourly budgets, and unanswered submissions from persistent state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-wake-policy-'));
    cleanup.push(directory);
    const database = new SqliteDatabase(join(directory, 'nava.db'));
    seedCommandRoom(database);
    const repository = new SqliteCommandRoomBindingRepository(database);
    await repository.createChallenge({
      id: 'binding-policy', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 1, challengeHash: 'sha256:policy', challengeExpiresAt: '2026-08-30T00:05:00.000Z', createdAt: NOW,
    });
    expect((await repository.confirmPairing({
      bindingId: 'binding-policy', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 1,
      challengeHash: 'sha256:policy', extensionInstallationId: 'ext-policy',
      encryptedConversationRef: 'ciphertext:v1:policy', conversationRefFingerprint: 'hmac:policy',
      confirmedAt: '2026-08-30T00:00:01.000Z',
    })).outcome).toBe('paired');
    await repository.enqueueWake({
      id: 'wake-policy-1', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-policy',
      eventKey: 'TASK_ASSIGNED:policy-1', taskId: 'task-1', reason: 'TASK_ASSIGNED',
      nextEligibleAt: '2026-08-30T00:00:10.000Z', createdAt: '2026-08-30T00:00:10.000Z',
    });
    await repository.beginWakeAttempt('wake-policy-1', '2026-08-30T00:00:11.000Z', '2026-08-30T00:01:11.000Z');
    await repository.markWakeDelivered('wake-policy-1', '2026-08-30T00:00:12.000Z');
    await repository.markWakeSubmitted('wake-policy-1', '2026-08-30T00:00:13.000Z');

    const beforeHeartbeat = await repository.getWakePolicySnapshot({
      roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-policy',
      cooldownSince: '2026-08-29T23:59:30.000Z', hourlySince: '2026-08-29T23:00:30.000Z',
    });
    expect(beforeHeartbeat).toMatchObject({
      coalescedDelivery: { id: 'wake-policy-1', state: 'SUBMITTED' },
      bindingWakeCount: 1, roomWakeCount: 1, unansweredSubmittedCount: 1,
    });

    database.connection.prepare(
      "UPDATE command_room_agents SET last_heartbeat_at = ?, updated_at = ? WHERE id = 'lead-1'",
    ).run('2026-08-30T00:00:20.000Z', '2026-08-30T00:00:20.000Z');
    const afterHeartbeat = await repository.getWakePolicySnapshot({
      roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-policy',
      cooldownSince: '2026-08-30T00:01:00.000Z', hourlySince: '2026-08-29T23:01:00.000Z',
    });
    expect(afterHeartbeat).toMatchObject({
      coalescedDelivery: null, bindingWakeCount: 1, roomWakeCount: 1,
      unansweredSubmittedCount: 0, lastHeartbeatAt: '2026-08-30T00:00:20.000Z',
    });
    database.close();
  });
});

function seedCommandRoom(database: SqliteDatabase): void {
  const connection = database.connection;
  connection.prepare(
    "INSERT INTO command_rooms (id, name, status, policy_json, version, creation_key, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, 1, ?, ?, ?)",
  ).run('room-1', 'Phase 3 binding repository test', JSON.stringify({ directLeadMessaging: false }), 'create-room-1', NOW, NOW);
  for (const [id, slot] of [['main-1', 'MAIN'], ['lead-1', 'LEAD-1']] as const) {
    connection.prepare(
      "INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, connection_epoch, capabilities_json, created_at, updated_at) VALUES (?, 'room-1', ?, ?, 'CHATGPT', 'ONLINE', 1, '[]', ?, ?)",
    ).run(id, slot, slot === 'MAIN' ? 'MAIN' : 'LEAD', NOW, NOW);
  }
  connection.prepare(
    "INSERT INTO command_room_tasks (id, room_id, project_key, workspace_id, title, brief_json, mutation_mode, state, priority, assigned_agent_id, created_by_agent_id, version, created_at, updated_at) VALUES (?, 'room-1', 'project', 'workspace', ?, ?, 'READ_ONLY', 'QUEUED', 10, 'lead-1', 'main-1', 1, ?, ?)",
  ).run('task-1', 'task-1', JSON.stringify({ summary: 'task-1', acceptanceCriteria: [], evidenceRefs: [] }), NOW, NOW);
}

