import type {
  CommandRoomSupervisorHandledAction,
  CommandRoomSupervisorStateRecord,
  CommandRoomSupervisorSync,
} from '@lnwjud/domain';
import type { SqliteDatabase } from './database.js';

export interface PublishCommandRoomSupervisorStateInput {
  readonly roomId: string;
  readonly agentId: string;
  readonly slotKey: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly connectionEpoch: number;
  readonly bindingId: string;
  readonly bindingFingerprint: string;
  readonly status: CommandRoomSupervisorStateRecord['status'];
  readonly nextAction?: string;
  readonly safeToContinue: boolean;
  readonly needsUser: boolean;
  readonly checkpointId: string;
  readonly durableTaskIds: readonly string[];
  readonly publishedAt: string;
}

export type PublishCommandRoomSupervisorStateResult =
  | { readonly outcome: 'published'; readonly state: CommandRoomSupervisorStateRecord }
  | { readonly outcome: 'not_found' | 'binding_not_active' | 'stale_epoch' | 'identity_mismatch' };

interface SupervisorStateRow {
  readonly room_id: string;
  readonly agent_id: string;
  readonly slot_key: string;
  readonly project_key: string;
  readonly workspace_id: string;
  readonly connection_epoch: number;
  readonly binding_id: string;
  readonly binding_fingerprint: string;
  readonly status: string;
  readonly next_action: string | null;
  readonly safe_to_continue: number;
  readonly needs_user: number;
  readonly checkpoint_id: string;
  readonly durable_task_ids_json: string;
  readonly supervisor_sync: string;
  readonly last_handled_checkpoint_id: string | null;
  readonly last_handled_action: string | null;
  readonly last_handled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SqliteCommandRoomSupervisorStateRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async publish(input: PublishCommandRoomSupervisorStateInput): Promise<PublishCommandRoomSupervisorStateResult> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const binding = connection.prepare(`
        SELECT room_id, agent_id, slot_key, connection_epoch, state, conversation_ref_fingerprint
        FROM command_room_bindings WHERE id = ?
      `).get(input.bindingId) as {
        room_id?: unknown;
        agent_id?: unknown;
        slot_key?: unknown;
        connection_epoch?: unknown;
        state?: unknown;
        conversation_ref_fingerprint?: unknown;
      } | undefined;
      if (binding === undefined) return rollbackResult(connection, { outcome: 'not_found' as const });
      if (binding.state !== 'PAIRED') return rollbackResult(connection, { outcome: 'binding_not_active' as const });
      if (binding.room_id !== input.roomId || binding.agent_id !== input.agentId || binding.slot_key !== input.slotKey) {
        return rollbackResult(connection, { outcome: 'identity_mismatch' as const });
      }
      if (binding.connection_epoch !== input.connectionEpoch) {
        return rollbackResult(connection, { outcome: 'stale_epoch' as const });
      }
      if (binding.conversation_ref_fingerprint !== input.bindingFingerprint) {
        return rollbackResult(connection, { outcome: 'identity_mismatch' as const });
      }

      const agent = connection.prepare(`
        SELECT slot_key, role, project_key, workspace_id, connection_epoch
        FROM command_room_agents WHERE id = ? AND room_id = ?
      `).get(input.agentId, input.roomId) as {
        slot_key?: unknown;
        role?: unknown;
        project_key?: unknown;
        workspace_id?: unknown;
        connection_epoch?: unknown;
      } | undefined;
      if (agent === undefined) return rollbackResult(connection, { outcome: 'not_found' as const });
      if (agent.connection_epoch !== input.connectionEpoch) {
        return rollbackResult(connection, { outcome: 'stale_epoch' as const });
      }
      if (
        agent.role !== 'LEAD'
        || agent.slot_key !== input.slotKey
        || agent.project_key !== input.projectKey
        || agent.workspace_id !== input.workspaceId
      ) {
        return rollbackResult(connection, { outcome: 'identity_mismatch' as const });
      }

