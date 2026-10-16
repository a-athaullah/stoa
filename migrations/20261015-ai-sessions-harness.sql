-- Fase 2: add harness column to ai_sessions
-- Tracks which harness (claude/codex) was used for each session.
-- When harness changes, resume ID is ignored (new session created).

ALTER TABLE ai_sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude';
