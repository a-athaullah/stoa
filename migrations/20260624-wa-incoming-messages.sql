CREATE TABLE IF NOT EXISTS wa_incoming_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
  chat_id       TEXT NOT NULL,
  sender        TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  msg_key       TEXT NOT NULL,
  media_path    TEXT,
  media_type    TEXT,
  direction     TEXT NOT NULL DEFAULT 'in',
  created_at    DATETIME DEFAULT (datetime('now')),
  UNIQUE(msg_key, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_incoming_conn_chat
  ON wa_incoming_messages(connection_id, chat_id, created_at DESC);
