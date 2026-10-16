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

-- Seed default models for claude (synced with ANTHROPIC_MODELS in server.js)
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-sonnet-5-5', 'Sonnet 5.5', 1, 1 FROM harnesses WHERE name='claude';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-opus-5-5', 'Opus 5.5', 0, 1 FROM harnesses WHERE name='claude';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'claude-haiku-4-5-20251001', 'Haiku 4.5', 0, 1 FROM harnesses WHERE name='claude';

-- Seed default models for codex (fallback when agent hasn't reported models)
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'gpt-5.6-sol', 'GPT-5.6-Sol', 1, 1 FROM harnesses WHERE name='codex';
INSERT OR IGNORE INTO harness_models (harness_id, model_id, display_name, is_default, is_active)
  SELECT id, 'gpt-6-sol', 'GPT-6-Sol', 0, 1 FROM harnesses WHERE name='codex';

-- Add harness column to sub_agents (NULL = inherit parent)
ALTER TABLE sub_agents ADD COLUMN harness TEXT DEFAULT NULL;
