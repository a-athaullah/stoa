-- Phase 2b (agentic orchestration): orchestrator trigger + ephemeral spawn.
--
-- Adds per-room budget/kill-switch columns and the durable wake queue used to
-- auto-wake a parent orchestrator exactly once after its sub-agent completes.
--
-- All changes are additive (ADD COLUMN with defaults + CREATE TABLE), so this
-- migration is transactional and zero data loss — existing rooms inherit the
-- defaults (3 concurrent sub-agents, 10 spawns/hour, spawns not paused).
--
-- SOLE OWNER: this migration is the ONLY place these columns, the table, and
-- its indexes are defined. Do NOT also add them to db/schema.sqlite.sql — see
-- the note in 20260831-messages-sub-agent-identity.sql for why (fresh clone +
-- existing DB double-definition breaks both paths).

-- ── 1. Room budget + kill switch (Loop Guard #2 + R2)
ALTER TABLE rooms ADD COLUMN max_sub_agents INTEGER NOT NULL DEFAULT 3;       -- concurrent cap
ALTER TABLE rooms ADD COLUMN max_spawns_per_hour INTEGER NOT NULL DEFAULT 10; -- rate cap (AI-triggered only)
ALTER TABLE rooms ADD COLUMN spawns_paused INTEGER NOT NULL DEFAULT 0;        -- R2 kill switch: block new spawns

-- ── 2. Durable wake queue (R1)
--    A row is created when a sub-agent completes; drained after the parent is
--    woken. Server drains this table on startup so sub-agent results survive a
--    restart. attempts caps retries (then a system notice is posted).
CREATE TABLE pending_wakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_participant_id INTEGER NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  sub_agent_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pending_wakes_room ON pending_wakes(room_id);
