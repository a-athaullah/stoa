-- Claude models newer than ANTHROPIC_MODELS now come from each agent's CLI binary scan, stored in
-- harness_models like Codex models. The owner-added "custom" list is retired: every valid entry
-- becomes a regular claude row in harness_models (label kept), then the setting is removed. A setting
-- that is not a JSON array was never read by the server; it is left untouched (zero data loss).
-- Every JSON function reads the whole (validated) document by path: json_extract on a malformed
-- value raises, and SQLite may evaluate it before the WHERE filters the row out. CASE is lazy.
INSERT INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
SELECT h.id,
       json_extract(d.doc, j.fullkey || '.value'),
       COALESCE(NULLIF(trim(substr(CASE WHEN json_type(d.doc, j.fullkey || '.label') = 'text' THEN json_extract(d.doc, j.fullkey || '.label') END, 1, 100)), ''), json_extract(d.doc, j.fullkey || '.value')),
       0, 1
FROM (
  SELECT COALESCE(CASE WHEN json_valid(value) THEN CASE WHEN json_type(value) = 'array' THEN value END END, '[]') AS doc
  FROM settings
  WHERE scope = 'global' AND scope_id IS NULL AND key_name = 'custom_claude_models'
) d
JOIN harnesses h ON h.name = 'claude'
JOIN json_each(d.doc) j
WHERE j.type = 'object'
  AND json_type(d.doc, j.fullkey || '.value') = 'text'
  AND length(json_extract(d.doc, j.fullkey || '.value')) BETWEEN 9 AND 70
  AND json_extract(d.doc, j.fullkey || '.value') GLOB 'claude-[a-z0-9]*'
  AND json_extract(d.doc, j.fullkey || '.value') NOT GLOB '*[^a-z0-9.-]*'
ON CONFLICT(harness_id, model_id) DO UPDATE SET is_active = 1;

DELETE FROM settings
WHERE scope = 'global' AND scope_id IS NULL AND key_name = 'custom_claude_models'
  AND json_type(CASE WHEN json_valid(value) THEN value END) = 'array';

-- A model a run proved unknown to one agent's CLI ("model not found"). Hidden for that agent only,
-- until its CLI reports a different version (update) — never because a model is absent from a list.
CREATE TABLE IF NOT EXISTS agent_model_failures (
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  harness TEXT NOT NULL,
  model_id TEXT NOT NULL,
  cli_version TEXT,
  failed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (actor_id, harness, model_id)
);
