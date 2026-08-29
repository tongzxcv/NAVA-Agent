import { randomUUID } from 'node:crypto';
import type {
  CommandRoomResourceLeaseRecord,
  CommandRoomResourceRecord,
  CommandRoomResourceRequestState,
} from '@lnwjud/domain';
import type { SqliteDatabase } from './database.js';

export interface CommandRoomResourceStatus {
  readonly resources: readonly (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number })[];
  readonly leases: readonly CommandRoomResourceLeaseRecord[];
  readonly queueDepth: number;
}

export interface CommandRoomResourceRequestInput {
  readonly resourceKey: string;
  readonly roomId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly units: number;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly ttlSeconds: number;
}

export interface CommandRoomResourceRequestResult {
  readonly state: Extract<CommandRoomResourceRequestState, 'QUEUED' | 'GRANTED'>;
  readonly duplicate: boolean;
  readonly requestId: string;
  readonly queuePosition?: number;
  readonly lease?: CommandRoomResourceLeaseRecord;
}

export class SqliteCommandRoomResourceRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async status(input: { readonly roomId?: string; readonly now: string }): Promise<CommandRoomResourceStatus> {
    this.cleanupExpired(input.now);
    const connection = this.database.connection;
    const resources = connection.prepare(
      `SELECT r.resource_key, r.kind, r.capacity, r.enabled, r.policy_json,
        COALESCE(SUM(CASE WHEN l.expires_at > ? THEN l.units ELSE 0 END), 0) AS used_units
       FROM command_room_resources r
       LEFT JOIN command_room_resource_leases l ON l.resource_key = r.resource_key
       GROUP BY r.resource_key
       ORDER BY r.resource_key`,
    ).all(input.now).flatMap(resourceRows);

    const leases = input.roomId === undefined
      ? connection.prepare(resourceLeaseSelect('WHERE expires_at > ? ORDER BY resource_key, acquired_at')).all(input.now)
      : connection.prepare(resourceLeaseSelect('WHERE room_id = ? AND expires_at > ? ORDER BY resource_key, acquired_at')).all(input.roomId, input.now);
    const queueRow = input.roomId === undefined
      ? connection.prepare("SELECT COUNT(*) AS count FROM command_room_resource_requests WHERE state = 'QUEUED'").get()
      : connection.prepare("SELECT COUNT(*) AS count FROM command_room_resource_requests WHERE room_id = ? AND state = 'QUEUED'").get(input.roomId);

