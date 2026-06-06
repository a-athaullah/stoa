PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('human','ai')),
  adapter TEXT DEFAULT NULL,
  adapter_config TEXT DEFAULT NULL,
  avatar_color TEXT DEFAULT NULL,
  avatar_symbol TEXT DEFAULT NULL,
  avatar_url TEXT DEFAULT NULL,
  secret TEXT DEFAULT NULL,
  available_models TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  max_ai_turns INTEGER DEFAULT 5,
  workdir_id INTEGER DEFAULT NULL,
  archived_at TEXT DEFAULT NULL,
  is_pinned INTEGER DEFAULT 0,
  model TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES actors(id)
);

CREATE TABLE IF NOT EXISTS room_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  joined_at TEXT DEFAULT (datetime('now')),
  invited_by INTEGER DEFAULT NULL,
  notify_on_message INTEGER DEFAULT 1,
  auto_respond INTEGER DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (actor_id) REFERENCES actors(id),
  UNIQUE (room_id, actor_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  state TEXT DEFAULT 'complete' CHECK(state IN ('requesting','streaming','complete','error','system_event')),
  reply_to INTEGER DEFAULT NULL,
  image_url TEXT DEFAULT NULL,
  file_url TEXT DEFAULT NULL,
  file_name TEXT DEFAULT NULL,
  attachments TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id)
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  UNIQUE (participant_id, workdir)
);

CREATE TABLE IF NOT EXISTS invite_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  suggested_by_participant_id INTEGER NOT NULL,
  suggested_actor_id INTEGER NOT NULL,
  reason TEXT DEFAULT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (suggested_by_participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (suggested_actor_id) REFERENCES actors(id)
);

CREATE TABLE IF NOT EXISTS agent_workdirs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  label TEXT DEFAULT NULL,
  is_default INTEGER DEFAULT 0,
  model TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  UNIQUE (actor_id, path)
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  workdir_id INTEGER DEFAULT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  scope TEXT DEFAULT 'project' CHECK(scope IN ('global','project','local')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  FOREIGN KEY (workdir_id) REFERENCES agent_workdirs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','room')),
  scope_id INTEGER DEFAULT NULL,
  key_name TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (scope, scope_id, key_name)
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content=messages, content_rowid=id);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

-- Indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_state ON messages(room_id, state);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_actor_id ON room_participants(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_workdirs_actor_id ON agent_workdirs(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_actor_id ON agent_skills(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_workdir_id ON agent_skills(workdir_id);
CREATE INDEX IF NOT EXISTS idx_messages_participant_id ON messages(participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_room_id ON ai_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
CREATE INDEX IF NOT EXISTS idx_rooms_workdir_id ON rooms(workdir_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms(created_by);

CREATE TABLE IF NOT EXISTS automations (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  trigger_type     TEXT NOT NULL,
  trigger_event    TEXT NOT NULL,
  trigger_conditions TEXT NOT NULL DEFAULT '[]',
  target_room_id   INTEGER NOT NULL,
  prompt_template  TEXT NOT NULL,
  enabled          INTEGER DEFAULT 1,
  last_run_at      TEXT,
  run_count        INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(trigger_type, trigger_event, enabled);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_actors_type ON actors(type);
CREATE INDEX IF NOT EXISTS idx_messages_state ON messages(state);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_settings_scope_key ON settings(scope, key_name);
CREATE INDEX IF NOT EXISTS idx_invite_suggestions_room_id ON invite_suggestions(room_id);

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO settings (scope, key_name, value) VALUES
  ('global','idle_timeout_seconds','300'),
  ('global','max_active_rooms_per_ai','3'),
  ('global','max_ai_turns_per_round','5');
