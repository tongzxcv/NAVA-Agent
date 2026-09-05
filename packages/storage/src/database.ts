
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createPreMigrationBackupSync } from './backup-service.js';
import { AUDIT_MIGRATION_SQL } from './migrations/audit-migration.js';
import { CHECKPOINT_MIGRATION_SQL } from './migrations/checkpoint-migration.js';
import { COMMAND_ROOM_BINDING_MIGRATION_SQL } from './migrations/command-room-binding-migration.js';
import { COMMAND_ROOM_SUPERVISOR_STATE_MIGRATION_SQL } from './migrations/command-room-supervisor-state-migration.js';
import { COMMAND_ROOM_TERMINAL_RECOVERY_MIGRATION_SQL } from './migrations/command-room-terminal-recovery-migration.js';

export interface SqliteDatabaseOptions {
  readonly backupDirectory?: string;
}

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const INITIAL_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  real_root_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

export const WORKSPACE_LEASE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS workspace_leases (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lease_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases(expires_at);
`;

export const COMMAND_ROOM_CORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS command_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  policy_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  creation_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS command_room_agents (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('MAIN', 'LEAD')),
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'ONLINE', 'WORKING', 'WAITING', 'SLEEPING', 'OFFLINE')),
  project_key TEXT,
  workspace_id TEXT,
  connection_epoch INTEGER NOT NULL DEFAULT 0 CHECK (connection_epoch >= 0),
  current_task_id TEXT,
  last_heartbeat_at TEXT,
  last_checkpoint_id TEXT,
  capabilities_json TEXT NOT NULL,
  join_code_hash TEXT,
  session_hash TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(room_id, slot_key)
);

CREATE TABLE IF NOT EXISTS command_room_admin_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  actor_agent_id TEXT NOT NULL REFERENCES command_room_agents(id),
  event_type TEXT NOT NULL,
  target_slot_key TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(room_id, actor_agent_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS command_room_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  sender_agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('UPDATE', 'QUESTION', 'RESULT', 'HANDOFF')),
  subject TEXT NOT NULL,
  body_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  reply_to_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(room_id, sender_agent_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS command_room_messages_room_seq_idx ON command_room_messages(room_id, seq);

CREATE TABLE IF NOT EXISTS command_room_message_receipts (
  message_id TEXT NOT NULL REFERENCES command_room_messages(id) ON DELETE CASCADE,
  recipient_agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'DELIVERED', 'ACKED', 'EXPIRED', 'DEAD_LETTER')),
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  acked_at TEXT,
  last_error TEXT,
  PRIMARY KEY(message_id, recipient_agent_id)
);
CREATE INDEX IF NOT EXISTS command_room_receipts_recipient_idx ON command_room_message_receipts(recipient_agent_id, status);

CREATE TABLE IF NOT EXISTS command_room_cursors (
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  last_message_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(room_id, agent_id)
);

CREATE TABLE IF NOT EXISTS command_room_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  mutation_mode TEXT NOT NULL CHECK (mutation_mode IN ('READ_ONLY', 'WRITE')),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'CLAIMED', 'RUNNING', 'WAITING', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id TEXT REFERENCES command_room_agents(id),
  created_by_agent_id TEXT NOT NULL REFERENCES command_room_agents(id),
  checkpoint_id TEXT,
  durable_task_id TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  claimed_at TEXT,
  started_at TEXT,
  deadline_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS command_room_tasks_room_state_idx ON command_room_tasks(room_id, state, priority, created_at);

CREATE TABLE IF NOT EXISTS command_room_task_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES command_room_tasks(id) ON DELETE CASCADE,
  actor_agent_id TEXT NOT NULL REFERENCES command_room_agents(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, actor_agent_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS command_room_task_events_assign_idempotency_idx ON command_room_task_events(actor_agent_id, idempotency_key) WHERE event_type = 'ASSIGN';
`;

export const COMMAND_ROOM_RESOURCE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS command_room_resources (
  resource_key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MT5_TERMINAL', 'CPU_HEAVY', 'VPS_WRITER', 'MANAGED_BROWSER_WRITER', 'GPU_HEAVY')),
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  policy_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_room_resource_leases (
  lease_id TEXT PRIMARY KEY NOT NULL,
  resource_key TEXT NOT NULL REFERENCES command_room_resources(resource_key) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES command_room_tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  units INTEGER NOT NULL CHECK (units >= 1),
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS command_room_resource_leases_resource_idx ON command_room_resource_leases(resource_key, expires_at);
CREATE INDEX IF NOT EXISTS command_room_resource_leases_owner_idx ON command_room_resource_leases(room_id, task_id, agent_id);

CREATE TABLE IF NOT EXISTS command_room_resource_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  resource_key TEXT NOT NULL REFERENCES command_room_resources(resource_key) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES command_room_tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  units INTEGER NOT NULL CHECK (units >= 1),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'GRANTED', 'RELEASED', 'CANCELLED')),
  lease_id TEXT REFERENCES command_room_resource_leases(lease_id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS command_room_resource_requests_queue_idx ON command_room_resource_requests(resource_key, state, priority, requested_at);

INSERT OR IGNORE INTO command_room_resources (resource_key, kind, capacity, enabled, policy_json) VALUES
  ('mt5-terminal-1', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5\\\\terminal64.exe"}'),
  ('mt5-terminal-2', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (2)\\\\terminal64.exe"}'),
  ('mt5-terminal-3', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (3)\\\\terminal64.exe"}'),
  ('mt5-terminal-4', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (4)\\\\terminal64.exe"}'),
  ('mt5-terminal-5', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (5)\\\\terminal64.exe"}'),
  ('mt5-terminal-6', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (6)\\\\terminal64.exe"}'),
  ('mt5-terminal-7', 'MT5_TERMINAL', 1, 1, '{"path":"D:\\\\Programs\\\\MetaTrader 5 (7)\\\\terminal64.exe"}'),
  ('cpu-heavy-project', 'CPU_HEAVY', 2, 1, '{"scope":"project"}'),
  ('vps-nava-writer', 'VPS_WRITER', 1, 1, '{"target":"nava-vps"}'),
  ('managed-browser-writer', 'MANAGED_BROWSER_WRITER', 1, 1, '{"scope":"managed-browser"}'),
  ('gpu-heavy', 'GPU_HEAVY', 1, 1, '{"scope":"machine"}');
`;

export class SqliteDatabase {
  public readonly connection: DatabaseSync;
  private readonly existedBeforeOpen: boolean;
  private preMigrationBackupCreated = false;

  public constructor(private readonly filename: string, private readonly options: SqliteDatabaseOptions = {}) {
    this.existedBeforeOpen = existsSync(filename);
    this.connection = new DatabaseSync(filename, { timeout: 5_000 });
    this.connection.exec('PRAGMA journal_mode = WAL;');
    this.connection.exec('PRAGMA busy_timeout = 5000;');
    this.connection.exec('PRAGMA foreign_keys = ON;');
    this.connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL);');
    this.applyMigration({ id: '001_initial', sql: INITIAL_MIGRATION_SQL });
    this.applyMigration({ id: '002_audit', sql: AUDIT_MIGRATION_SQL });
    this.applyMigration({ id: '003_checkpoints', sql: CHECKPOINT_MIGRATION_SQL });
    this.applyMigration({ id: '004_workspace_leases', sql: WORKSPACE_LEASE_MIGRATION_SQL });
    this.applyMigration({ id: '005_command_room_core', sql: COMMAND_ROOM_CORE_MIGRATION_SQL });
    this.applyMigration({ id: '006_command_room_resources', sql: COMMAND_ROOM_RESOURCE_MIGRATION_SQL });
    this.applyMigration({ id: '007_command_room_bindings', sql: COMMAND_ROOM_BINDING_MIGRATION_SQL });
    this.applyMigration({ id: '008_command_room_supervisor_states', sql: COMMAND_ROOM_SUPERVISOR_STATE_MIGRATION_SQL });
    this.applyMigration({ id: '009_command_room_terminal_recoveries', sql: COMMAND_ROOM_TERMINAL_RECOVERY_MIGRATION_SQL });
  }

  public applyMigration(migration: Migration): void {
    const existing = this.connection.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migration.id);
    if (this.hasMigrationId(existing, migration.id)) return;
    this.backupBeforeFirstPendingMigration();

    this.connection.exec('BEGIN;');
    try {
      this.connection.exec(migration.sql);
      this.connection.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
      this.connection.exec('COMMIT;');
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  private backupBeforeFirstPendingMigration(): void {
    if (this.preMigrationBackupCreated || !this.existedBeforeOpen || this.options.backupDirectory === undefined) return;
    createPreMigrationBackupSync(this.connection, this.options.backupDirectory);
    this.preMigrationBackupCreated = true;
  }

  public close(): void {
    this.connection.close();
  }

  private hasMigrationId(value: unknown, expectedId: string): boolean {
    if (typeof value !== 'object' || value === null || !('id' in value)) return false;
    const id = value.id;
    return typeof id === 'string' && id === expectedId;
  }
}
