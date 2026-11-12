-- Kanban task board per room (lib/room-tasks.js, lib/room-tasks-runner.js). New tables only, plus two
-- nullable columns on messages, so no existing row changes. Same definitions are in db/schema.sqlite.sql
-- (CREATE ... IF NOT EXISTS) for a fresh clone; the ALTERs are skipped there as "already present".
--
-- rank: fractional string key computed by the server (lexicographic order inside a column). A card
-- keeps its rank while it runs, so Stop / a failure put it back where it was in Backlog.
-- assignee_sub_agent_id: set → the runner fires that sub-agent through its parent (assignee_actor_id).
CREATE TABLE IF NOT EXISTS room_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  col TEXT NOT NULL DEFAULT 'backlog' CHECK(col IN ('awaiting','backlog','ongoing','finished')),
  rank TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','med','high')),
  labels TEXT NOT NULL DEFAULT '[]',
  checklist TEXT NOT NULL DEFAULT '[]',
  assignee_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE SET NULL,
  assignee_sub_agent_id INTEGER DEFAULT NULL REFERENCES sub_agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','blocked','failed','done')),
  await_reason TEXT DEFAULT NULL,
  fail_reason TEXT DEFAULT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  thread_id INTEGER DEFAULT NULL,
  message_id INTEGER DEFAULT NULL,
  result_summary TEXT DEFAULT NULL,
  created_by_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT DEFAULT NULL,
  finished_at TEXT DEFAULT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_room_tasks_col_rank ON room_tasks(room_id, col, rank);
CREATE INDEX IF NOT EXISTS idx_room_tasks_status ON room_tasks(room_id, status);
-- Foreign keys to actors / sub_agents: an actor or sub-agent delete updates its rows without a scan.
CREATE INDEX IF NOT EXISTS idx_room_tasks_assignee ON room_tasks(assignee_actor_id) WHERE assignee_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_assignee_sub ON room_tasks(assignee_sub_agent_id) WHERE assignee_sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_created_by ON room_tasks(created_by_actor_id) WHERE created_by_actor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS room_task_deps (
  task_id INTEGER NOT NULL REFERENCES room_tasks(id) ON DELETE CASCADE,
  depends_on_id INTEGER NOT NULL REFERENCES room_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS idx_room_task_deps_on ON room_task_deps(depends_on_id);

CREATE TABLE IF NOT EXISTS room_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES room_tasks(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('human','agent','sub_agent','system')),
  body TEXT DEFAULT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_room_task_events_task ON room_task_events(task_id, id);
CREATE INDEX IF NOT EXISTS idx_room_task_events_room ON room_task_events(room_id);
CREATE INDEX IF NOT EXISTS idx_room_task_events_actor ON room_task_events(actor_id) WHERE actor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS room_task_settings (
  room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 5),
  running INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A runner message carries its card: the "Task #seq" badge and the click-through to the drawer.
-- task_seq is a snapshot so the badge survives a deleted card (task_id → NULL).
ALTER TABLE messages ADD COLUMN task_id INTEGER DEFAULT NULL REFERENCES room_tasks(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN task_seq INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id) WHERE task_id IS NOT NULL;
