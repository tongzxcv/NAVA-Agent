export const COMMAND_ROOM_BINDING_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS command_room_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('CHATGPT', 'CODEX', 'OTHER')),
  extension_installation_id TEXT,
  encrypted_conversation_ref TEXT,
  conversation_ref_fingerprint TEXT,
  connection_epoch INTEGER NOT NULL CHECK (connection_epoch >= 0),
  state TEXT NOT NULL CHECK (state IN ('CHALLENGED', 'PAIRED', 'STALE', 'REVOKED', 'REPLACED')),
  challenge_hash TEXT,
  challenge_expires_at TEXT,
  paired_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  replaced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    state != 'CHALLENGED'
    OR (challenge_hash IS NOT NULL AND challenge_expires_at IS NOT NULL)
  ),
  CHECK (
    state != 'PAIRED'
    OR (
      extension_installation_id IS NOT NULL
      AND encrypted_conversation_ref IS NOT NULL
      AND conversation_ref_fingerprint IS NOT NULL
      AND paired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS command_room_bindings_active_slot_epoch_idx
  ON command_room_bindings(room_id, agent_id, connection_epoch)
  WHERE state = 'PAIRED';
CREATE UNIQUE INDEX IF NOT EXISTS command_room_bindings_active_conversation_idx
  ON command_room_bindings(extension_installation_id, conversation_ref_fingerprint)
  WHERE state = 'PAIRED';
CREATE UNIQUE INDEX IF NOT EXISTS command_room_bindings_challenge_hash_idx
  ON command_room_bindings(challenge_hash)
  WHERE challenge_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS command_room_bindings_lookup_idx
  ON command_room_bindings(room_id, agent_id, connection_epoch, state);

CREATE TABLE IF NOT EXISTS command_room_wake_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES command_rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES command_room_agents(id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL REFERENCES command_room_bindings(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  task_id TEXT REFERENCES command_room_tasks(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'ATTEMPTING', 'DELIVERED', 'SUBMITTED', 'MANUAL_FALLBACK', 'DEAD_LETTER', 'CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_attempt_at TEXT,
  next_eligible_at TEXT,
  delivered_at TEXT,
  submitted_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(binding_id, event_key)
);

CREATE INDEX IF NOT EXISTS command_room_wake_pending_idx
  ON command_room_wake_deliveries(state, next_eligible_at, created_at)
  WHERE state IN ('QUEUED', 'ATTEMPTING', 'DELIVERED');
CREATE INDEX IF NOT EXISTS command_room_wake_binding_idx
  ON command_room_wake_deliveries(binding_id, created_at);
CREATE INDEX IF NOT EXISTS command_room_wake_room_agent_idx
  ON command_room_wake_deliveries(room_id, agent_id, created_at);
`;
