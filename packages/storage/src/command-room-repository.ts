
import type { SQLInputValue } from 'node:sqlite';
import type {
  CommandRoomAgentRecord,
  CommandRoomMessageRecord,
  CommandRoomRecord,
  CommandRoomTaskRecord,
} from '@lnwjud/domain';
import type { SqliteDatabase } from './database.js';

export interface CreateCommandRoomRecords {
  readonly room: CommandRoomRecord;
  readonly agents: readonly CommandRoomAgentRecord[];
}

interface JoinAgentInput {
  readonly roomId: string;
  readonly slotKey: string;
  readonly joinCodeHash: string;
  readonly sessionHash: string;
  readonly provider: CommandRoomAgentRecord['provider'];
  readonly connectionEpoch: number;
  readonly joinedAt: string;
}

type JoinAgentResult =
  | { readonly joined: true; readonly agent: CommandRoomAgentRecord; readonly roomVersion: number }
  | { readonly joined: false; readonly reason: 'ROOM_NOT_FOUND' | 'SLOT_NOT_FOUND' | 'INVALID_JOIN_CODE' | 'STALE_EPOCH' };

interface AppendMessageInput {
  readonly message: Omit<CommandRoomMessageRecord, 'seq'>;
  readonly recipientAgentIds: readonly string[];
}

interface AppendMessageResult {
  readonly duplicate: boolean;
  readonly message: CommandRoomMessageRecord;
  readonly roomVersion: number;
}

interface UpdateRoomStatusInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly expectedVersion: number;
  readonly eventType: 'PAUSE' | 'RESUME' | 'ARCHIVE';
  readonly nextStatus: CommandRoomRecord['status'];
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

interface RebindAgentInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly targetSlotKey: string;
  readonly expectedVersion: number;
  readonly joinCodeHash: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

interface AddLeadSlotInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly agent: CommandRoomAgentRecord;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}
interface BindAgentProjectInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly targetSlotKey: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}


type AdminMutationResult =
  | { readonly outcome: 'updated'; readonly duplicate: boolean; readonly room: CommandRoomRecord; readonly eventType: string; readonly agent?: CommandRoomAgentRecord }
  | { readonly outcome: 'room_version_conflict'; readonly currentVersion: number }
  | { readonly outcome: 'slot_conflict' }
  | { readonly outcome: 'not_found' };

interface UpdatePresenceInput {
  readonly roomId: string;
  readonly agentId: string;
  readonly sessionHash: string;
  readonly action: 'heartbeat' | 'park' | 'leave';
  readonly occurredAt: string;
  readonly projectKey?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly lastCheckpointId?: string | undefined;
}

