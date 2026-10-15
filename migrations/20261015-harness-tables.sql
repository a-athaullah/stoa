-- Fase 3b: harness & harness_models tables + sub_agents.harness

CREATE TABLE IF NOT EXISTS harnesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

INSERT OR IGNORE INTO harnesses (name, description) VALUES ('claude', 'Claude Code CLI (Anthropic)');
INSERT OR IGNORE INTO harnesses (name, description) VALUES ('codex', 'Codex CLI (OpenAI/ChatGPT)');

CREATE TABLE IF NOT EXISTS harness_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id),
  model_id TEXT NOT NULL,
  display_name TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(harness_id, model_id)
);

-- Seed default models for claude
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-sonnet-4-6', 'Sonnet 4.6', 1, 1 FROM harnesses WHERE name='claude';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-opus-4-6', 'Opus 4.6', 0, 1 FROM harnesses WHERE name='claude';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-haiku-3-5', 'Haiku 3.5', 0, 1 FROM harnesses WHERE name='claude';

-- Seed default models for codex
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'o3', 'o3', 1, 1 FROM harnesses WHERE name='codex';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'o4-mini', 'o4-mini', 0, 1 FROM harnesses WHERE name='codex';

-- Add harness column to sub_agents (NULL = inherit parent)
ALTER TABLE sub_agents ADD COLUMN harness TEXT DEFAULT NULL;
