export const COMMAND_ROOM_SUPERVISOR_STATE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS command_room_supervisor_states (
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  project_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  connection_epoch INTEGER NOT NULL CHECK (connection_epoch >= 0),
  binding_id TEXT NOT NULL REFERENCES command_room_bindings(id) ON DELETE CASCADE,
  binding_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('WORKING', 'DONE', 'WAITING', 'BLOCKED', 'FAILED')),
  next_action TEXT,
  safe_to_continue INTEGER NOT NULL CHECK (safe_to_continue IN (0, 1)),
  needs_user INTEGER NOT NULL CHECK (needs_user IN (0, 1)),
  checkpoint_id TEXT NOT NULL,
  durable_task_ids_json TEXT NOT NULL,
  supervisor_sync TEXT NOT NULL CHECK (supervisor_sync IN ('OK', 'DEGRADED', 'FAILED')),
  last_handled_checkpoint_id TEXT,
  last_handled_action TEXT CHECK (last_handled_action IS NULL OR last_handled_action IN ('CONTINUE', 'ALERT')),
  last_handled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(room_id, agent_id)
);

CREATE INDEX IF NOT EXISTS command_room_supervisor_states_binding_idx
  ON command_room_supervisor_states(binding_id, connection_epoch);
CREATE INDEX IF NOT EXISTS command_room_supervisor_states_room_status_idx
  ON command_room_supervisor_states(room_id, supervisor_sync, status, updated_at);
`;
