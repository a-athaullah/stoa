CREATE TABLE IF NOT EXISTS agent_memory (
  actor_id INTEGER NOT NULL,
  file TEXT NOT NULL CHECK(file IN ('MEMORY.md','USER.md')),
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (actor_id, file)
);

CREATE TABLE IF NOT EXISTS room_memory (
  room_id INTEGER PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_pending_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('agent','room')),
  actor_id INTEGER,
  room_id INTEGER,
  file TEXT,
  proposed_content TEXT NOT NULL,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected'))
);
