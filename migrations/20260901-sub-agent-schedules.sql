-- Phase 6 (agentic orchestration): proactive triggers.
--
-- Persistent (user-defined) sub-agents can be fired on a schedule by the
-- server, with no @mention and no orchestrator in the loop. A scheduled fire
-- reuses the SAME trigger path as POST /sub-agent-trigger (resolve → validate
-- → triggerAiResponse) but is server-initiated: no spawn_token is issued, so a
-- scheduled sub-agent still cannot spawn another (depth stays 1).
--
-- schedule_spec is validated/normalized by lib/schedule.js before it is ever
-- written (whitelisted shape: interval | daily), so the column always holds a
-- trusted JSON blob. next_run_at is a UTC datetime string, recomputed on
-- create/edit and after every fire (claim-before-fire in the loop).
--
-- SOLE OWNER: this migration is the ONLY place this table + its indexes are
-- defined. Do NOT also add it to db/schema.sqlite.sql — it FK-references
-- sub_agents/rooms, and sub_agents itself lives only in
-- 20260831-sub-agent-definitions.sql (see that file's note). Migrations run
-- after schema.sqlite.sql on a fresh clone, in filename order, so this applies
-- after sub_agents exists.

CREATE TABLE sub_agent_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sub_agent_id INTEGER NOT NULL REFERENCES sub_agents(id) ON DELETE CASCADE,
  created_by_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  schedule_spec TEXT NOT NULL,          -- trusted JSON, normalized by lib/schedule.js
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,                     -- UTC 'YYYY-MM-DD HH:MM:SS'; NULL only if disabled
  last_run_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Hot path: the loop scans for due, enabled schedules every tick.
CREATE INDEX idx_sas_due ON sub_agent_schedules(enabled, next_run_at);
CREATE INDEX idx_sas_room ON sub_agent_schedules(room_id);
CREATE INDEX idx_sas_sub_agent ON sub_agent_schedules(sub_agent_id);
