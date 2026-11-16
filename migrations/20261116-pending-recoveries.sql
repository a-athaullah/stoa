-- Self-healing 3/3: sessions whose connector process died mid-work, reported from the agent's work
-- journal (lib/work-journal.js) and accepted by lib/session-recovery.js. A row waits here until the
-- agent is connected and current, then is claimed (deleted) right before its recovery trigger.
-- One row per (agent, journal session key): a later report of the same session updates it.
CREATE TABLE IF NOT EXISTS pending_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('turn_running','background_only')),
  exit_reason TEXT NOT NULL CHECK(exit_reason IN ('update','restart','crash')),
  server_restarted INTEGER NOT NULL DEFAULT 0,
  restarted_at TEXT NOT NULL,
  resume_session_id TEXT,
  recovery_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(actor_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_pending_recoveries_thread ON pending_recoveries(room_id, thread_id);
