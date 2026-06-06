-- Migrate ai_sessions: participant_id UNIQUE → UNIQUE(participant_id, workdir)
CREATE TABLE ai_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  UNIQUE (participant_id, workdir)
);
INSERT INTO ai_sessions_new SELECT * FROM ai_sessions;
DROP TABLE ai_sessions;
ALTER TABLE ai_sessions_new RENAME TO ai_sessions;