    return {
      resources,
      leases: leases.flatMap(resourceLeaseRows),
      queueDepth: countValue(queueRow),
    };
  }

  public async request(input: CommandRoomResourceRequestInput): Promise<CommandRoomResourceRequestResult> {
    validateRequest(input);
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      cleanupExpiredInTransaction(connection, input.requestedAt);
      const resource = toResource(connection.prepare(
        'SELECT resource_key, kind, capacity, enabled, policy_json, 0 AS used_units FROM command_room_resources WHERE resource_key = ?',
      ).get(input.resourceKey));
      if (resource === null || !resource.enabled) throw new Error(`Command Room resource is unavailable: ${input.resourceKey}`);
      if (input.units > resource.capacity) throw new Error(`Requested units exceed resource capacity: ${resource.capacity}`);

      const existing = toRequest(connection.prepare(
        'SELECT request_id, resource_key, room_id, task_id, agent_id, units, priority, idempotency_key, state, lease_id, requested_at, updated_at FROM command_room_resource_requests WHERE agent_id = ? AND idempotency_key = ?',
      ).get(input.agentId, input.idempotencyKey));
      if (existing !== null && (existing.resourceKey !== input.resourceKey || existing.roomId !== input.roomId || existing.taskId !== input.taskId || existing.units !== input.units)) {
        throw new Error('Resource idempotency key was already used with different input');
      }

      const requestId = existing?.requestId ?? randomUUID();
      if (existing === null) {
        connection.prepare(
          "INSERT INTO command_room_resource_requests (request_id, resource_key, room_id, task_id, agent_id, units, priority, idempotency_key, state, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)",
        ).run(requestId, input.resourceKey, input.roomId, input.taskId, input.agentId, input.units, input.priority, input.idempotencyKey, input.requestedAt, input.requestedAt);
      } else if (existing.state === 'GRANTED' && existing.leaseId !== undefined) {
        const lease = toResourceLease(connection.prepare(resourceLeaseSelect('WHERE lease_id = ? AND expires_at > ?')).get(existing.leaseId, input.requestedAt));
        if (lease !== null) {
          connection.exec('COMMIT;');
          return { state: 'GRANTED', duplicate: true, requestId, lease };
        }
        connection.prepare("UPDATE command_room_resource_requests SET state = 'QUEUED', lease_id = NULL, updated_at = ? WHERE request_id = ?").run(input.requestedAt, requestId);
      } else if (existing.state !== 'QUEUED') {
        throw new Error('Resource request is already closed; use a new idempotency key');
      }

      const head = toRequest(connection.prepare(
        `SELECT request_id, resource_key, room_id, task_id, agent_id, units, priority, idempotency_key, state, lease_id, requested_at, updated_at
         FROM command_room_resource_requests
         WHERE resource_key = ? AND state = 'QUEUED'
         ORDER BY (priority + CAST(((julianday(?) - julianday(requested_at)) * 86400) / 300 AS INTEGER)) DESC, requested_at ASC, request_id ASC
         LIMIT 1`,
      ).get(input.resourceKey, input.requestedAt));
      const used = countValue(connection.prepare(
        'SELECT COALESCE(SUM(units), 0) AS count FROM command_room_resource_leases WHERE resource_key = ? AND expires_at > ?',
      ).get(input.resourceKey, input.requestedAt));

      if (head?.requestId === requestId && used + input.units <= resource.capacity) {
        const lease: CommandRoomResourceLeaseRecord = {
          leaseId: randomUUID(),
          resourceKey: input.resourceKey,
          owner: { roomId: input.roomId, taskId: input.taskId, agentId: input.agentId },
          units: input.units,
          acquiredAt: input.requestedAt,
          heartbeatAt: input.requestedAt,
          expiresAt: addSeconds(input.requestedAt, input.ttlSeconds),
        };
        connection.prepare(
          'INSERT INTO command_room_resource_leases (lease_id, resource_key, room_id, task_id, agent_id, units, acquired_at, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(lease.leaseId, lease.resourceKey, lease.owner.roomId, lease.owner.taskId, lease.owner.agentId, lease.units, lease.acquiredAt, lease.heartbeatAt, lease.expiresAt);
        connection.prepare("UPDATE command_room_resource_requests SET state = 'GRANTED', lease_id = ?, updated_at = ? WHERE request_id = ?")
          .run(lease.leaseId, input.requestedAt, requestId);
        connection.exec('COMMIT;');
        return { state: 'GRANTED', duplicate: existing !== null, requestId, lease };
      }

      const queuePosition = queuePositionFor(connection, input.resourceKey, requestId, input.requestedAt);
      connection.exec('COMMIT;');
      return { state: 'QUEUED', duplicate: existing !== null, requestId, queuePosition };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async renew(input: { readonly leaseId: string; readonly agentId: string; readonly renewedAt: string; readonly ttlSeconds: number }): Promise<CommandRoomResourceLeaseRecord> {
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 3600) throw new Error('ttlSeconds must be an integer between 30 and 3600');
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      cleanupExpiredInTransaction(connection, input.renewedAt);
      const updated = connection.prepare(
        'UPDATE command_room_resource_leases SET heartbeat_at = ?, expires_at = ? WHERE lease_id = ? AND agent_id = ?',
      ).run(input.renewedAt, addSeconds(input.renewedAt, input.ttlSeconds), input.leaseId, input.agentId);
      if (updated.changes !== 1) throw new Error('Command Room resource lease was not found or is not owned by this agent');
      const lease = toResourceLease(connection.prepare(resourceLeaseSelect('WHERE lease_id = ?')).get(input.leaseId));
      if (lease === null) throw new Error('Command Room resource lease could not be reloaded');
      connection.exec('COMMIT;');
      return lease;
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async release(input: { readonly leaseId: string; readonly agentId: string; readonly releasedAt: string }): Promise<{ readonly released: boolean }> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const lease = toResourceLease(connection.prepare(resourceLeaseSelect('WHERE lease_id = ? AND agent_id = ?')).get(input.leaseId, input.agentId));
      if (lease === null) {
        connection.exec('COMMIT;');
        return { released: false };
      }
      connection.prepare("UPDATE command_room_resource_requests SET state = 'RELEASED', updated_at = ? WHERE lease_id = ?").run(input.releasedAt, input.leaseId);
      connection.prepare('DELETE FROM command_room_resource_leases WHERE lease_id = ?').run(input.leaseId);
      connection.exec('COMMIT;');
      return { released: true };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async releaseForTask(roomId: string, taskId: string, releasedAt: string): Promise<number> {
    return this.releaseWhere('room_id = ? AND task_id = ?', [roomId, taskId], releasedAt);
  }

  public async releaseForAgent(roomId: string, agentId: string, releasedAt: string): Promise<number> {
    return this.releaseWhere('room_id = ? AND agent_id = ?', [roomId, agentId], releasedAt);
  }

  public async releaseForRoom(roomId: string, releasedAt: string): Promise<number> {
    return this.releaseWhere('room_id = ?', [roomId], releasedAt);
  }

  private async releaseWhere(where: string, values: readonly string[], releasedAt: string): Promise<number> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const rows = connection.prepare(`SELECT lease_id FROM command_room_resource_leases WHERE ${where}`).all(...values);
      const leaseIds = rows.flatMap((row) => isRecord(row) && typeof row.lease_id === 'string' ? [row.lease_id] : []);
      for (const leaseId of leaseIds) {
        connection.prepare("UPDATE command_room_resource_requests SET state = 'RELEASED', updated_at = ? WHERE lease_id = ?").run(releasedAt, leaseId);
        connection.prepare('DELETE FROM command_room_resource_leases WHERE lease_id = ?').run(leaseId);
      }
      connection.exec('COMMIT;');
      return leaseIds.length;
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  private cleanupExpired(now: string): void {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      cleanupExpiredInTransaction(connection, now);
      connection.exec('COMMIT;');
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }
}

function validateRequest(input: CommandRoomResourceRequestInput): void {
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error('units must be a positive integer');
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100) throw new Error('priority must be an integer between 0 and 100');
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 3600) throw new Error('ttlSeconds must be an integer between 30 and 3600');
  if (input.idempotencyKey.trim().length === 0) throw new Error('idempotencyKey is required');
}

