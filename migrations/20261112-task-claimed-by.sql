-- An agent can start a Backlog card itself (stoa__task_move to "ongoing"), without the runner. Such a run
-- has no runner thread, so the claimer is stored: only it (or the owner) completes / blocks / fails it, and
-- the runner's no-reply timeout and the startup reaper leave it alone. NULL = a runner run (or never run).
-- Two nullable columns, no existing row changes. Same columns are in db/schema.sqlite.sql for a fresh clone;
-- the ALTERs are skipped there as "already present".
ALTER TABLE room_tasks ADD COLUMN claimed_by_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE SET NULL;
ALTER TABLE room_tasks ADD COLUMN claimed_by_sub_agent_id INTEGER DEFAULT NULL REFERENCES sub_agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_claimed_by ON room_tasks(claimed_by_actor_id) WHERE claimed_by_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_claimed_by_sub ON room_tasks(claimed_by_sub_agent_id) WHERE claimed_by_sub_agent_id IS NOT NULL;
