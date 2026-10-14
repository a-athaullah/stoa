CREATE TABLE IF NOT EXISTS email_message_ids (
  message_id   TEXT PRIMARY KEY,
  thread_id    INTEGER NOT NULL,
  connection_id INTEGER NOT NULL,
  direction    TEXT NOT NULL CHECK(direction IN ('in','out')),
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_message_ids_thread ON email_message_ids(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_message_ids_conn ON email_message_ids(connection_id);

-- Backfill from existing email_threads (incoming emails)
INSERT OR IGNORE INTO email_message_ids (message_id, thread_id, connection_id, direction)
  SELECT message_id, thread_id, connection_id, 'in'
  FROM email_threads
  WHERE message_id != '';