function cleanupExpiredInTransaction(connection: SqliteDatabase['connection'], now: string): void {
  connection.prepare(
    "UPDATE command_room_resource_requests SET state = 'RELEASED', updated_at = ? WHERE state = 'GRANTED' AND lease_id IN (SELECT lease_id FROM command_room_resource_leases WHERE expires_at <= ?)",
  ).run(now, now);
  connection.prepare('DELETE FROM command_room_resource_leases WHERE expires_at <= ?').run(now);
}

function queuePositionFor(connection: SqliteDatabase['connection'], resourceKey: string, requestId: string, now: string): number {
  const rows = connection.prepare(
    `SELECT request_id FROM command_room_resource_requests
     WHERE resource_key = ? AND state = 'QUEUED'
     ORDER BY (priority + CAST(((julianday(?) - julianday(requested_at)) * 86400) / 300 AS INTEGER)) DESC, requested_at ASC, request_id ASC`,
  ).all(resourceKey, now);
  const index = rows.findIndex((row) => isRecord(row) && row.request_id === requestId);
  return index < 0 ? 0 : index + 1;
}

function resourceLeaseSelect(suffix: string): string {
  return `SELECT lease_id, resource_key, room_id, task_id, agent_id, units, acquired_at, heartbeat_at, expires_at FROM command_room_resource_leases ${suffix}`;
}

