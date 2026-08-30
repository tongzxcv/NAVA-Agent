import type {
  CommandRoomBindingRecord,
  CommandRoomProvider,
  CommandRoomWakeDeliveryRecord,
  CommandRoomWakeReason,
} from '@lnwjud/domain';
import type { SqliteDatabase } from './database.js';

export interface CreateCommandRoomPairingChallengeInput {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly slotKey: string;
  readonly provider: CommandRoomProvider;
  readonly connectionEpoch: number;
  readonly challengeHash: string;
  readonly challengeExpiresAt: string;
  readonly createdAt: string;
}

export interface ConfirmCommandRoomPairingInput {
  readonly bindingId: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly connectionEpoch: number;
  readonly challengeHash: string;
  readonly extensionInstallationId: string;
  readonly encryptedConversationRef: string;
  readonly conversationRefFingerprint: string;
  readonly confirmedAt: string;
}

export type ConfirmCommandRoomPairingResult =
  | { readonly outcome: 'paired'; readonly binding: CommandRoomBindingRecord }
  | { readonly outcome: 'not_found' | 'challenge_mismatch' | 'challenge_expired' | 'stale_epoch' | 'invalid_state' };

export interface EnqueueCommandRoomWakeInput {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly bindingId: string;
  readonly eventKey: string;
  readonly taskId?: string;
  readonly reason: CommandRoomWakeReason;
  readonly nextEligibleAt: string;
  readonly createdAt: string;
}

export type EnqueueCommandRoomWakeResult =
  | { readonly outcome: 'queued'; readonly duplicate: boolean; readonly delivery: CommandRoomWakeDeliveryRecord }
  | { readonly outcome: 'binding_not_active' | 'stale_epoch' | 'not_found' };

export interface CommandRoomWakePolicySnapshot {
  readonly coalescedDelivery: CommandRoomWakeDeliveryRecord | null;
  readonly bindingWakeCount: number;
  readonly roomWakeCount: number;
  readonly unansweredSubmittedCount: number;
  readonly lastHeartbeatAt?: string;
}

