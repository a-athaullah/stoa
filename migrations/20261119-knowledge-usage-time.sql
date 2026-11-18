-- Knowledge (4/6): GET /api/knowledge/usage counts uses per node since a point in time
-- (lib/knowledge-search.js usageCounts). Covering index: the range scan on used_at reads node_id from
-- the index, never the table. Same statement as the knowledge_usage lines in db/schema.sqlite.sql.
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_time ON knowledge_usage(used_at, node_id);