interface CreateTaskInput {
  readonly task: CommandRoomTaskRecord;
  readonly expectedRoomVersion: number;
  readonly actorAgentId: string;
  readonly eventType: 'ASSIGN';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

interface TransitionTaskInput {
  readonly roomId: string;
  readonly taskId: string;
  readonly actorAgentId: string;
  readonly expectedVersion: number;
  readonly eventType: string;
  readonly nextState: CommandRoomTaskRecord['state'];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly checkpointId?: string;
  readonly durableTaskId?: string;
}

type TaskMutationResult =
  | { readonly outcome: 'updated'; readonly duplicate: boolean; readonly task: CommandRoomTaskRecord; readonly roomVersion: number; readonly eventType: string }
  | { readonly outcome: 'room_version_conflict'; readonly currentVersion: number }
  | { readonly outcome: 'task_version_conflict'; readonly currentVersion: number }
  | { readonly outcome: 'not_found' };

interface CommandRoomRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly policy_json: string;
  readonly version: number;
  readonly creation_key: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

interface CommandRoomAgentRow {
  readonly id: string;
  readonly room_id: string;
  readonly slot_key: string;
  readonly role: string;
  readonly provider: string;
  readonly state: string;
  readonly project_key: string | null;
  readonly workspace_id: string | null;
  readonly connection_epoch: number;
  readonly current_task_id: string | null;
  readonly last_heartbeat_at: string | null;
  readonly last_checkpoint_id: string | null;
  readonly capabilities_json: string;
  readonly join_code_hash: string | null;
  readonly session_hash: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CommandRoomTaskRow {
  readonly id: string;
  readonly room_id: string;
  readonly project_key: string;
  readonly workspace_id: string | null;
  readonly title: string;
  readonly brief_json: string;
  readonly mutation_mode: string;
  readonly state: string;
  readonly priority: number;
  readonly assigned_agent_id: string | null;
  readonly created_by_agent_id: string;
  readonly checkpoint_id: string | null;
  readonly durable_task_id: string | null;
  readonly version: number;
  readonly claimed_at: string | null;
  readonly started_at: string | null;
  readonly deadline_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CommandRoomMessageRow {
  readonly seq: number;
  readonly id: string;
  readonly room_id: string;
  readonly sender_agent_id: string;
  readonly kind: string;
  readonly subject: string;
  readonly body_json: string;
  readonly priority: number;
  readonly reply_to_id: string | null;
  readonly idempotency_key: string;
  readonly created_at: string;
  readonly expires_at: string | null;
}

export class SqliteCommandRoomRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async createRoom(input: CreateCommandRoomRecords): Promise<void> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      connection.prepare(
        'INSERT INTO command_rooms (id, name, status, policy_json, version, creation_key, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(input.room.id, input.room.name, input.room.status, JSON.stringify(input.room.policy), input.room.version, input.room.creationKey, input.room.createdAt, input.room.updatedAt, input.room.archivedAt ?? null);
      const insertAgent = connection.prepare(
        'INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, project_key, workspace_id, connection_epoch, current_task_id, last_heartbeat_at, last_checkpoint_id, capabilities_json, join_code_hash, session_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const agent of input.agents) insertAgent.run(...agentValues(agent));
      connection.exec('COMMIT;');
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async getRoom(id: string): Promise<CommandRoomRecord | null> {
    return toRoom(this.database.connection.prepare(roomSelect('WHERE id = ?')).get(id));
  }

  public async deleteArchivedRoom(roomId: string): Promise<{ readonly deleted: boolean; readonly reason?: 'not_found' | 'not_archived' }> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const room = toRoom(connection.prepare(roomSelect('WHERE id = ?')).get(roomId));
      if (room === null) return rollbackResult(connection, { deleted: false, reason: 'not_found' as const });
      if (room.status !== 'ARCHIVED') return rollbackResult(connection, { deleted: false, reason: 'not_archived' as const });
      const deleted = connection.prepare("DELETE FROM command_rooms WHERE id = ? AND status = 'ARCHIVED'").run(roomId);
      if (deleted.changes !== 1) return rollbackResult(connection, { deleted: false, reason: 'not_found' as const });
      connection.exec('COMMIT;');
      return { deleted: true };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async findRoomByCreationKey(creationKey: string): Promise<CommandRoomRecord | null> {
    return toRoom(this.database.connection.prepare(roomSelect('WHERE creation_key = ?')).get(creationKey));
  }

  public async listRooms(limit: number): Promise<readonly CommandRoomRecord[]> {
    return this.database.connection.prepare(
      `${roomSelect('')} ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END, updated_at DESC LIMIT ?`,
    ).all(limit).flatMap(roomRows);
  }

  public async listAgents(roomId: string): Promise<readonly CommandRoomAgentRecord[]> {
    return this.database.connection.prepare(
      agentSelect("WHERE room_id = ? ORDER BY CASE slot_key WHEN 'MAIN' THEN 0 ELSE 1 END, slot_key"),
    ).all(roomId).flatMap(agentRows);
  }

  public async getAgentBySlot(roomId: string, slotKey: string): Promise<CommandRoomAgentRecord | null> {
    return toAgent(this.database.connection.prepare(agentSelect('WHERE room_id = ? AND slot_key = ?')).get(roomId, slotKey));
  }

  public async getAgentBySessionHash(roomId: string, sessionHash: string): Promise<CommandRoomAgentRecord | null> {
    return toAgent(this.database.connection.prepare(agentSelect('WHERE room_id = ? AND session_hash = ?')).get(roomId, sessionHash));
  }

  public async joinAgent(input: JoinAgentInput): Promise<JoinAgentResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const room = toRoom(connection.prepare(roomSelect('WHERE id = ?')).get(input.roomId));
      if (room === null) return rollbackResult(connection, { joined: false, reason: 'ROOM_NOT_FOUND' });
      const current = toAgent(connection.prepare(agentSelect('WHERE room_id = ? AND slot_key = ?')).get(input.roomId, input.slotKey));
      if (current === null) return rollbackResult(connection, { joined: false, reason: 'SLOT_NOT_FOUND' });
      if (current.joinCodeHash !== input.joinCodeHash) return rollbackResult(connection, { joined: false, reason: 'INVALID_JOIN_CODE' });
      if (input.connectionEpoch !== current.connectionEpoch + 1) return rollbackResult(connection, { joined: false, reason: 'STALE_EPOCH' });
      connection.prepare(
        "UPDATE command_room_agents SET provider = ?, state = 'AVAILABLE', connection_epoch = ?, last_heartbeat_at = NULL, join_code_hash = NULL, session_hash = ?, updated_at = ? WHERE id = ?",
      ).run(input.provider, input.connectionEpoch, input.sessionHash, input.joinedAt, current.id);
      connection.prepare(
        'INSERT INTO command_room_cursors (room_id, agent_id, last_message_seq, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(room_id, agent_id) DO NOTHING',
      ).run(input.roomId, current.id, input.joinedAt);
      const roomVersion = touchRoom(connection, input.roomId, input.joinedAt);
      const agent = toAgent(connection.prepare(agentSelect('WHERE id = ?')).get(current.id));
      if (agent === null) throw new Error('Joined Command Room agent could not be reloaded');
      connection.exec('COMMIT;');
      return { joined: true, agent, roomVersion };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async appendMessage(input: AppendMessageInput): Promise<AppendMessageResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = toMessage(connection.prepare(messageSelect('WHERE room_id = ? AND sender_agent_id = ? AND idempotency_key = ?'))
        .get(input.message.roomId, input.message.senderAgentId, input.message.idempotencyKey));
      if (existing !== null) {
        const room = toRoom(connection.prepare(roomSelect('WHERE id = ?')).get(input.message.roomId));
        connection.exec('ROLLBACK;');
        if (room === null) throw new Error('Command Room was not found');
        return { duplicate: true, message: existing, roomVersion: room.version };
      }
      connection.prepare(
        'INSERT INTO command_room_messages (id, room_id, sender_agent_id, kind, subject, body_json, priority, reply_to_id, idempotency_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        input.message.id,
        input.message.roomId,
        input.message.senderAgentId,
        input.message.kind,
        input.message.subject,
        JSON.stringify(input.message.body),
        input.message.priority,
        input.message.replyToId ?? null,
        input.message.idempotencyKey,
        input.message.createdAt,
        input.message.expiresAt ?? null,
      );
      const receipt = connection.prepare(
        "INSERT INTO command_room_message_receipts (message_id, recipient_agent_id, status, attempts) VALUES (?, ?, 'QUEUED', 0)",
      );
      for (const recipientAgentId of [...new Set(input.recipientAgentIds)]) receipt.run(input.message.id, recipientAgentId);
      const roomVersion = touchRoom(connection, input.message.roomId, input.message.createdAt);
      const message = toMessage(connection.prepare(messageSelect('WHERE id = ?')).get(input.message.id));
      if (message === null) throw new Error('Command Room message could not be reloaded');
      connection.exec('COMMIT;');
      return { duplicate: false, message, roomVersion };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async getCursor(roomId: string, agentId: string): Promise<number> {
    const row = this.database.connection.prepare(
      'SELECT last_message_seq FROM command_room_cursors WHERE room_id = ? AND agent_id = ?',
    ).get(roomId, agentId);
    return isRecord(row) && typeof row.last_message_seq === 'number' ? row.last_message_seq : 0;
  }

  public async listInbox(roomId: string, agentId: string, cursor: number, limit: number, deliveredAt: string): Promise<{ readonly messages: readonly CommandRoomMessageRecord[]; readonly truncated: boolean; readonly nextCursor: number }> {
    const rows = this.database.connection.prepare(
      `${messageSelect("JOIN command_room_message_receipts r ON r.message_id = command_room_messages.id WHERE command_room_messages.room_id = ? AND r.recipient_agent_id = ? AND command_room_messages.seq > ?")} ORDER BY command_room_messages.seq LIMIT ?`,
    ).all(roomId, agentId, cursor, limit + 1);
    const messages = rows.slice(0, limit).flatMap(messageRows);
    if (messages.length > 0) {
      const ids = messages.map((message) => message.id);
      const update = this.database.connection.prepare(
        "UPDATE command_room_message_receipts SET status = CASE WHEN status = 'QUEUED' THEN 'DELIVERED' ELSE status END, attempts = attempts + CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END, delivered_at = COALESCE(delivered_at, ?) WHERE message_id = ? AND recipient_agent_id = ?",
      );
      for (const id of ids) update.run(deliveredAt, id, agentId);
    }
    return {
      messages,
      truncated: rows.length > limit,
      nextCursor: messages.at(-1)?.seq ?? cursor,
    };
  }

  public async ackInbox(roomId: string, agentId: string, ackThrough: number, acknowledgedAt: string): Promise<{ readonly cursor: number; readonly roomVersion: number }> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const current = await this.getCursor(roomId, agentId);
      if (ackThrough < current) {
        connection.exec('ROLLBACK;');
        const room = await this.getRoom(roomId);
        if (room === null) throw new Error('Command Room was not found');
        return { cursor: current, roomVersion: room.version };
      }
      connection.prepare(
        'INSERT INTO command_room_cursors (room_id, agent_id, last_message_seq, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, agent_id) DO UPDATE SET last_message_seq = excluded.last_message_seq, updated_at = excluded.updated_at',
      ).run(roomId, agentId, ackThrough, acknowledgedAt);
      connection.prepare(
        "UPDATE command_room_message_receipts SET status = 'ACKED', acked_at = ? WHERE recipient_agent_id = ? AND message_id IN (SELECT id FROM command_room_messages WHERE room_id = ? AND seq <= ?)",
      ).run(acknowledgedAt, agentId, roomId, ackThrough);
      const roomVersion = touchRoom(connection, roomId, acknowledgedAt);
      connection.exec('COMMIT;');
      return { cursor: ackThrough, roomVersion };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async updateRoomStatus(input: UpdateRoomStatusInput): Promise<AdminMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const replay = readAdminEvent(connection, input.roomId, input.actorAgentId, input.idempotencyKey);
      if (replay !== null) {
        const room = await this.getRoom(input.roomId);
        connection.exec('ROLLBACK;');
        return room === null ? { outcome: 'not_found' } : { outcome: 'updated', duplicate: true, room, eventType: replay.eventType };
      }
      const room = await this.getRoom(input.roomId);
      if (room === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (room.version !== input.expectedVersion) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      const updated = connection.prepare(
        'UPDATE command_rooms SET status = ?, version = version + 1, updated_at = ?, archived_at = ? WHERE id = ? AND version = ?',
      ).run(input.nextStatus, input.occurredAt, input.nextStatus === 'ARCHIVED' ? input.occurredAt : null, input.roomId, input.expectedVersion);
      if (updated.changes !== 1) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      insertAdminEvent(connection, input.roomId, input.actorAgentId, input.eventType, null, input.idempotencyKey, input.occurredAt);
      const changed = await this.getRoom(input.roomId);
      if (changed === null) throw new Error('Command Room could not be reloaded');
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, room: changed, eventType: input.eventType };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async addLeadSlot(input: AddLeadSlotInput): Promise<AdminMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const replay = readAdminEvent(connection, input.roomId, input.actorAgentId, input.idempotencyKey);
      if (replay !== null) {
        const room = await this.getRoom(input.roomId);
        const agent = replay.targetSlotKey === null ? null : await this.getAgentBySlot(input.roomId, replay.targetSlotKey);
        connection.exec('ROLLBACK;');
        return room === null || agent === null
          ? { outcome: 'not_found' }
          : { outcome: 'updated', duplicate: true, room, agent, eventType: replay.eventType };
      }
      const room = await this.getRoom(input.roomId);
      if (room === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (room.version !== input.expectedVersion) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      if (input.agent.roomId !== input.roomId || input.agent.role !== 'LEAD') throw new Error('Added Command Room agent is invalid');
      const occupied = await this.getAgentBySlot(input.roomId, input.agent.slotKey);
      if (occupied !== null) return rollbackResult(connection, { outcome: 'slot_conflict' });
      connection.prepare(
        'INSERT INTO command_room_agents (id, room_id, slot_key, role, provider, state, project_key, workspace_id, connection_epoch, current_task_id, last_heartbeat_at, last_checkpoint_id, capabilities_json, join_code_hash, session_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(...agentValues(input.agent));
      const roomVersion = touchRoomExpected(connection, input.roomId, input.expectedVersion, input.occurredAt);
      insertAdminEvent(connection, input.roomId, input.actorAgentId, 'ADD_LEAD', input.agent.slotKey, input.idempotencyKey, input.occurredAt);
      const changedRoom = await this.getRoom(input.roomId);
      const changedAgent = await this.getAgentBySlot(input.roomId, input.agent.slotKey);
      if (changedRoom === null || changedAgent === null || changedRoom.version !== roomVersion) throw new Error('Added Command Room Lead slot could not be reloaded');
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, room: changedRoom, agent: changedAgent, eventType: 'ADD_LEAD' };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async bindAgentProject(input: BindAgentProjectInput): Promise<AdminMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const replay = readAdminEvent(connection, input.roomId, input.actorAgentId, input.idempotencyKey);
      if (replay !== null) {
        const room = await this.getRoom(input.roomId);
        const agent = await this.getAgentBySlot(input.roomId, replay.targetSlotKey ?? input.targetSlotKey);
        connection.exec('ROLLBACK;');
        return room === null || agent === null
          ? { outcome: 'not_found' }
          : { outcome: 'updated', duplicate: true, room, agent, eventType: replay.eventType };
      }
      const room = await this.getRoom(input.roomId);
      const agent = await this.getAgentBySlot(input.roomId, input.targetSlotKey);
      if (room === null || agent === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (room.version !== input.expectedVersion) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      connection.prepare(
        'UPDATE command_room_agents SET project_key = ?, workspace_id = ?, updated_at = ? WHERE id = ? AND room_id = ?',
      ).run(input.projectKey, input.workspaceId, input.occurredAt, agent.id, input.roomId);
      const roomVersion = touchRoomExpected(connection, input.roomId, input.expectedVersion, input.occurredAt);
      insertAdminEvent(connection, input.roomId, input.actorAgentId, 'BIND_PROJECT', input.targetSlotKey, input.idempotencyKey, input.occurredAt);
      const changedRoom = await this.getRoom(input.roomId);
      const changedAgent = await this.getAgentBySlot(input.roomId, input.targetSlotKey);
      if (changedRoom === null || changedAgent === null || changedRoom.version !== roomVersion) throw new Error('Bound Command Room project could not be reloaded');
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, room: changedRoom, agent: changedAgent, eventType: 'BIND_PROJECT' };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async rebindAgent(input: RebindAgentInput): Promise<AdminMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const replay = readAdminEvent(connection, input.roomId, input.actorAgentId, input.idempotencyKey);
      if (replay !== null) {
        const room = await this.getRoom(input.roomId);
        const agent = await this.getAgentBySlot(input.roomId, replay.targetSlotKey ?? input.targetSlotKey);
        connection.exec('ROLLBACK;');
        return room === null || agent === null
          ? { outcome: 'not_found' }
          : { outcome: 'updated', duplicate: true, room, agent, eventType: replay.eventType };
      }
      const room = await this.getRoom(input.roomId);
      const agent = await this.getAgentBySlot(input.roomId, input.targetSlotKey);
      if (room === null || agent === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (room.version !== input.expectedVersion) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      connection.prepare(
        "UPDATE command_room_agents SET state = 'AVAILABLE', project_key = NULL, workspace_id = NULL, current_task_id = NULL, last_heartbeat_at = NULL, last_checkpoint_id = NULL, join_code_hash = ?, session_hash = NULL, updated_at = ? WHERE id = ?",
      ).run(input.joinCodeHash, input.occurredAt, agent.id);
      const roomVersion = touchRoomExpected(connection, input.roomId, input.expectedVersion, input.occurredAt);
      insertAdminEvent(connection, input.roomId, input.actorAgentId, 'REBIND', input.targetSlotKey, input.idempotencyKey, input.occurredAt);
      const changedRoom = await this.getRoom(input.roomId);
      const changedAgent = await this.getAgentBySlot(input.roomId, input.targetSlotKey);
      if (changedRoom === null || changedAgent === null || changedRoom.version !== roomVersion) throw new Error('Rebound Command Room state could not be reloaded');
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, room: changedRoom, agent: changedAgent, eventType: 'REBIND' };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async updatePresence(input: UpdatePresenceInput): Promise<{ readonly agent: CommandRoomAgentRecord; readonly roomVersion: number }> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const current = toAgent(connection.prepare(agentSelect('WHERE room_id = ? AND id = ? AND session_hash = ?')).get(input.roomId, input.agentId, input.sessionHash));
      if (current === null) {
        connection.exec('ROLLBACK;');
        throw new Error('Command Room session is no longer active');
      }
      const state = input.action === 'park'
        ? 'SLEEPING'
        : input.action === 'leave'
          ? 'OFFLINE'
          : current.currentTaskId === undefined ? 'ONLINE' : 'WORKING';
      connection.prepare(
        'UPDATE command_room_agents SET state = ?, project_key = ?, workspace_id = ?, last_heartbeat_at = ?, last_checkpoint_id = ?, session_hash = ?, updated_at = ? WHERE id = ? AND room_id = ? AND session_hash = ?',
      ).run(
        state,
        input.projectKey ?? current.projectKey ?? null,
        input.workspaceId ?? current.workspaceId ?? null,
        input.occurredAt,
        input.lastCheckpointId ?? current.lastCheckpointId ?? null,
        input.action === 'leave' ? null : input.sessionHash,
        input.occurredAt,
        input.agentId,
        input.roomId,
        input.sessionHash,
      );
      const roomVersion = touchRoom(connection, input.roomId, input.occurredAt);
      const agent = toAgent(connection.prepare(agentSelect('WHERE id = ?')).get(input.agentId));
      if (agent === null) throw new Error('Command Room agent could not be reloaded');
      connection.exec('COMMIT;');
      return { agent, roomVersion };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async getTask(roomId: string, taskId: string): Promise<CommandRoomTaskRecord | null> {
    return toTask(this.database.connection.prepare(taskSelect('WHERE room_id = ? AND id = ?')).get(roomId, taskId));
  }

  public async findTaskByEventKey(roomId: string, actorAgentId: string, idempotencyKey: string): Promise<{ readonly task: CommandRoomTaskRecord; readonly eventType: string } | null> {
    const row = this.database.connection.prepare(
      `${taskSelect('JOIN command_room_task_events e ON e.task_id = command_room_tasks.id WHERE command_room_tasks.room_id = ? AND e.actor_agent_id = ? AND e.idempotency_key = ?')} ORDER BY e.seq DESC LIMIT 1`,
    ).get(roomId, actorAgentId, idempotencyKey);
    const task = toTask(row);
    return task === null || !isRecord(row) || typeof row.event_type !== 'string' ? null : { task, eventType: row.event_type };
  }

  public async createTask(input: CreateTaskInput): Promise<TaskMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = await this.findTaskByEventKey(input.task.roomId, input.actorAgentId, input.idempotencyKey);
      if (existing !== null) {
        const room = await this.getRoom(input.task.roomId);
        connection.exec('ROLLBACK;');
        return room === null ? { outcome: 'not_found' } : { outcome: 'updated', duplicate: true, task: existing.task, roomVersion: room.version, eventType: existing.eventType };
      }
      const room = await this.getRoom(input.task.roomId);
      if (room === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (room.version !== input.expectedRoomVersion) return rollbackResult(connection, { outcome: 'room_version_conflict', currentVersion: room.version });
      connection.prepare(
        'INSERT INTO command_room_tasks (id, room_id, project_key, workspace_id, title, brief_json, mutation_mode, state, priority, assigned_agent_id, created_by_agent_id, checkpoint_id, durable_task_id, version, claimed_at, started_at, deadline_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(...taskValues(input.task));
      connection.prepare(
        'INSERT INTO command_room_task_events (task_id, actor_agent_id, event_type, payload_json, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(input.task.id, input.actorAgentId, input.eventType, JSON.stringify(input.payload), input.idempotencyKey, input.occurredAt);
      const roomVersion = touchRoomExpected(connection, input.task.roomId, input.expectedRoomVersion, input.occurredAt);
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, task: input.task, roomVersion, eventType: input.eventType };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async transitionTask(input: TransitionTaskInput): Promise<TaskMutationResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = await this.findTaskByEventKey(input.roomId, input.actorAgentId, input.idempotencyKey);
      if (existing !== null) {
        const room = await this.getRoom(input.roomId);
        connection.exec('ROLLBACK;');
        return room === null ? { outcome: 'not_found' } : { outcome: 'updated', duplicate: true, task: existing.task, roomVersion: room.version, eventType: existing.eventType };
      }
      const current = await this.getTask(input.roomId, input.taskId);
      if (current === null) return rollbackResult(connection, { outcome: 'not_found' });
      if (current.version !== input.expectedVersion) return rollbackResult(connection, { outcome: 'task_version_conflict', currentVersion: current.version });
      const claimedAt = input.nextState === 'CLAIMED' ? input.occurredAt : current.claimedAt ?? null;
      const startedAt = input.nextState === 'RUNNING' ? input.occurredAt : current.startedAt ?? null;
      const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(input.nextState) ? input.occurredAt : current.completedAt ?? null;
      const checkpointId = input.checkpointId ?? current.checkpointId ?? null;
      const durableTaskId = input.durableTaskId ?? current.durableTaskId ?? null;
      const updated = connection.prepare(
        'UPDATE command_room_tasks SET state = ?, checkpoint_id = ?, durable_task_id = ?, version = version + 1, claimed_at = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ? AND room_id = ? AND version = ?',
      ).run(input.nextState, checkpointId, durableTaskId, claimedAt, startedAt, completedAt, input.occurredAt, input.taskId, input.roomId, input.expectedVersion);
      if (updated.changes !== 1) {
        const latest = await this.getTask(input.roomId, input.taskId);
        return rollbackResult(connection, latest === null ? { outcome: 'not_found' } : { outcome: 'task_version_conflict', currentVersion: latest.version });
      }
      connection.prepare(
        'INSERT INTO command_room_task_events (task_id, actor_agent_id, event_type, payload_json, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(input.taskId, input.actorAgentId, input.eventType, JSON.stringify(input.payload), input.idempotencyKey, input.occurredAt);
      updateAssignedAgent(connection, current.assignedAgentId, input.nextState, input.taskId, input.occurredAt);
      const roomVersion = touchRoom(connection, input.roomId, input.occurredAt);
      const task = await this.getTask(input.roomId, input.taskId);
      if (task === null) throw new Error('Command Room task could not be reloaded');
      connection.exec('COMMIT;');
      return { outcome: 'updated', duplicate: false, task, roomVersion, eventType: input.eventType };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async listTasks(roomId: string, limit: number): Promise<readonly CommandRoomTaskRecord[]> {
    return this.database.connection.prepare(
      `${taskSelect('WHERE room_id = ?')} ORDER BY CASE state WHEN 'RUNNING' THEN 0 WHEN 'REVIEW' THEN 1 WHEN 'WAITING' THEN 2 WHEN 'CLAIMED' THEN 3 WHEN 'QUEUED' THEN 4 ELSE 5 END, priority DESC, created_at LIMIT ?`,
    ).all(roomId, limit).flatMap(taskRows);
  }
}

function roomSelect(suffix: string): string {
  return `SELECT id, name, status, policy_json, version, creation_key, created_at, updated_at, archived_at FROM command_rooms ${suffix}`;
}

function agentSelect(suffix: string): string {
  return `SELECT id, room_id, slot_key, role, provider, state, project_key, workspace_id, connection_epoch, current_task_id, last_heartbeat_at, last_checkpoint_id, capabilities_json, join_code_hash, session_hash, created_at, updated_at FROM command_room_agents ${suffix}`;
}

function messageSelect(suffix: string): string {
  return `SELECT command_room_messages.seq, command_room_messages.id, command_room_messages.room_id, command_room_messages.sender_agent_id, command_room_messages.kind, command_room_messages.subject, command_room_messages.body_json, command_room_messages.priority, command_room_messages.reply_to_id, command_room_messages.idempotency_key, command_room_messages.created_at, command_room_messages.expires_at FROM command_room_messages ${suffix}`;
}

function readAdminEvent(
  connection: SqliteDatabase['connection'],
  roomId: string,
  actorAgentId: string,
  idempotencyKey: string,
): { readonly eventType: string; readonly targetSlotKey: string | null } | null {
  const row = connection.prepare(
    'SELECT event_type, target_slot_key FROM command_room_admin_events WHERE room_id = ? AND actor_agent_id = ? AND idempotency_key = ?',
  ).get(roomId, actorAgentId, idempotencyKey);
  return isRecord(row) && typeof row.event_type === 'string' && (row.target_slot_key === null || typeof row.target_slot_key === 'string')
    ? { eventType: row.event_type, targetSlotKey: row.target_slot_key }
    : null;
}

function insertAdminEvent(
  connection: SqliteDatabase['connection'],
  roomId: string,
  actorAgentId: string,
  eventType: string,
  targetSlotKey: string | null,
  idempotencyKey: string,
  occurredAt: string,
): void {
  connection.prepare(
    'INSERT INTO command_room_admin_events (room_id, actor_agent_id, event_type, target_slot_key, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(roomId, actorAgentId, eventType, targetSlotKey, idempotencyKey, occurredAt);
}

function taskSelect(suffix: string): string {
  return `SELECT command_room_tasks.id, command_room_tasks.room_id, command_room_tasks.project_key, command_room_tasks.workspace_id, command_room_tasks.title, command_room_tasks.brief_json, command_room_tasks.mutation_mode, command_room_tasks.state, command_room_tasks.priority, command_room_tasks.assigned_agent_id, command_room_tasks.created_by_agent_id, command_room_tasks.checkpoint_id, command_room_tasks.durable_task_id, command_room_tasks.version, command_room_tasks.claimed_at, command_room_tasks.started_at, command_room_tasks.deadline_at, command_room_tasks.completed_at, command_room_tasks.created_at, command_room_tasks.updated_at${suffix.includes('command_room_task_events') ? ', e.event_type' : ''} FROM command_room_tasks ${suffix}`;
}

function touchRoom(connection: SqliteDatabase['connection'], roomId: string, updatedAt: string): number {
  connection.prepare('UPDATE command_rooms SET version = version + 1, updated_at = ? WHERE id = ?').run(updatedAt, roomId);
  const room = toRoom(connection.prepare(roomSelect('WHERE id = ?')).get(roomId));
  if (room === null) throw new Error('Command Room was not found');
  return room.version;
}

function touchRoomExpected(connection: SqliteDatabase['connection'], roomId: string, expectedVersion: number, updatedAt: string): number {
  const result = connection.prepare('UPDATE command_rooms SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(updatedAt, roomId, expectedVersion);
  if (result.changes !== 1) throw new Error('Command Room version changed during mutation');
  return expectedVersion + 1;
}

function updateAssignedAgent(
  connection: SqliteDatabase['connection'],
  assignedAgentId: string | undefined,
  state: CommandRoomTaskRecord['state'],
  taskId: string,
  updatedAt: string,
): void {
  if (assignedAgentId === undefined) return;
  if (state === 'RUNNING') {
    connection.prepare("UPDATE command_room_agents SET state = 'WORKING', current_task_id = ?, updated_at = ? WHERE id = ?").run(taskId, updatedAt, assignedAgentId);
  } else if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(state)) {
    connection.prepare("UPDATE command_room_agents SET state = CASE WHEN state IN ('OFFLINE', 'SLEEPING') THEN state ELSE 'ONLINE' END, current_task_id = NULL, updated_at = ? WHERE id = ?").run(updatedAt, assignedAgentId);
  } else {
    connection.prepare("UPDATE command_room_agents SET state = CASE WHEN state IN ('OFFLINE', 'SLEEPING') THEN state ELSE 'WAITING' END, current_task_id = ?, updated_at = ? WHERE id = ?").run(taskId, updatedAt, assignedAgentId);
  }
}

function taskValues(task: CommandRoomTaskRecord): readonly SQLInputValue[] {
  return [
    task.id,
    task.roomId,
    task.projectKey,
    task.workspaceId ?? null,
    task.title,
    JSON.stringify(task.brief),
    task.mutationMode,
    task.state,
    task.priority,
    task.assignedAgentId ?? null,
    task.createdByAgentId,
    task.checkpointId ?? null,
    task.durableTaskId ?? null,
    task.version,
    task.claimedAt ?? null,
    task.startedAt ?? null,
    task.deadlineAt ?? null,
    task.completedAt ?? null,
    task.createdAt,
    task.updatedAt,
  ];
}

function agentValues(agent: CommandRoomAgentRecord): readonly SQLInputValue[] {
  return [
    agent.id,
    agent.roomId,
    agent.slotKey,
    agent.role,
    agent.provider,
    agent.state,
    agent.projectKey ?? null,
    agent.workspaceId ?? null,
    agent.connectionEpoch,
    agent.currentTaskId ?? null,
    agent.lastHeartbeatAt ?? null,
    agent.lastCheckpointId ?? null,
    JSON.stringify(agent.capabilities),
    agent.joinCodeHash ?? null,
    agent.sessionHash ?? null,
    agent.createdAt,
    agent.updatedAt,
  ];
}

function toRoom(value: unknown): CommandRoomRecord | null {
  if (!isRoomRow(value)) return null;
  const policy = parseObject(value.policy_json);
  if (policy === null || typeof policy.directLeadMessaging !== 'boolean') return null;
  if (value.status !== 'ACTIVE' && value.status !== 'PAUSED' && value.status !== 'ARCHIVED') return null;
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    policy: { directLeadMessaging: policy.directLeadMessaging },
    version: value.version,
    creationKey: value.creation_key,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.archived_at === null ? {} : { archivedAt: value.archived_at }),
  };
}

function toAgent(value: unknown): CommandRoomAgentRecord | null {
  if (!isAgentRow(value)) return null;
  if (value.role !== 'MAIN' && value.role !== 'LEAD') return null;
  if (value.provider !== 'CHATGPT' && value.provider !== 'CODEX' && value.provider !== 'OTHER') return null;
  if (!['AVAILABLE', 'ONLINE', 'WORKING', 'WAITING', 'SLEEPING', 'OFFLINE'].includes(value.state)) return null;
  const capabilities = parseStringArray(value.capabilities_json);
  if (capabilities === null) return null;
  return {
    id: value.id,
    roomId: value.room_id,
    slotKey: value.slot_key,
    role: value.role,
    provider: value.provider,
    state: value.state as CommandRoomAgentRecord['state'],
    connectionEpoch: value.connection_epoch,
    capabilities,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.project_key === null ? {} : { projectKey: value.project_key }),
    ...(value.workspace_id === null ? {} : { workspaceId: value.workspace_id }),
    ...(value.current_task_id === null ? {} : { currentTaskId: value.current_task_id }),
    ...(value.last_heartbeat_at === null ? {} : { lastHeartbeatAt: value.last_heartbeat_at }),
    ...(value.last_checkpoint_id === null ? {} : { lastCheckpointId: value.last_checkpoint_id }),
    ...(value.join_code_hash === null ? {} : { joinCodeHash: value.join_code_hash }),
    ...(value.session_hash === null ? {} : { sessionHash: value.session_hash }),
  };
}

function toMessage(value: unknown): CommandRoomMessageRecord | null {
  if (!isMessageRow(value)) return null;
  if (!['UPDATE', 'QUESTION', 'RESULT', 'HANDOFF'].includes(value.kind)) return null;
  const body = parseObject(value.body_json);
  if (body === null || typeof body.summary !== 'string' || !Array.isArray(body.evidenceRefs) || !body.evidenceRefs.every((entry) => typeof entry === 'string')) return null;
  return {
    seq: value.seq,
    id: value.id,
    roomId: value.room_id,
    senderAgentId: value.sender_agent_id,
    kind: value.kind as CommandRoomMessageRecord['kind'],
    subject: value.subject,
    body: {
      summary: body.summary,
      evidenceRefs: body.evidenceRefs as string[],
      ...(typeof body.nextAction === 'string' ? { nextAction: body.nextAction } : {}),
    },
    priority: value.priority,
    idempotencyKey: value.idempotency_key,
    createdAt: value.created_at,
    ...(value.reply_to_id === null ? {} : { replyToId: value.reply_to_id }),
    ...(value.expires_at === null ? {} : { expiresAt: value.expires_at }),
  };
}

function toTask(value: unknown): CommandRoomTaskRecord | null {
  if (!isTaskRow(value)) return null;
  if (value.mutation_mode !== 'READ_ONLY' && value.mutation_mode !== 'WRITE') return null;
  if (!['QUEUED', 'CLAIMED', 'RUNNING', 'WAITING', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(value.state)) return null;
  const brief = parseObject(value.brief_json);
  if (brief === null
    || typeof brief.summary !== 'string'
    || !Array.isArray(brief.acceptanceCriteria)
    || !brief.acceptanceCriteria.every((entry) => typeof entry === 'string')
    || !Array.isArray(brief.evidenceRefs)
    || !brief.evidenceRefs.every((entry) => typeof entry === 'string')) return null;
  return {
    id: value.id,
    roomId: value.room_id,
    projectKey: value.project_key,
    title: value.title,
    brief: {
      summary: brief.summary,
      acceptanceCriteria: brief.acceptanceCriteria as string[],
      evidenceRefs: brief.evidenceRefs as string[],
      ...(typeof brief.nextAction === 'string' ? { nextAction: brief.nextAction } : {}),
    },
    mutationMode: value.mutation_mode,
    state: value.state as CommandRoomTaskRecord['state'],
    priority: value.priority,
    createdByAgentId: value.created_by_agent_id,
    version: value.version,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.workspace_id === null ? {} : { workspaceId: value.workspace_id }),
    ...(value.assigned_agent_id === null ? {} : { assignedAgentId: value.assigned_agent_id }),
    ...(value.checkpoint_id === null ? {} : { checkpointId: value.checkpoint_id }),
    ...(value.durable_task_id === null ? {} : { durableTaskId: value.durable_task_id }),
    ...(value.claimed_at === null ? {} : { claimedAt: value.claimed_at }),
    ...(value.started_at === null ? {} : { startedAt: value.started_at }),
    ...(value.deadline_at === null ? {} : { deadlineAt: value.deadline_at }),
    ...(value.completed_at === null ? {} : { completedAt: value.completed_at }),
  };
}

function isTaskRow(value: unknown): value is CommandRoomTaskRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.room_id === 'string'
    && typeof value.project_key === 'string'
    && (value.workspace_id === null || typeof value.workspace_id === 'string')
    && typeof value.title === 'string'
    && typeof value.brief_json === 'string'
    && typeof value.mutation_mode === 'string'
    && typeof value.state === 'string'
    && typeof value.priority === 'number'
    && (value.assigned_agent_id === null || typeof value.assigned_agent_id === 'string')
    && typeof value.created_by_agent_id === 'string'
    && (value.checkpoint_id === null || typeof value.checkpoint_id === 'string')
    && (value.durable_task_id === null || typeof value.durable_task_id === 'string')
    && typeof value.version === 'number'
    && (value.claimed_at === null || typeof value.claimed_at === 'string')
    && (value.started_at === null || typeof value.started_at === 'string')
    && (value.deadline_at === null || typeof value.deadline_at === 'string')
    && (value.completed_at === null || typeof value.completed_at === 'string')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function isRoomRow(value: unknown): value is CommandRoomRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.status === 'string'
    && typeof value.policy_json === 'string'
    && typeof value.version === 'number'
    && typeof value.creation_key === 'string'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (value.archived_at === null || typeof value.archived_at === 'string');
}

function isAgentRow(value: unknown): value is CommandRoomAgentRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.room_id === 'string'
    && typeof value.slot_key === 'string'
    && typeof value.role === 'string'
    && typeof value.provider === 'string'
    && typeof value.state === 'string'
    && (value.project_key === null || typeof value.project_key === 'string')
    && (value.workspace_id === null || typeof value.workspace_id === 'string')
    && typeof value.connection_epoch === 'number'
    && (value.current_task_id === null || typeof value.current_task_id === 'string')
    && (value.last_heartbeat_at === null || typeof value.last_heartbeat_at === 'string')
    && (value.last_checkpoint_id === null || typeof value.last_checkpoint_id === 'string')
    && typeof value.capabilities_json === 'string'
    && (value.join_code_hash === null || typeof value.join_code_hash === 'string')
    && (value.session_hash === null || typeof value.session_hash === 'string')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function isMessageRow(value: unknown): value is CommandRoomMessageRow {
  return isRecord(value)
    && typeof value.seq === 'number'
    && typeof value.id === 'string'
    && typeof value.room_id === 'string'
    && typeof value.sender_agent_id === 'string'
    && typeof value.kind === 'string'
    && typeof value.subject === 'string'
    && typeof value.body_json === 'string'
    && typeof value.priority === 'number'
    && (value.reply_to_id === null || typeof value.reply_to_id === 'string')
    && typeof value.idempotency_key === 'string'
    && typeof value.created_at === 'string'
    && (value.expires_at === null || typeof value.expires_at === 'string');
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStringArray(value: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function roomRows(value: unknown): readonly CommandRoomRecord[] {
  const room = toRoom(value);
  return room === null ? [] : [room];
}

function agentRows(value: unknown): readonly CommandRoomAgentRecord[] {
  const agent = toAgent(value);
  return agent === null ? [] : [agent];
}

function taskRows(value: unknown): readonly CommandRoomTaskRecord[] {
  const task = toTask(value);
  return task === null ? [] : [task];
}

function messageRows(value: unknown): readonly CommandRoomMessageRecord[] {
  const message = toMessage(value);
  return message === null ? [] : [message];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rollbackResult<T>(connection: SqliteDatabase['connection'], value: T): T {
  connection.exec('ROLLBACK;');
  return value;
}

function rollback(connection: SqliteDatabase['connection']): void {
  try {
    connection.exec('ROLLBACK;');
  } catch {
    // The transaction may already be closed.
  }
}