      connection.prepare(`
        INSERT INTO command_room_supervisor_states (
          room_id, agent_id, slot_key, project_key, workspace_id, connection_epoch,
          binding_id, binding_fingerprint, status, next_action, safe_to_continue,
          needs_user, checkpoint_id, durable_task_ids_json, supervisor_sync,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OK', ?, ?)
        ON CONFLICT(room_id, agent_id) DO UPDATE SET
          slot_key = excluded.slot_key,
          project_key = excluded.project_key,
          workspace_id = excluded.workspace_id,
          connection_epoch = excluded.connection_epoch,
          binding_id = excluded.binding_id,
          binding_fingerprint = excluded.binding_fingerprint,
          status = excluded.status,
          next_action = excluded.next_action,
          safe_to_continue = excluded.safe_to_continue,
          needs_user = excluded.needs_user,
          checkpoint_id = excluded.checkpoint_id,
          durable_task_ids_json = excluded.durable_task_ids_json,
          supervisor_sync = 'OK',
          last_handled_checkpoint_id = CASE
            WHEN command_room_supervisor_states.checkpoint_id = excluded.checkpoint_id
              THEN command_room_supervisor_states.last_handled_checkpoint_id
            ELSE NULL
          END,
          last_handled_action = CASE
            WHEN command_room_supervisor_states.checkpoint_id = excluded.checkpoint_id
              THEN command_room_supervisor_states.last_handled_action
            ELSE NULL
          END,
          last_handled_at = CASE
            WHEN command_room_supervisor_states.checkpoint_id = excluded.checkpoint_id
              THEN command_room_supervisor_states.last_handled_at
            ELSE NULL
          END,
          updated_at = excluded.updated_at
      `).run(
        input.roomId,
        input.agentId,
        input.slotKey,
        input.projectKey,
        input.workspaceId,
        input.connectionEpoch,
        input.bindingId,
        input.bindingFingerprint,
        input.status,
        input.nextAction ?? null,
        input.safeToContinue ? 1 : 0,
        input.needsUser ? 1 : 0,
        input.checkpointId,
        JSON.stringify([...new Set(input.durableTaskIds)]),
        input.publishedAt,
        input.publishedAt,
      );
      connection.exec('COMMIT;');
      const state = await this.getForAgent(input.roomId, input.agentId);
      if (state === null) throw new Error('Published Command Room supervisor state could not be reloaded.');
      return { outcome: 'published', state };
    } catch (error) {
      rollback(connection);
      throw error;
    }
  }

  public async getForAgent(roomId: string, agentId: string): Promise<CommandRoomSupervisorStateRecord | null> {
    return toSupervisorState(this.database.connection.prepare(
      `${supervisorStateSelect()} WHERE room_id = ? AND agent_id = ?`,
    ).get(roomId, agentId));
  }

  public async listForRoom(roomId: string): Promise<readonly CommandRoomSupervisorStateRecord[]> {
    return this.database.connection.prepare(
      `${supervisorStateSelect()} WHERE room_id = ? ORDER BY slot_key`,
    ).all(roomId).flatMap(supervisorStateRows);
  }

  public async markSyncStatus(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly bindingId: string;
    readonly connectionEpoch: number;
    readonly supervisorSync: Exclude<CommandRoomSupervisorSync, 'OK'>;
    readonly updatedAt: string;
  }): Promise<CommandRoomSupervisorStateRecord | null> {
    this.database.connection.prepare(`
      UPDATE command_room_supervisor_states
      SET supervisor_sync = ?, updated_at = ?
      WHERE room_id = ? AND agent_id = ? AND binding_id = ? AND connection_epoch = ?
    `).run(
      input.supervisorSync,
      input.updatedAt,
      input.roomId,
      input.agentId,
      input.bindingId,
      input.connectionEpoch,
    );
    return this.getForAgent(input.roomId, input.agentId);
  }

  public async markHandled(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly checkpointId: string;
    readonly action: CommandRoomSupervisorHandledAction;
    readonly handledAt: string;
  }): Promise<boolean> {
    const result = this.database.connection.prepare(`
      UPDATE command_room_supervisor_states
      SET last_handled_checkpoint_id = ?, last_handled_action = ?, last_handled_at = ?, updated_at = ?
      WHERE room_id = ? AND agent_id = ? AND checkpoint_id = ? AND supervisor_sync = 'OK'
    `).run(
      input.checkpointId,
      input.action,
      input.handledAt,
      input.handledAt,
      input.roomId,
      input.agentId,
      input.checkpointId,
    );
    return result.changes === 1;
  }
}

function supervisorStateSelect(): string {
  return `SELECT room_id, agent_id, slot_key, project_key, workspace_id, connection_epoch,
    binding_id, binding_fingerprint, status, next_action, safe_to_continue, needs_user,
    checkpoint_id, durable_task_ids_json, supervisor_sync, last_handled_checkpoint_id,
    last_handled_action, last_handled_at, created_at, updated_at
    FROM command_room_supervisor_states`;
}

