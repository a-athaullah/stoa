-- R14: durable compact-failure cooldown on ai_sessions
-- Prevents repeated compact attempts after failure (MAX semantics: longer cooldown wins).
ALTER TABLE ai_sessions ADD COLUMN compact_failure_cooldown_until TEXT;
ALTER TABLE ai_sessions ADD COLUMN compact_failure_error TEXT;
