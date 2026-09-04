BEGIN;

CREATE TABLE IF NOT EXISTS room_message_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  attachments TEXT,
  reply_to    INTEGER,
  event_id    TEXT,
  queued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rmq_room ON room_message_queue(room_id, position);

COMMIT;
