-- Email thread metadata for reply functionality
-- Stores email-specific data (message-id, references, subject, sender) per Stoa thread
-- so the server can construct proper email replies without exposing credentials to agents.

CREATE TABLE IF NOT EXISTS email_threads (
  thread_id     INTEGER PRIMARY KEY REFERENCES messages(id),
  connection_id INTEGER NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
  message_id    TEXT NOT NULL,
  ref_headers   TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  from_address  TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_threads_connection ON email_threads(connection_id);
