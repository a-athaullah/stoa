-- Semantic search: one embedding per complete message, written in the background by
-- lib/semantic-index.js. vec is a little-endian Float32 blob (384 dims); NULL marks a message with
-- nothing worth embedding or one the model failed on, so the backfill does not retry it forever.
-- `model` keys the vector space: switching model makes every row stale and the backfill redoes them.
CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vec BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);
-- An edited message must be re-embedded: dropping its row puts it back in the backfill queue.
CREATE TRIGGER IF NOT EXISTS message_embeddings_au AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM message_embeddings WHERE message_id = old.id;
END;
