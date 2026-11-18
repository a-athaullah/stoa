-- Knowledge (2/6): extraction queue (lib/knowledge-extraction.js). Same statements as the
-- Knowledge extraction block in db/schema.sqlite.sql.

-- How far each conversation has been summarized: thread_id NULL = the room's main feed, else a
-- thread root. A job reads complete messages after through_message_id; success moves it forward.
CREATE TABLE IF NOT EXISTS knowledge_cursors (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  through_message_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_cursors_key ON knowledge_cursors(room_id, COALESCE(thread_id, 0));
CREATE INDEX IF NOT EXISTS idx_knowledge_cursors_thread ON knowledge_cursors(thread_id) WHERE thread_id IS NOT NULL;

-- A queue, not a log: a job that succeeds is deleted. node_id set = re-summarize a stale node
-- (reason 'stale'); otherwise the job reads a conversation (room_id, thread_id). 'failed' after
-- the last attempt stays as a tombstone so the idle sweep does not retry it forever; a new
-- thread-complete / task-done trigger replaces it. leased_actor_id = the agent the job was sent
-- to; only its knowledge_extract_result is accepted.
CREATE TABLE IF NOT EXISTS knowledge_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('thread_complete','task_done','idle','stale')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  leased_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  leased_at TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((reason = 'stale') = (node_id IS NOT NULL)),
  CHECK((status = 'running') = (leased_actor_id IS NOT NULL AND leased_at IS NOT NULL))
);
-- One pending job per conversation and per node: a second trigger is a no-op (INSERT OR IGNORE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_jobs_conv_pending ON knowledge_jobs(room_id, COALESCE(thread_id, 0))
  WHERE status = 'pending' AND node_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_jobs_node_pending ON knowledge_jobs(node_id)
  WHERE status = 'pending' AND node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status ON knowledge_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_conv ON knowledge_jobs(room_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_thread ON knowledge_jobs(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_node ON knowledge_jobs(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_actor ON knowledge_jobs(leased_actor_id) WHERE leased_actor_id IS NOT NULL;

-- Deleting an actor that holds a lease: leased_actor_id ON DELETE SET NULL alone would leave a
-- running job without its lease holder, which the running CHECK refuses (the DELETE would fail).
-- So the job goes back to pending first; if a pending twin for the same conversation or node was
-- queued meanwhile, the running job is deleted instead (the twin covers it, from the same cursor).
-- Same rule as dropTwinned in lib/knowledge-extraction.js.
CREATE TRIGGER IF NOT EXISTS knowledge_jobs_actor_bd BEFORE DELETE ON actors BEGIN
  DELETE FROM knowledge_jobs WHERE status = 'running' AND leased_actor_id = old.id
    AND EXISTS (SELECT 1 FROM knowledge_jobs p WHERE p.status = 'pending' AND CASE WHEN knowledge_jobs.node_id IS NULL
      THEN p.node_id IS NULL AND p.room_id = knowledge_jobs.room_id AND COALESCE(p.thread_id, 0) = COALESCE(knowledge_jobs.thread_id, 0)
      ELSE p.node_id = knowledge_jobs.node_id END);
  UPDATE knowledge_jobs SET status = 'pending', leased_actor_id = NULL, leased_at = NULL, updated_at = datetime('now')
    WHERE status = 'running' AND leased_actor_id = old.id;
END;

-- Editing a message's text makes every node built from it stale: the summary may no longer match.
-- The source stays; re-extraction reads the new text. Only a real content change counts (state
-- or other column updates, and writes of the same text, do not). Streaming replies are not
-- sources yet (only complete messages are extracted), so their updates touch no node.
CREATE TRIGGER IF NOT EXISTS knowledge_messages_au AFTER UPDATE OF content ON messages
WHEN old.content IS NOT new.content BEGIN
  UPDATE knowledge_nodes SET status = 'stale', stale_at = COALESCE(stale_at, datetime('now')), updated_at = datetime('now')
    WHERE id IN (SELECT node_id FROM knowledge_sources WHERE message_id = new.id);
END;
