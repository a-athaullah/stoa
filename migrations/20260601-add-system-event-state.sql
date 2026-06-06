-- Add system_event to messages.state CHECK constraint (table recreate)
CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  state TEXT DEFAULT 'complete' CHECK(state IN ('requesting','streaming','complete','error','system_event')),
  reply_to INTEGER DEFAULT NULL,
  image_url TEXT DEFAULT NULL,
  file_url TEXT DEFAULT NULL,
  file_name TEXT DEFAULT NULL,
  attachments TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id)
);
INSERT INTO messages_new SELECT id, room_id, participant_id, content, state, reply_to, image_url, file_url, file_name, attachments, created_at, completed_at FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_state ON messages(room_id, state);
CREATE INDEX IF NOT EXISTS idx_messages_participant_id ON messages(participant_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