interface BindingRow {
  readonly id: string;
  readonly room_id: string;
  readonly agent_id: string;
  readonly slot_key: string;
  readonly provider: string;
  readonly extension_installation_id: string | null;
  readonly encrypted_conversation_ref: string | null;
  readonly conversation_ref_fingerprint: string | null;
  readonly connection_epoch: number;
  readonly state: string;
  readonly challenge_hash: string | null;
  readonly challenge_expires_at: string | null;
  readonly paired_at: string | null;
  readonly last_seen_at: string | null;
  readonly revoked_at: string | null;
  readonly replaced_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface WakeRow {
  readonly id: string;
  readonly room_id: string;
  readonly agent_id: string;
  readonly binding_id: string;
  readonly event_key: string;
  readonly task_id: string | null;
  readonly reason: string;
  readonly state: string;
  readonly attempt_count: number;
  readonly last_attempt_at: string | null;
  readonly next_eligible_at: string | null;
  readonly delivered_at: string | null;
  readonly submitted_at: string | null;
  readonly last_error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SqliteCommandRoomBindingRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async createChallenge(input: CreateCommandRoomPairingChallengeInput): Promise<CommandRoomBindingRecord> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const agent = connection.prepare(
        'SELECT slot_key, provider, connection_epoch FROM command_room_agents WHERE id = ? AND room_id = ?',
      ).get(input.agentId, input.roomId) as { slot_key?: unknown; provider?: unknown; connection_epoch?: unknown } | undefined;
      if (agent === undefined || agent.slot_key !== input.slotKey) throw new Error('Command Room pairing agent/slot was not found.');
      if (agent.connection_epoch !== input.connectionEpoch) throw new Error('Command Room pairing connection epoch is stale.');

      connection.prepare(`
        UPDATE command_room_bindings
        SET state = 'REPLACED', replaced_at = ?, challenge_hash = NULL, challenge_expires_at = NULL, updated_at = ?
        WHERE room_id = ? AND agent_id = ? AND connection_epoch = ? AND state = 'CHALLENGED'
      `).run(input.createdAt, input.createdAt, input.roomId, input.agentId, input.connectionEpoch);

      connection.prepare(`
        INSERT INTO command_room_bindings (
          id, room_id, agent_id, slot_key, provider, connection_epoch, state,
          challenge_hash, challenge_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CHALLENGED', ?, ?, ?, ?)
      `).run(
        input.id, input.roomId, input.agentId, input.slotKey, input.provider,
        input.connectionEpoch, input.challengeHash, input.challengeExpiresAt,
        input.createdAt, input.createdAt,
      );
      connection.exec('COMMIT;');
      return this.requireBinding(input.id);
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async confirmPairing(input: ConfirmCommandRoomPairingInput): Promise<ConfirmCommandRoomPairingResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const binding = toBinding(connection.prepare(bindingSelect('WHERE id = ? AND room_id = ? AND agent_id = ?')).get(
        input.bindingId, input.roomId, input.agentId,
      ));
      if (binding === null) return rollbackResult(connection, { outcome: 'not_found' as const });
      if (binding.state !== 'CHALLENGED') return rollbackResult(connection, { outcome: 'invalid_state' as const });
      if (binding.connectionEpoch !== input.connectionEpoch) return rollbackResult(connection, { outcome: 'stale_epoch' as const });
      if (binding.challengeHash !== input.challengeHash) return rollbackResult(connection, { outcome: 'challenge_mismatch' as const });
      if (binding.challengeExpiresAt === undefined || binding.challengeExpiresAt < input.confirmedAt) {
        return rollbackResult(connection, { outcome: 'challenge_expired' as const });
      }
      const currentEpoch = connection.prepare(
        'SELECT connection_epoch FROM command_room_agents WHERE id = ? AND room_id = ?',
      ).get(input.agentId, input.roomId) as { connection_epoch?: unknown } | undefined;
      if (currentEpoch?.connection_epoch !== input.connectionEpoch) {
        return rollbackResult(connection, { outcome: 'stale_epoch' as const });
      }

      connection.prepare(`
        UPDATE command_room_bindings
        SET state = 'PAIRED', extension_installation_id = ?, encrypted_conversation_ref = ?,
            conversation_ref_fingerprint = ?, challenge_hash = NULL, challenge_expires_at = NULL,
            paired_at = ?, last_seen_at = ?, updated_at = ?
        WHERE id = ? AND state = 'CHALLENGED'
      `).run(
        input.extensionInstallationId, input.encryptedConversationRef, input.conversationRefFingerprint,
        input.confirmedAt, input.confirmedAt, input.confirmedAt, input.bindingId,
      );
      connection.exec('COMMIT;');
      return { outcome: 'paired', binding: this.requireBinding(input.bindingId) };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async getActiveBinding(roomId: string, agentId: string, connectionEpoch: number): Promise<CommandRoomBindingRecord | null> {
    return toBinding(this.database.connection.prepare(bindingSelect(
      "WHERE room_id = ? AND agent_id = ? AND connection_epoch = ? AND state = 'PAIRED'",
    )).get(roomId, agentId, connectionEpoch));
  }

  public async getWakePolicySnapshot(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly bindingId: string;
    readonly cooldownSince: string;
    readonly hourlySince: string;
  }): Promise<CommandRoomWakePolicySnapshot> {
    const connection = this.database.connection;
    const coalescedDelivery = toWake(connection.prepare(wakeSelect(
      "WHERE binding_id = ? AND (state IN ('QUEUED', 'ATTEMPTING', 'DELIVERED') OR (state = 'SUBMITTED' AND updated_at >= ?)) ORDER BY updated_at DESC LIMIT 1",
    )).get(input.bindingId, input.cooldownSince));
    const bindingCountRow = connection.prepare(
      'SELECT COUNT(*) AS count FROM command_room_wake_deliveries WHERE binding_id = ? AND created_at >= ?',
    ).get(input.bindingId, input.hourlySince) as { count?: unknown } | undefined;
    const roomCountRow = connection.prepare(
      'SELECT COUNT(*) AS count FROM command_room_wake_deliveries WHERE room_id = ? AND created_at >= ?',
    ).get(input.roomId, input.hourlySince) as { count?: unknown } | undefined;
    const agentRow = connection.prepare(
      'SELECT last_heartbeat_at FROM command_room_agents WHERE id = ? AND room_id = ?',
    ).get(input.agentId, input.roomId) as { last_heartbeat_at?: unknown } | undefined;
    const bindingRow = connection.prepare(
      'SELECT paired_at FROM command_room_bindings WHERE id = ? AND room_id = ? AND agent_id = ?',
    ).get(input.bindingId, input.roomId, input.agentId) as { paired_at?: unknown } | undefined;
    const lastHeartbeatAt = typeof agentRow?.last_heartbeat_at === 'string' ? agentRow.last_heartbeat_at : undefined;
    const pairedAt = typeof bindingRow?.paired_at === 'string' ? bindingRow.paired_at : input.hourlySince;
    const unansweredSince = lastHeartbeatAt !== undefined && lastHeartbeatAt > pairedAt ? lastHeartbeatAt : pairedAt;
    const unansweredRow = connection.prepare(`
      SELECT COUNT(*) AS count FROM command_room_wake_deliveries
      WHERE binding_id = ? AND state = 'SUBMITTED' AND submitted_at IS NOT NULL AND submitted_at > ?
    `).get(input.bindingId, unansweredSince) as { count?: unknown } | undefined;
    return {
      coalescedDelivery,
      bindingWakeCount: numericCount(bindingCountRow?.count),
      roomWakeCount: numericCount(roomCountRow?.count),
      unansweredSubmittedCount: numericCount(unansweredRow?.count),
      ...(lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt }),
    };
  }

  public async revoke(bindingId: string, revokedAt: string): Promise<CommandRoomBindingRecord | null> {
    const connection = this.database.connection;
    connection.prepare(`
      UPDATE command_room_bindings
      SET state = 'REVOKED', revoked_at = ?, challenge_hash = NULL, challenge_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state IN ('CHALLENGED', 'PAIRED', 'STALE')
    `).run(revokedAt, revokedAt, bindingId);
    return this.getBinding(bindingId);
  }

  public async replace(bindingId: string, replacedAt: string): Promise<CommandRoomBindingRecord | null> {
    const connection = this.database.connection;
    connection.prepare(`
      UPDATE command_room_bindings
      SET state = 'REPLACED', replaced_at = ?, challenge_hash = NULL, challenge_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state IN ('CHALLENGED', 'PAIRED', 'STALE')
    `).run(replacedAt, replacedAt, bindingId);
    return this.getBinding(bindingId);
  }

  public async touch(bindingId: string, seenAt: string): Promise<CommandRoomBindingRecord | null> {
    this.database.connection.prepare(
      "UPDATE command_room_bindings SET last_seen_at = ?, updated_at = ? WHERE id = ? AND state = 'PAIRED'",
    ).run(seenAt, seenAt, bindingId);
    return this.getBinding(bindingId);
  }

  public async getBinding(bindingId: string): Promise<CommandRoomBindingRecord | null> {
    return toBinding(this.database.connection.prepare(bindingSelect('WHERE id = ?')).get(bindingId));
  }

  public async enqueueWake(input: EnqueueCommandRoomWakeInput): Promise<EnqueueCommandRoomWakeResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const binding = toBinding(connection.prepare(bindingSelect('WHERE id = ? AND room_id = ? AND agent_id = ?')).get(
        input.bindingId, input.roomId, input.agentId,
      ));
      if (binding === null) return rollbackResult(connection, { outcome: 'not_found' as const });
      if (binding.state !== 'PAIRED') return rollbackResult(connection, { outcome: 'binding_not_active' as const });
      const currentEpoch = connection.prepare(
        'SELECT connection_epoch FROM command_room_agents WHERE id = ? AND room_id = ?',
      ).get(input.agentId, input.roomId) as { connection_epoch?: unknown } | undefined;
      if (currentEpoch?.connection_epoch !== binding.connectionEpoch) {
        return rollbackResult(connection, { outcome: 'stale_epoch' as const });
      }

      const existing = toWake(connection.prepare(wakeSelect('WHERE binding_id = ? AND event_key = ?')).get(
        input.bindingId, input.eventKey,
      ));
      if (existing !== null) {
        connection.exec('ROLLBACK;');
        return { outcome: 'queued', duplicate: true, delivery: existing };
      }

      connection.prepare(`
        INSERT INTO command_room_wake_deliveries (
          id, room_id, agent_id, binding_id, event_key, task_id, reason, state,
          attempt_count, next_eligible_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?, ?)
      `).run(
        input.id, input.roomId, input.agentId, input.bindingId, input.eventKey,
        input.taskId ?? null, input.reason, input.nextEligibleAt, input.createdAt, input.createdAt,
      );
      connection.exec('COMMIT;');
      const delivery = await this.getWake(input.id);
      if (delivery === null) throw new Error('Command Room wake insert was not readable after commit.');
      return { outcome: 'queued', duplicate: false, delivery };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async beginWakeAttempt(id: string, attemptedAt: string, nextEligibleAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    const connection = this.database.connection;
    const current = toWake(connection.prepare(wakeSelect('WHERE id = ?')).get(id));
    if (current === null) return null;
    if (!['QUEUED', 'DELIVERED'].includes(current.state)) throw new Error(`Wake ${id} cannot start an attempt from ${current.state}.`);
    if (current.attemptCount >= 3) throw new Error(`Wake ${id} exhausted its attempt budget.`);
    connection.prepare(`
      UPDATE command_room_wake_deliveries
      SET state = 'ATTEMPTING', attempt_count = attempt_count + 1, last_attempt_at = ?,
          next_eligible_at = ?, updated_at = ?
      WHERE id = ?
    `).run(attemptedAt, nextEligibleAt, attemptedAt, id);
    return this.getWake(id);
  }

  public async markWakeDelivered(id: string, deliveredAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    const connection = this.database.connection;
    const current = await this.getWake(id);
    if (current === null) return null;
    if (current.state !== 'ATTEMPTING') throw new Error(`Wake ${id} cannot be delivered from ${current.state}.`);
    connection.prepare(`
      UPDATE command_room_wake_deliveries
      SET state = 'DELIVERED', delivered_at = ?, updated_at = ?
      WHERE id = ?
    `).run(deliveredAt, deliveredAt, id);
    return this.getWake(id);
  }

  public async markWakeSubmitted(id: string, submittedAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    const connection = this.database.connection;
    const current = await this.getWake(id);
    if (current === null) return null;
    if (current.state !== 'DELIVERED') throw new Error(`Wake ${id} cannot be submitted from ${current.state}.`);
    connection.prepare(`
      UPDATE command_room_wake_deliveries
      SET state = 'SUBMITTED', submitted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(submittedAt, submittedAt, id);
    return this.getWake(id);
  }

  public async markWakeManualFallback(id: string, occurredAt: string, errorCode?: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    const connection = this.database.connection;
    const current = await this.getWake(id);
    if (current === null) return null;
    if (['SUBMITTED', 'DEAD_LETTER', 'CANCELLED', 'MANUAL_FALLBACK'].includes(current.state)) {
      throw new Error(`Wake ${id} cannot enter manual fallback from ${current.state}.`);
    }
    connection.prepare(`
      UPDATE command_room_wake_deliveries
      SET state = 'MANUAL_FALLBACK', last_error_code = ?, updated_at = ?
      WHERE id = ?
    `).run(errorCode ?? null, occurredAt, id);
    return this.getWake(id);
  }

  public async markWakeDeadLetter(id: string, occurredAt: string, errorCode?: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    const connection = this.database.connection;
    const current = await this.getWake(id);
    if (current === null) return null;
    if (current.state === 'SUBMITTED' || current.state === 'CANCELLED') {
      throw new Error(`Wake ${id} cannot enter dead letter from ${current.state}.`);
    }
    connection.prepare(`
      UPDATE command_room_wake_deliveries
      SET state = 'DEAD_LETTER', last_error_code = ?, updated_at = ?
      WHERE id = ?
    `).run(errorCode ?? null, occurredAt, id);
    return this.getWake(id);
  }

  public async listRecoverableWakes(now: string, limit = 100): Promise<readonly CommandRoomWakeDeliveryRecord[]> {
    return this.database.connection.prepare(`${wakeSelect(
      "WHERE state IN ('QUEUED', 'ATTEMPTING', 'DELIVERED') AND (next_eligible_at IS NULL OR next_eligible_at <= ?)",
    )} ORDER BY created_at ASC LIMIT ?`).all(now, Math.max(1, Math.min(limit, 100))).flatMap((row) => {
      const wake = toWake(row);
      return wake === null ? [] : [wake];
    });
  }
  public async listRecoverableWakesForBinding(bindingId: string, now: string, limit = 50): Promise<readonly CommandRoomWakeDeliveryRecord[]> {
    return this.database.connection.prepare(`${wakeSelect(
      "WHERE binding_id = ? AND state IN ('QUEUED', 'ATTEMPTING', 'DELIVERED') AND (next_eligible_at IS NULL OR next_eligible_at <= ?)",
    )} ORDER BY created_at ASC LIMIT ?`).all(bindingId, now, Math.max(1, Math.min(limit, 50))).flatMap((row) => {
      const wake = toWake(row);
      return wake === null ? [] : [wake];
    });
  }

  public async getWake(id: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    return toWake(this.database.connection.prepare(wakeSelect('WHERE id = ?')).get(id));
  }

  private requireBinding(id: string): CommandRoomBindingRecord {
    const binding = toBinding(this.database.connection.prepare(bindingSelect('WHERE id = ?')).get(id));
    if (binding === null) throw new Error(`Command Room binding was not found after mutation: ${id}`);
    return binding;
  }
}

function bindingSelect(where: string): string {
  return `SELECT id, room_id, agent_id, slot_key, provider, extension_installation_id, encrypted_conversation_ref,
    conversation_ref_fingerprint, connection_epoch, state, challenge_hash, challenge_expires_at, paired_at,
    last_seen_at, revoked_at, replaced_at, created_at, updated_at FROM command_room_bindings ${where}`;
}

function wakeSelect(where: string): string {
  return `SELECT id, room_id, agent_id, binding_id, event_key, task_id, reason, state, attempt_count,
    last_attempt_at, next_eligible_at, delivered_at, submitted_at, last_error_code, created_at, updated_at
    FROM command_room_wake_deliveries ${where}`;
}

function toBinding(value: unknown): CommandRoomBindingRecord | null {
  if (!isObject(value)) return null;
  const row = value as unknown as BindingRow;
  return {
    id: row.id,
    roomId: row.room_id,
    agentId: row.agent_id,
    slotKey: row.slot_key,
    provider: row.provider as CommandRoomProvider,
    ...(row.extension_installation_id === null ? {} : { extensionInstallationId: row.extension_installation_id }),
    ...(row.encrypted_conversation_ref === null ? {} : { encryptedConversationRef: row.encrypted_conversation_ref }),
    ...(row.conversation_ref_fingerprint === null ? {} : { conversationRefFingerprint: row.conversation_ref_fingerprint }),
    connectionEpoch: row.connection_epoch,
    state: row.state as CommandRoomBindingRecord['state'],
    ...(row.challenge_hash === null ? {} : { challengeHash: row.challenge_hash }),
    ...(row.challenge_expires_at === null ? {} : { challengeExpiresAt: row.challenge_expires_at }),
    ...(row.paired_at === null ? {} : { pairedAt: row.paired_at }),
    ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    ...(row.replaced_at === null ? {} : { replacedAt: row.replaced_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWake(value: unknown): CommandRoomWakeDeliveryRecord | null {
  if (!isObject(value)) return null;
  const row = value as unknown as WakeRow;
  return {
    id: row.id,
    roomId: row.room_id,
    agentId: row.agent_id,
    bindingId: row.binding_id,
    eventKey: row.event_key,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    reason: row.reason as CommandRoomWakeReason,
    state: row.state as CommandRoomWakeDeliveryRecord['state'],
    attemptCount: row.attempt_count,
    ...(row.last_attempt_at === null ? {} : { lastAttemptAt: row.last_attempt_at }),
    ...(row.next_eligible_at === null ? {} : { nextEligibleAt: row.next_eligible_at }),
    ...(row.delivered_at === null ? {} : { deliveredAt: row.delivered_at }),
    ...(row.submitted_at === null ? {} : { submittedAt: row.submitted_at }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rollback(connection: SqliteDatabase['connection']): void {
  try {
    connection.exec('ROLLBACK;');
  } catch {
    // Transaction may already be closed by a failed SQLite statement.
  }
}

function rollbackResult<T>(connection: SqliteDatabase['connection'], result: T): T {
  connection.exec('ROLLBACK;');
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numericCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