function toResource(value: unknown): (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number }) | null {
  if (!isRecord(value)
    || typeof value.resource_key !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.capacity !== 'number'
    || typeof value.enabled !== 'number'
    || typeof value.policy_json !== 'string'
    || typeof value.used_units !== 'number') return null;
  if (!['MT5_TERMINAL', 'CPU_HEAVY', 'VPS_WRITER', 'MANAGED_BROWSER_WRITER', 'GPU_HEAVY'].includes(value.kind)) return null;
  const policy = parseObject(value.policy_json);
  if (policy === null) return null;
  return {
    resourceKey: value.resource_key,
    kind: value.kind as CommandRoomResourceRecord['kind'],
    capacity: value.capacity,
    enabled: value.enabled === 1,
    policy,
    usedUnits: value.used_units,
    availableUnits: Math.max(0, value.capacity - value.used_units),
  };
}

function resourceRows(value: unknown): readonly (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number })[] {
  const resource = toResource(value);
  return resource === null ? [] : [resource];
}

function toResourceLease(value: unknown): CommandRoomResourceLeaseRecord | null {
  if (!isRecord(value)
    || typeof value.lease_id !== 'string'
    || typeof value.resource_key !== 'string'
    || typeof value.room_id !== 'string'
    || typeof value.task_id !== 'string'
    || typeof value.agent_id !== 'string'
    || typeof value.units !== 'number'
    || typeof value.acquired_at !== 'string'
    || typeof value.heartbeat_at !== 'string'
    || typeof value.expires_at !== 'string') return null;
  return {
    leaseId: value.lease_id,
    resourceKey: value.resource_key,
    owner: { roomId: value.room_id, taskId: value.task_id, agentId: value.agent_id },
    units: value.units,
    acquiredAt: value.acquired_at,
    heartbeatAt: value.heartbeat_at,
    expiresAt: value.expires_at,
  };
}

function resourceLeaseRows(value: unknown): readonly CommandRoomResourceLeaseRecord[] {
  const lease = toResourceLease(value);
  return lease === null ? [] : [lease];
}

interface ResourceRequestRow {
  readonly requestId: string;
  readonly resourceKey: string;
  readonly roomId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly units: number;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly state: CommandRoomResourceRequestState;
  readonly leaseId?: string;
  readonly requestedAt: string;
  readonly updatedAt: string;
}

function toRequest(value: unknown): ResourceRequestRow | null {
  if (!isRecord(value)
    || typeof value.request_id !== 'string'
    || typeof value.resource_key !== 'string'
    || typeof value.room_id !== 'string'
    || typeof value.task_id !== 'string'
    || typeof value.agent_id !== 'string'
    || typeof value.units !== 'number'
    || typeof value.priority !== 'number'
    || typeof value.idempotency_key !== 'string'
    || typeof value.state !== 'string'
    || (value.lease_id !== null && typeof value.lease_id !== 'string')
    || typeof value.requested_at !== 'string'
    || typeof value.updated_at !== 'string') return null;
  if (!['QUEUED', 'GRANTED', 'RELEASED', 'CANCELLED'].includes(value.state)) return null;
  return {
    requestId: value.request_id,
    resourceKey: value.resource_key,
    roomId: value.room_id,
    taskId: value.task_id,
    agentId: value.agent_id,
    units: value.units,
    priority: value.priority,
    idempotencyKey: value.idempotency_key,
    state: value.state as CommandRoomResourceRequestState,
    requestedAt: value.requested_at,
    updatedAt: value.updated_at,
    ...(value.lease_id === null ? {} : { leaseId: value.lease_id }),
  };
}

function countValue(value: unknown): number {
  return isRecord(value) && typeof value.count === 'number' ? value.count : 0;
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + (seconds * 1_000)).toISOString();
}

function parseObject(value: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rollback(connection: SqliteDatabase['connection']): void {
  try {
    connection.exec('ROLLBACK;');
  } catch {
    // Transaction may already be closed.
  }
}
