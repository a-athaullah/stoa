-- Knowledge (5/6): the room's knowledge settings and management panel (lib/knowledge-admin.js). Same
-- statements as the Knowledge privacy block in db/schema.sqlite.sql.
--
-- Two things the panel needs that the sources alone cannot give:
-- 1. Which rooms a node came from, even after the source there is gone. knowledge_sources rows
--    disappear with their message / document, so "nodes of this room" would forget a node the moment
--    its last source in the room is deleted while other sources keep it alive.
-- 2. Who used a node after it was deleted. knowledge_usage cascades with the node, which would erase
--    the trail exactly when it matters (an agent may have copied a sensitive summary before the
--    owner deleted it). The archive keeps a snapshot of names so it stays readable after the actor,
--    sub-agent or room is gone.

-- The sub-agent's label at the time of the use (lib/knowledge-search.js writes it), so the history
-- names a sub-agent that was deleted since (sub_agent_id turns NULL). The archive trigger below copies
-- it instead of joining sub_agents: a trigger body may only name tables of db/schema.sqlite.sql (an
-- older migration that rebuilds a table makes SQLite re-check every trigger, and sub_agents is created
-- by a migration on a fresh install).
ALTER TABLE knowledge_usage ADD COLUMN sub_agent_label TEXT;
UPDATE knowledge_usage SET sub_agent_label = (SELECT label FROM sub_agents WHERE id = knowledge_usage.sub_agent_id)
  WHERE sub_agent_id IS NOT NULL AND sub_agent_label IS NULL;

-- Rooms a node has ever had a source in. Filled by knowledge_sources_ai; never cleared when a source
-- goes (only with the node or the room).
CREATE TABLE IF NOT EXISTS knowledge_node_rooms (
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(node_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_node_rooms_room ON knowledge_node_rooms(room_id);

INSERT OR IGNORE INTO knowledge_node_rooms (node_id, room_id)
  SELECT s.node_id, m.room_id FROM knowledge_sources s JOIN messages m ON m.id = s.message_id
  UNION SELECT s.node_id, d.room_id FROM knowledge_sources s JOIN knowledge_documents d ON d.id = s.document_id;

-- NOT EXISTS instead of OR IGNORE: inside a trigger the outer statement's conflict clause would win.
CREATE TRIGGER IF NOT EXISTS knowledge_sources_ai AFTER INSERT ON knowledge_sources BEGIN
  INSERT INTO knowledge_node_rooms (node_id, room_id)
    SELECT new.node_id, src.room_id FROM (SELECT COALESCE(
      (SELECT room_id FROM messages WHERE id = new.message_id),
      (SELECT room_id FROM knowledge_documents WHERE id = new.document_id)) AS room_id) src
    WHERE src.room_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM knowledge_node_rooms WHERE node_id = new.node_id AND room_id = src.room_id);
END;

-- A deleted node that had been used. node_id has no FK (the node is gone); node ids are AUTOINCREMENT,
-- never reused, so one archive row per node.
CREATE TABLE IF NOT EXISTS knowledge_deleted_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_deleted_nodes_node ON knowledge_deleted_nodes(node_id);

CREATE TABLE IF NOT EXISTS knowledge_deleted_node_rooms (
  deleted_id INTEGER NOT NULL REFERENCES knowledge_deleted_nodes(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(deleted_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_node_rooms_room ON knowledge_deleted_node_rooms(room_id);

-- id = the knowledge_usage.id it was copied from (AUTOINCREMENT, never reused), so live and archived
-- uses share one id space and the history pages through both with one cursor.
CREATE TABLE IF NOT EXISTS knowledge_deleted_usage (
  id INTEGER PRIMARY KEY,
  deleted_id INTEGER NOT NULL REFERENCES knowledge_deleted_nodes(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  actor_name TEXT,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE SET NULL,
  sub_agent_label TEXT,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  room_title TEXT,
  used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_deleted ON knowledge_deleted_usage(deleted_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_actor ON knowledge_deleted_usage(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_sub_agent ON knowledge_deleted_usage(sub_agent_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_room ON knowledge_deleted_usage(room_id) WHERE room_id IS NOT NULL;

-- Every delete path (panel, message / thread / room / document deletion through knowledge_sources_ad)
-- passes here, before the cascade takes usage and node_rooms with the node. Only a node that was used
-- is archived: with no use there is no copy to trace, and its title (itself possibly sensitive) is not
-- kept.
CREATE TRIGGER IF NOT EXISTS knowledge_nodes_bd BEFORE DELETE ON knowledge_nodes
WHEN EXISTS (SELECT 1 FROM knowledge_usage WHERE node_id = old.id)
  AND EXISTS (SELECT 1 FROM knowledge_node_rooms WHERE node_id = old.id) BEGIN
  INSERT INTO knowledge_deleted_nodes (node_id, title, category) VALUES (old.id, old.title, old.category);
  INSERT INTO knowledge_deleted_node_rooms (deleted_id, room_id)
    SELECT (SELECT id FROM knowledge_deleted_nodes WHERE node_id = old.id), room_id FROM knowledge_node_rooms WHERE node_id = old.id;
  INSERT INTO knowledge_deleted_usage (id, deleted_id, actor_id, actor_name, sub_agent_id, sub_agent_label, room_id, room_title, used_at)
    SELECT u.id, (SELECT id FROM knowledge_deleted_nodes WHERE node_id = old.id), u.actor_id, a.name, u.sub_agent_id, u.sub_agent_label,
      u.room_id, r.title, u.used_at
    FROM knowledge_usage u LEFT JOIN actors a ON a.id = u.actor_id LEFT JOIN rooms r ON r.id = u.room_id
    WHERE u.node_id = old.id;
END;

-- An archive no room can show any more (its last origin room was deleted) is dropped: it would be
-- unreachable from every panel and only keep the title around.
CREATE TRIGGER IF NOT EXISTS knowledge_deleted_node_rooms_ad AFTER DELETE ON knowledge_deleted_node_rooms
WHEN NOT EXISTS (SELECT 1 FROM knowledge_deleted_node_rooms WHERE deleted_id = old.deleted_id) BEGIN
  DELETE FROM knowledge_deleted_nodes WHERE id = old.deleted_id;
END;