function toSupervisorState(value: unknown): CommandRoomSupervisorStateRecord | null {
  if (!isSupervisorStateRow(value)) return null;
  let durableTaskIds: unknown;
  try {
    durableTaskIds = JSON.parse(value.durable_task_ids_json);
  } catch {
    return null;
  }
  if (!Array.isArray(durableTaskIds) || !durableTaskIds.every((entry) => typeof entry === 'string')) return null;
  if (!isSupervisorStatus(value.status) || !isSupervisorSync(value.supervisor_sync)) return null;
  if (value.last_handled_action !== null && !isHandledAction(value.last_handled_action)) return null;
  return {
    roomId: value.room_id,
    agentId: value.agent_id,
    slotKey: value.slot_key,
    projectKey: value.project_key,
    workspaceId: value.workspace_id,
    connectionEpoch: value.connection_epoch,
    bindingId: value.binding_id,
    bindingFingerprint: value.binding_fingerprint,
    status: value.status,
    ...(value.next_action === null ? {} : { nextAction: value.next_action }),
    safeToContinue: value.safe_to_continue === 1,
    needsUser: value.needs_user === 1,
    checkpointId: value.checkpoint_id,
    durableTaskIds,
    supervisorSync: value.supervisor_sync,
    ...(value.last_handled_checkpoint_id === null ? {} : { lastHandledCheckpointId: value.last_handled_checkpoint_id }),
    ...(value.last_handled_action === null ? {} : { lastHandledAction: value.last_handled_action }),
    ...(value.last_handled_at === null ? {} : { lastHandledAt: value.last_handled_at }),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function supervisorStateRows(value: unknown): CommandRoomSupervisorStateRecord[] {
  const state = toSupervisorState(value);
  return state === null ? [] : [state];
}

function isSupervisorStateRow(value: unknown): value is SupervisorStateRow {
  return typeof value === 'object' && value !== null
    && 'room_id' in value && typeof value.room_id === 'string'
    && 'agent_id' in value && typeof value.agent_id === 'string'
    && 'slot_key' in value && typeof value.slot_key === 'string'
    && 'project_key' in value && typeof value.project_key === 'string'
    && 'workspace_id' in value && typeof value.workspace_id === 'string'
    && 'connection_epoch' in value && typeof value.connection_epoch === 'number'
    && 'binding_id' in value && typeof value.binding_id === 'string'
    && 'binding_fingerprint' in value && typeof value.binding_fingerprint === 'string'
    && 'status' in value && typeof value.status === 'string'
    && 'next_action' in value && (value.next_action === null || typeof value.next_action === 'string')
    && 'safe_to_continue' in value && typeof value.safe_to_continue === 'number'
    && 'needs_user' in value && typeof value.needs_user === 'number'
    && 'checkpoint_id' in value && typeof value.checkpoint_id === 'string'
    && 'durable_task_ids_json' in value && typeof value.durable_task_ids_json === 'string'
    && 'supervisor_sync' in value && typeof value.supervisor_sync === 'string'
    && 'last_handled_checkpoint_id' in value && (value.last_handled_checkpoint_id === null || typeof value.last_handled_checkpoint_id === 'string')
    && 'last_handled_action' in value && (value.last_handled_action === null || typeof value.last_handled_action === 'string')
    && 'last_handled_at' in value && (value.last_handled_at === null || typeof value.last_handled_at === 'string')
    && 'created_at' in value && typeof value.created_at === 'string'
    && 'updated_at' in value && typeof value.updated_at === 'string';
}

function isSupervisorStatus(value: string): value is CommandRoomSupervisorStateRecord['status'] {
  return ['WORKING', 'DONE', 'WAITING', 'BLOCKED', 'FAILED'].includes(value);
}

function isSupervisorSync(value: string): value is CommandRoomSupervisorSync {
  return ['OK', 'DEGRADED', 'FAILED'].includes(value);
}

function isHandledAction(value: string): value is CommandRoomSupervisorHandledAction {
  return ['CONTINUE', 'ALERT'].includes(value);
}

function rollback(connection: SqliteDatabase['connection']): void {
  try { connection.exec('ROLLBACK;'); } catch { /* transaction already closed */ }
}

function rollbackResult<T>(connection: SqliteDatabase['connection'], value: T): T {
  connection.exec('ROLLBACK;');
  return value;
}
