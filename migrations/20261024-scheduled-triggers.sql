-- Scheduled triggers v2: a schedule targets an AI agent participant of the room
-- (not a sub-agent). The scheduler posts the task into the room as a labelled
-- automation-style message routed to that agent, so an "@label" inside the task
-- still fires that agent's sub-agent through the normal mention path.
--
-- Zero data loss: every sub_agent_schedules row is copied with its parent agent
-- as the target and "@<label> " prepended to the task, which reproduces the old
-- behaviour (the sub-agent runs the task). The runner wraps this file in one
-- transaction, so the copy and the DROP commit together or not at all.
--
-- schedule_spec holds JSON normalized by lib/schedule.js (interval | daily |
-- weekly | monthly | yearly); old interval/daily specs are already valid.
--
-- SOLE OWNER: this migration is the ONLY place room_schedules + its indexes are
-- defined (same rule as 20260901-sub-agent-schedules.sql): boot runs
-- db/schema.sqlite.sql before migrations, so a copy there would make the
-- CREATE TABLE below fail on a fresh clone.

CREATE TABLE room_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  target_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,      -- AI agent that runs the task
  created_by_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,  -- human or agent
  task TEXT NOT NULL,
  schedule_spec TEXT NOT NULL,          -- trusted JSON, normalized by lib/schedule.js
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,                     -- UTC 'YYYY-MM-DD HH:MM:SS'; NULL only if disabled
  last_run_at TEXT DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO room_schedules (room_id, target_actor_id, created_by_actor_id, task, schedule_spec, enabled, next_run_at, last_run_at, last_error, created_at)
SELECT s.room_id, sa.parent_actor_id, s.created_by_actor_id, '@' || sa.label || ' ' || s.task,
       s.schedule_spec, s.enabled, s.next_run_at, s.last_run_at, s.last_error, s.created_at
FROM sub_agent_schedules s JOIN sub_agents sa ON sa.id = s.sub_agent_id
ORDER BY s.id;

DROP INDEX IF EXISTS idx_sas_due;
DROP INDEX IF EXISTS idx_sas_room;
DROP INDEX IF EXISTS idx_sas_sub_agent;
DROP TABLE sub_agent_schedules;

-- Hot path: the loop scans for due, enabled schedules every tick.
CREATE INDEX idx_room_schedules_due ON room_schedules(enabled, next_run_at);
CREATE INDEX idx_room_schedules_room ON room_schedules(room_id);
CREATE INDEX idx_room_schedules_target ON room_schedules(target_actor_id);
