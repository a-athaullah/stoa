-- Phase 1: threading core — messages.thread_id, rooms.system_prompt + max_active_threads,
-- pending_wakes.thread_id, agent_workdirs.claude_md_migrated_at, ai_sessions rebuild with thread_id.

-- 1. messages: thread identity
ALTER TABLE messages ADD COLUMN thread_id INTEGER DEFAULT NULL REFERENCES messages(id);
CREATE INDEX idx_messages_thread_id ON messages(thread_id, id);
CREATE INDEX idx_messages_room_root ON messages(room_id, id) WHERE thread_id IS NULL;

-- 2. rooms: system prompt + thread parallelism cap
ALTER TABLE rooms ADD COLUMN system_prompt TEXT DEFAULT NULL;
ALTER TABLE rooms ADD COLUMN max_active_threads INTEGER NOT NULL DEFAULT 3;

-- 3. pending_wakes: parent wakes in the correct thread
ALTER TABLE pending_wakes ADD COLUMN thread_id INTEGER DEFAULT NULL;

-- 4. agent_workdirs: CLAUDE.md import tracking
ALTER TABLE agent_workdirs ADD COLUMN claude_md_migrated_at TEXT DEFAULT NULL;

-- 5. room_message_queue: queue per thread
ALTER TABLE room_message_queue ADD COLUMN thread_id INTEGER DEFAULT NULL;

-- 6. ai_sessions rebuild — add thread_id NOT NULL DEFAULT 0
--    Sentinel 0 = room-level legacy session. Not NULL because partial unique index
--    + ON CONFLICT upsert doesn't work with "NULL is distinct" semantics in SQLite.
CREATE TABLE ai_sessions_new (
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
  pinned INTEGER NOT NULL DEFAULT 0,
  context_tokens_used INTEGER DEFAULT 0,
  thread_id INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

INSERT INTO ai_sessions_new (id, participant_id, room_id, claude_session_id, workdir, status, last_active_at, created_at, sub_agent_id, compact_failure_cooldown_until, compact_failure_error, process_generation, pinned, context_tokens_used, thread_id)
SELECT id, participant_id, room_id, claude_session_id, workdir, status, last_active_at, created_at, sub_agent_id, compact_failure_cooldown_until, compact_failure_error, process_generation, pinned, context_tokens_used, 0
FROM ai_sessions;

DROP TABLE ai_sessions;
ALTER TABLE ai_sessions_new RENAME TO ai_sessions;

-- Rebuild indexes for ai_sessions
CREATE UNIQUE INDEX idx_ai_sessions_main_unique ON ai_sessions(participant_id, thread_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id, thread_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX idx_ai_sessions_room_id ON ai_sessions(room_id);
CREATE INDEX idx_ai_sessions_thread ON ai_sessions(thread_id);
