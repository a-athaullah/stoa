-- Skills library: skills live on the server (one source for every agent and sub-agent) instead of
-- being scanned from each agent's .claude/skills into agent_skills. agent_skills only ever held a
-- cache of that scan, so dropping it loses nothing that the agents cannot report again.
-- Every edit is a new revision; file contents are content-addressed blobs on disk (sha256), so a
-- revision that only changes SKILL.md shares every other file with the one before it.
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  argument_hint TEXT DEFAULT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  current_revision_id INTEGER DEFAULT NULL,
  created_by_actor_id INTEGER DEFAULT NULL,
  created_by_sub_agent_id INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by_actor_id) REFERENCES actors(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_sub_agent_id) REFERENCES sub_agents(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS skill_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  author_actor_id INTEGER DEFAULT NULL,
  author_sub_agent_id INTEGER DEFAULT NULL,
  note TEXT DEFAULT NULL,
  source_url TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (skill_id, version),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS skill_files (
  revision_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mode INTEGER NOT NULL DEFAULT 420,
  PRIMARY KEY (revision_id, path),
  FOREIGN KEY (revision_id) REFERENCES skill_revisions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_files_sha ON skill_files(sha256);
CREATE INDEX IF NOT EXISTS idx_skills_created_by_actor ON skills(created_by_actor_id);
-- The skills a run used ([{id, name, version}]), so the feed can show them and a reload shows the
-- same thing the live event did.
ALTER TABLE messages ADD COLUMN skill_refs TEXT DEFAULT NULL;
DROP INDEX IF EXISTS idx_agent_skills_actor_id;
DROP INDEX IF EXISTS idx_agent_skills_workdir_id;
DROP TABLE IF EXISTS agent_skills;
