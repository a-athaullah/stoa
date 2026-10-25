-- Fixture: a fresh Stoa install at v0.3.0: that tag's db/schema.sqlite.sql + its migrations/ applied
-- to a scratch DB (no user data), dumped as schema objects + the migrations table + seed rows.
-- Used by test.js "[Migration Runner]" to upgrade it to the current migrations in one boot.

CREATE TABLE actors (
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

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  max_ai_turns INTEGER DEFAULT 5,
  workdir_id INTEGER DEFAULT NULL,
  archived_at TEXT DEFAULT NULL,
  is_pinned INTEGER DEFAULT 0,
  model TEXT DEFAULT NULL,
  model_config TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES actors(id)
);

CREATE TABLE room_participants (
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

CREATE TABLE messages (
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
  ai_model TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id)
);

CREATE TABLE ai_sessions (
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

CREATE TABLE invite_suggestions (
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

CREATE TABLE agent_workdirs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  label TEXT DEFAULT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  UNIQUE (actor_id, path)
);

CREATE TABLE agent_skills (
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

CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','room')),
  scope_id INTEGER DEFAULT NULL,
  key_name TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (scope, scope_id, key_name)
);

CREATE TABLE automation_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'slack' CHECK(provider IN ('slack')),
  token_type   TEXT NOT NULL DEFAULT 'bot' CHECK(token_type IN ('bot','user')),
  credentials  TEXT NOT NULL DEFAULT '{}',
  metadata     TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error','connecting')),
  error_msg    TEXT DEFAULT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE automations (
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
  created_at       TEXT DEFAULT (datetime('now')),
  connection_id    INTEGER DEFAULT NULL REFERENCES automation_connections(id) ON DELETE SET NULL
);

CREATE TABLE auth_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=id);

CREATE INDEX idx_messages_room_id ON messages(room_id);

CREATE INDEX idx_messages_room_state ON messages(room_id, state);

CREATE INDEX idx_room_participants_room_id ON room_participants(room_id);

CREATE INDEX idx_room_participants_actor_id ON room_participants(actor_id);

CREATE INDEX idx_agent_workdirs_actor_id ON agent_workdirs(actor_id);

CREATE INDEX idx_agent_skills_actor_id ON agent_skills(actor_id);

CREATE INDEX idx_agent_skills_workdir_id ON agent_skills(workdir_id);

CREATE INDEX idx_messages_participant_id ON messages(participant_id);

CREATE INDEX idx_ai_sessions_participant_id ON ai_sessions(participant_id);

CREATE INDEX idx_ai_sessions_room_id ON ai_sessions(room_id);

CREATE INDEX idx_messages_reply_to ON messages(reply_to);

CREATE INDEX idx_rooms_workdir_id ON rooms(workdir_id);

CREATE INDEX idx_rooms_created_by ON rooms(created_by);

CREATE INDEX idx_automation_connections_provider ON automation_connections(provider, status);

CREATE INDEX idx_automations_trigger ON automations(trigger_type, trigger_event, enabled);

CREATE INDEX idx_automations_connection_id ON automations(connection_id);

CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE INDEX idx_actors_type ON actors(type);

CREATE INDEX idx_messages_state ON messages(state);

CREATE INDEX idx_auth_users_email ON auth_users(email);

CREATE INDEX idx_settings_scope_key ON settings(scope, key_name);

CREATE INDEX idx_invite_suggestions_room_id ON invite_suggestions(room_id);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

INSERT INTO "settings" ("id", "scope", "scope_id", "key_name", "value") VALUES (1, 'global', NULL, 'idle_timeout_seconds', '300');
INSERT INTO "settings" ("id", "scope", "scope_id", "key_name", "value") VALUES (2, 'global', NULL, 'max_active_rooms_per_ai', '3');
INSERT INTO "settings" ("id", "scope", "scope_id", "key_name", "value") VALUES (3, 'global', NULL, 'max_ai_turns_per_round', '5');
INSERT INTO migrations (filename) VALUES ('20260590-migrate-ai-sessions-unique.sql');
INSERT INTO migrations (filename) VALUES ('20260592-add-rooms-archived-at.sql');
INSERT INTO migrations (filename) VALUES ('20260601-add-system-event-state.sql');
INSERT INTO migrations (filename) VALUES ('20260602-clean-duplicate-settings.sql');
INSERT INTO migrations (filename) VALUES ('20260609-automation-connections.sql');
INSERT INTO migrations (filename) VALUES ('20260591-add-agent-workdirs-model.sql');
INSERT INTO migrations (filename) VALUES ('20260603-add-room-id-to-ai-sessions.sql');
INSERT INTO migrations (filename) VALUES ('20260604-add-automation-table.sql');
INSERT INTO migrations (filename) VALUES ('20260605-add-available-models-to-actors.sql');
INSERT INTO migrations (filename) VALUES ('20260606-add-missing-indexes.sql');
INSERT INTO migrations (filename) VALUES ('20260607-add-is-pinned-to-rooms.sql');
INSERT INTO migrations (filename) VALUES ('20260608-add-model-to-rooms.sql');
INSERT INTO migrations (filename) VALUES ('20260611-add-rooms-model-config.sql');
INSERT INTO migrations (filename) VALUES ('20260611-remove-agent-workdirs-model.sql');
INSERT INTO migrations (filename) VALUES ('20260612-add-messages-ai-model.sql');
INSERT INTO migrations (filename) VALUES ('20260618-fix-ollama-vendor-for-custom-base-url.sql');
