import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from './database.js';

const cleanup: string[] = [];
const NOW = '2026-08-30T00:00:00.000Z';

describe('command room migration 007', () => {
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('creates bounded pairing/wake state and recovers it after reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nava-command-room-binding-'));
    cleanup.push(directory);
    const filename = join(directory, 'nava.db');

    const first = new SqliteDatabase(filename);
    seedCommandRoom(first);

    expect(first.connection.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('007_command_room_bindings'))
      .toEqual({ id: '007_command_room_bindings' });

    expect(() => first.connection.prepare(`
      INSERT INTO command_room_bindings (
        id, room_id, agent_id, slot_key, provider, connection_epoch, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'CHALLENGED', ?, ?)
    `).run('invalid-challenge', 'room-1', 'lead-1', 'LEAD-1', 'CHATGPT', 1, NOW, NOW)).toThrow();

    first.connection.prepare(`
      INSERT INTO command_room_bindings (
        id, room_id, agent_id, slot_key, provider, connection_epoch, state,
        challenge_hash, challenge_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'CHALLENGED', ?, ?, ?, ?)
    `).run(
      'binding-1', 'room-1', 'lead-1', 'LEAD-1', 'CHATGPT', 1,
      'sha256:pairing-hash-only', '2026-08-30T00:05:00.000Z', NOW, NOW,
    );

    first.connection.prepare(`
      UPDATE command_room_bindings
      SET state = 'PAIRED', extension_installation_id = ?, encrypted_conversation_ref = ?,
          conversation_ref_fingerprint = ?, paired_at = ?, challenge_hash = NULL,
          challenge_expires_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      'ext-install-random-1', 'ciphertext:v1:test', 'hmac:conversation-1',
      '2026-08-30T00:00:10.000Z', '2026-08-30T00:00:10.000Z', 'binding-1',
    );

    expect(() => first.connection.prepare(`
      INSERT INTO command_room_bindings (
        id, room_id, agent_id, slot_key, provider, extension_installation_id,
        encrypted_conversation_ref, conversation_ref_fingerprint, connection_epoch,
        state, paired_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAIRED', ?, ?, ?)
    `).run(
      'duplicate-slot-epoch', 'room-1', 'lead-1', 'LEAD-1', 'CHATGPT',
      'ext-install-random-2', 'ciphertext:v1:other', 'hmac:conversation-2', 1,
      NOW, NOW, NOW,
    )).toThrow();

    expect(() => first.connection.prepare(`
      INSERT INTO command_room_bindings (
        id, room_id, agent_id, slot_key, provider, extension_installation_id,
        encrypted_conversation_ref, conversation_ref_fingerprint, connection_epoch,
        state, paired_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAIRED', ?, ?, ?)
    `).run(
      'duplicate-conversation', 'room-1', 'lead-2', 'LEAD-2', 'CHATGPT',
      'ext-install-random-1', 'ciphertext:v1:same-conversation', 'hmac:conversation-1', 1,
      NOW, NOW, NOW,
    )).toThrow();

    first.connection.prepare(`
      INSERT INTO command_room_wake_deliveries (
        id, room_id, agent_id, binding_id, event_key, task_id, reason, state,
        attempt_count, next_eligible_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?, ?)
    `).run(
      'wake-1', 'room-1', 'lead-1', 'binding-1', 'TASK_ASSIGNED:task-1', 'task-1',
      'TASK_ASSIGNED', NOW, NOW, NOW,
    );

    expect(() => first.connection.prepare(
      'UPDATE command_room_wake_deliveries SET attempt_count = 4 WHERE id = ?',
    ).run('wake-1')).toThrow();

    first.close();

    const reopened = new SqliteDatabase(filename);
    expect(reopened.connection.prepare(`
      SELECT state, connection_epoch, extension_installation_id, conversation_ref_fingerprint
      FROM command_room_bindings WHERE id = ?
    `).get('binding-1')).toEqual({
      state: 'PAIRED',
      connection_epoch: 1,
      extension_installation_id: 'ext-install-random-1',
      conversation_ref_fingerprint: 'hmac:conversation-1',
    });
    expect(reopened.connection.prepare(
      'SELECT state, attempt_count, reason FROM command_room_wake_deliveries WHERE id = ?',
    ).get('wake-1')).toEqual({ state: 'QUEUED', attempt_count: 0, reason: 'TASK_ASSIGNED' });
    reopened.close();
  });
});

function seedCommandRoom(database: SqliteDatabase): void {
  const connection = database.connection;
  connection.prepare(
    "INSERT INTO command_rooms (id, name, status, policy_json, version, creation_key, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, 1, ?, ?, ?)",
  ).run('room-1', 'Phase 3 migration test', JSON.stringify({ directLeadMessaging: false }), 'create-room-1', NOW, NOW);

  for (const [id, slot] of [['main-1', 'MAIN'], ['lead-1', 'LEAD-1'], ['lead-2', 'LEAD-2']] as const) {
    connection.prepare(
      "INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, connection_epoch, capabilities_json, created_at, updated_at) VALUES (?, 'room-1', ?, ?, 'CHATGPT', 'ONLINE', 1, '[]', ?, ?)",
    ).run(id, slot, slot === 'MAIN' ? 'MAIN' : 'LEAD', NOW, NOW);
  }

  connection.prepare(
    "INSERT INTO command_room_tasks (id, room_id, project_key, workspace_id, title, brief_json, mutation_mode, state, priority, assigned_agent_id, created_by_agent_id, version, created_at, updated_at) VALUES (?, 'room-1', 'project', 'workspace', ?, ?, 'READ_ONLY', 'QUEUED', 10, 'lead-1', 'main-1', 1, ?, ?)",
  ).run('task-1', 'task-1', JSON.stringify({ summary: 'task-1', acceptanceCriteria: [], evidenceRefs: [] }), NOW, NOW);
}
