-- Durable queue for parent-agent triggers refused because the agent was outdated
-- ("agent updating"). Re-delivered once on the agent's next current-version
-- agent_connect, FIFO per (participant, thread). trigger_message_id is the message
-- that triggered the run (reply_to), NULL for scheduler / wake / cascade triggers.
CREATE TABLE IF NOT EXISTS pending_retriggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  trigger_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  thread_id INTEGER DEFAULT NULL,
  prompt TEXT NOT NULL,
  attachments TEXT,
  outside_history INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_participant ON pending_retriggers(participant_id, thread_id, id);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_trigger ON pending_retriggers(trigger_message_id);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_room ON pending_retriggers(room_id);
