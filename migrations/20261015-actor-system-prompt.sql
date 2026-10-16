-- Fase 1: agent-level system prompt
-- Adds system_prompt column to actors table for per-agent identity/instructions.
-- Sub-agents do NOT inherit parent's system_prompt — they have their own via sub_agents.system_prompt.

ALTER TABLE actors ADD COLUMN system_prompt TEXT DEFAULT NULL;
