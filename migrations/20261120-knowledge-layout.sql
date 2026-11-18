-- Knowledge (6/6): cached 3D positions of the knowledge brain (lib/knowledge-layout.js, GET
-- /api/knowledge/graph). Same statements as the Knowledge layout block in db/schema.sqlite.sql.
-- Only derived data: every row can be recomputed from knowledge_nodes, nothing here is the only copy.

-- The projection basis (one row): mean vector, 3 principal components and their spreads of the node
-- embeddings of `model`, as little-endian Float32 (lib/knowledge-layout.js packBasis). n_basis = nodes
-- it was computed from; the module decides when it is recomputed.
CREATE TABLE IF NOT EXISTS knowledge_layout_basis (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  n_basis INTEGER NOT NULL,
  basis BLOB NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Position per node. model = the embedding model the position was projected from; '' = the node had
-- no vector of that model and sits at a spot derived from its id.
CREATE TABLE IF NOT EXISTS knowledge_node_layout (
  node_id INTEGER PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  model TEXT NOT NULL
);

-- A node whose vector changes (re-extraction, merge, document section rewritten) is about something
-- else now: its position is dropped and projected again on the next graph read. Adding a node never
-- moves another one.
CREATE TRIGGER IF NOT EXISTS knowledge_nodes_layout_au AFTER UPDATE OF embedding, embedding_model ON knowledge_nodes
WHEN new.embedding IS NOT old.embedding OR new.embedding_model IS NOT old.embedding_model BEGIN
  DELETE FROM knowledge_node_layout WHERE node_id = new.id;
END;
