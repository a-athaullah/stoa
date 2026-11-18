-- Knowledge (3/6): .md documents an agent adds (lib/knowledge-documents.js). Same statements as the
-- Knowledge documents lines in db/schema.sqlite.sql.
--
-- A document is identified in its room by name: adding the same name again updates it section by
-- section (section_hash unchanged = node untouched) instead of creating a twin. A section that is gone
-- loses its source row, and knowledge_sources_ad deletes the node.
--
-- ADD COLUMN cannot take a non-constant default, so updated_at has none (written by the code on
-- every insert and update). A REFERENCES column may be added because its default is NULL.
-- The UNIQUE indexes cannot meet duplicates: no code wrote knowledge_documents before this card.

ALTER TABLE knowledge_documents ADD COLUMN bytes INTEGER;
ALTER TABLE knowledge_documents ADD COLUMN updated_at TEXT;
ALTER TABLE knowledge_documents ADD COLUMN updated_by_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_name ON knowledge_documents(room_id, name);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_updated_by ON knowledge_documents(updated_by_actor_id) WHERE updated_by_actor_id IS NOT NULL;

-- Section key ("H1 > H2", "(intro)", "... #2", "... [part 2]") and the sha256 of its stored text;
-- set only on document sources.
ALTER TABLE knowledge_sources ADD COLUMN section TEXT;
ALTER TABLE knowledge_sources ADD COLUMN section_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_sources_doc_section ON knowledge_sources(document_id, section) WHERE document_id IS NOT NULL;
