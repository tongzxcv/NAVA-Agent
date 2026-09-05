export const COMMAND_ROOM_TERMINAL_RECOVERY_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS command_room_terminal_recoveries (
  id TEXT PRIMARY KEY NOT NULL,
  recovery_key TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  project_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  connection_epoch INTEGER NOT NULL CHECK (connection_epoch >= 0),
  binding_id TEXT NOT NULL REFERENCES command_room_bindings(id) ON DELETE CASCADE,
  source_conversation_fingerprint TEXT NOT NULL,
  terminal_turn_fingerprint TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MESSAGE_DELIVERY_TIMEOUT')),
  state TEXT NOT NULL CHECK (state IN ('WAITING', 'CLAIMED', 'AUTHORIZED')),
  continuation_binding_id TEXT REFERENCES command_room_bindings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS command_room_terminal_recoveries_binding_idx
  ON command_room_terminal_recoveries(binding_id, checkpoint_id, state);
CREATE INDEX IF NOT EXISTS command_room_terminal_recoveries_room_idx
  ON command_room_terminal_recoveries(room_id, agent_id, updated_at);
`;
