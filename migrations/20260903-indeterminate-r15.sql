-- R15: process_generation + indeterminate session status.
-- Sessions that were active when the server crashed cannot be safely
-- retried — they are unknown (neither complete nor cleanly failed).
-- 'indeterminate' is a new status value that signals this state.
-- process_generation tags each session with the server boot that owns it.
-- Migration runner wraps this in a transaction, so no explicit BEGIN/COMMIT here.

ALTER TABLE ai_sessions RENAME TO ai_sessions_r15_backup;

CREATE TABLE ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle','indeterminate')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  sub_agent_id INTEGER,
  compact_failure_cooldown_until TEXT DEFAULT NULL,
  compact_failure_error TEXT DEFAULT NULL,
  process_generation TEXT DEFAULT NULL,
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

INSERT INTO ai_sessions (id, participant_id, room_id, claude_session_id, workdir, status,
  last_active_at, created_at, sub_agent_id, compact_failure_cooldown_until, compact_failure_error)
SELECT id, participant_id, room_id, claude_session_id, workdir,
  CASE WHEN status = 'active' THEN 'indeterminate' ELSE status END,
  last_active_at, created_at, sub_agent_id, compact_failure_cooldown_until, compact_failure_error
FROM ai_sessions_r15_backup;

DROP TABLE ai_sessions_r15_backup;

CREATE UNIQUE INDEX idx_ai_sessions_main_unique ON ai_sessions(participant_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX idx_ai_sessions_room_id ON ai_sessions(room_id);
CREATE INDEX idx_ai_sessions_sub_agent_id ON ai_sessions(sub_agent_id);
