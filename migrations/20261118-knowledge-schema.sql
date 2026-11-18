-- Knowledge (1/6): storage for knowledge nodes extracted from opted-in rooms and from .md documents
-- an agent adds. Same statements as the Knowledge block in db/schema.sqlite.sql.
--
-- Deletion is enforced by the database, not by server.js: every source row cascades from its
-- message or document, and knowledge_sources_ad decides what happens to the node. So deleting a
-- message, a whole thread (DELETE ... WHERE thread_id), or a room (its messages, then its documents)
-- -- and any delete path added later -- needs no knowledge-specific code.

-- Opt-in per room; nothing is extracted from a room until this is 1.
ALTER TABLE rooms ADD COLUMN knowledge_enabled INTEGER NOT NULL DEFAULT 0 CHECK(knowledge_enabled IN (0,1));

-- status 'stale' = at least one source was deleted; the node waits for re-extraction from the
-- sources it still has (queue: WHERE status='stale' ORDER BY stale_at). Search and retrieval MUST
-- filter status='active': a stale summary may still describe content that has been deleted.
-- embedding: same format as message_embeddings.vec (little-endian Float32, lib/semantic-index.js);
-- embedding_model keys the vector space, a different model means the vector must be recomputed.
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL CHECK(category IN ('eng','ops','dec','res')),
  embedding BLOB,
  embedding_model TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale')),
  stale_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(embedding IS NULL OR embedding_model IS NOT NULL),
  CHECK((status = 'stale') = (stale_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_status ON knowledge_nodes(status, stale_at);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  added_by_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_room ON knowledge_documents(room_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_actor ON knowledge_documents(added_by_actor_id) WHERE added_by_actor_id IS NOT NULL;

-- One row per (node, message) or (node, document); exactly one of the two is set.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((message_id IS NULL) <> (document_id IS NULL)),
  UNIQUE(node_id, message_id),
  UNIQUE(node_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_message ON knowledge_sources(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_document ON knowledge_sources(document_id) WHERE document_id IS NOT NULL;

-- Undirected edge stored once: node_a < node_b.
CREATE TABLE IF NOT EXISTS knowledge_edges (
  node_a INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  node_b INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  CHECK(node_a < node_b),
  UNIQUE(node_a, node_b)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_b ON knowledge_edges(node_b);

-- sub_agent_id ON DELETE SET NULL: the use still happened under actor_id (the sub-agent's parent);
-- deleting a sub-agent must not erase a node's usage history.
CREATE TABLE IF NOT EXISTS knowledge_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE SET NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_node ON knowledge_usage(node_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_room ON knowledge_usage(room_id, used_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_actor ON knowledge_usage(actor_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_sub_agent ON knowledge_usage(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

-- A source is gone (its message/document was deleted, or the row itself): a node with no source
-- left is deleted (edges/usage cascade), otherwise it turns stale. COALESCE keeps the original
-- stale_at so a node already queued is not pushed back. Fires once per row, so a multi-row delete
-- (thread, room) ends with the node deleted once its last source goes. When the node itself is
-- deleted, its sources cascade here and both statements match nothing.
CREATE TRIGGER IF NOT EXISTS knowledge_sources_ad AFTER DELETE ON knowledge_sources BEGIN
  DELETE FROM knowledge_nodes WHERE id = old.node_id
    AND NOT EXISTS (SELECT 1 FROM knowledge_sources WHERE node_id = old.node_id);
  UPDATE knowledge_nodes SET status = 'stale', stale_at = COALESCE(stale_at, datetime('now')), updated_at = datetime('now')
    WHERE id = old.node_id;
END;
