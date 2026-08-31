-- Phase 4 (agentic orchestration): attribute usage to the sub-agent that spent it.
-- Today usage_log rows are keyed only by actor_id + room_id, so a sub-agent's
-- spend is folded into its parent actor with no breakdown. These two columns let
-- a room's usage be split per sub-agent for the orchestrator run summary and a
-- future per-sub-agent view in the Usage tab.
--
--   sub_agent_id    — FK to sub_agents(id), NULL for main-agent turns.
--                     ON DELETE SET NULL so deleting a definition keeps history.
--   sub_agent_label — display snapshot (like messages.sub_agent_label): the row
--                     stays readable even after the definition is renamed/removed.
--
-- Both are populated at write time from the completed message row (the
-- usage_report carries its message_id). Additive, nullable → transactional and
-- zero data loss; pre-Phase-4 rows keep both NULL.
--
-- SOLE OWNER: this migration is the ONLY place these columns + index are
-- defined. Do NOT also add them to db/schema.sqlite.sql — the baseline is
-- exec'd before migrations run, so duplicating them makes a fresh clone hit
-- "duplicate column name" here (migration never marked applied → retries every
-- startup). Same convention as messages.result_meta / sub_agent_label.
ALTER TABLE usage_log ADD COLUMN sub_agent_id INTEGER DEFAULT NULL REFERENCES sub_agents(id) ON DELETE SET NULL;
ALTER TABLE usage_log ADD COLUMN sub_agent_label TEXT DEFAULT NULL;

-- Per-sub-agent rollups for a room's cost summary.
CREATE INDEX IF NOT EXISTS idx_usage_log_sub_agent_id ON usage_log(sub_agent_id);
