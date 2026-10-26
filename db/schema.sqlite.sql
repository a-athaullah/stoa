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
  system_prompt TEXT DEFAULT NULL,
  default_model TEXT DEFAULT NULL,
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
  model_config TEXT DEFAULT NULL,
  system_prompt TEXT DEFAULT NULL,
  max_active_threads INTEGER NOT NULL DEFAULT 3,
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
  workdir_id INTEGER DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (actor_id) REFERENCES actors(id),
  FOREIGN KEY (workdir_id) REFERENCES agent_workdirs(id),
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
  ai_model TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  client_event_id TEXT DEFAULT NULL,
  thread_id INTEGER DEFAULT NULL,
  slack_thread_ts TEXT DEFAULT NULL,
  automation_id INTEGER DEFAULT NULL,
  automation_name TEXT DEFAULT NULL,
  automation_provider TEXT DEFAULT NULL,
  model_source TEXT DEFAULT NULL,
  broadcast_reason TEXT DEFAULT NULL CHECK(broadcast_reason IN ('automation_match','error','limit')),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (thread_id) REFERENCES messages(id),
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle','indeterminate')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  sub_agent_id INTEGER,
  compact_failure_cooldown_until TEXT DEFAULT NULL,
  compact_failure_error TEXT DEFAULT NULL,
  process_generation TEXT DEFAULT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  context_tokens_used INTEGER DEFAULT 0,
  thread_id INTEGER NOT NULL DEFAULT 0,
  harness TEXT NOT NULL DEFAULT 'claude',
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
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
  claude_md_migrated_at TEXT DEFAULT NULL,
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

-- Global rows use scope_id NULL (never 0); room rows use the room id.
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

-- Semantic search vectors (see migrations/20261021-message-embeddings.sql)
CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vec BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS message_embeddings_au AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM message_embeddings WHERE message_id = old.id;
END;

-- Indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_state ON messages(room_id, state);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_actor_id ON room_participants(actor_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_workdir_id ON room_participants(workdir_id);
CREATE INDEX IF NOT EXISTS idx_agent_workdirs_actor_id ON agent_workdirs(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_actor_id ON agent_skills(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_workdir_id ON agent_skills(workdir_id);
CREATE INDEX IF NOT EXISTS idx_messages_participant_id ON messages(participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_room_id ON ai_sessions(room_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sessions_main_unique ON ai_sessions(participant_id, thread_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id, thread_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_sessions_thread ON ai_sessions(thread_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_claude_session_id ON ai_sessions(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_room_root ON messages(room_id, id) WHERE thread_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON messages(room_id, created_at) WHERE broadcast_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
CREATE INDEX IF NOT EXISTS idx_messages_participant_room ON messages(participant_id, room_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_automation_id ON messages(automation_id) WHERE automation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_room_client_event ON messages(room_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_workdir_id ON rooms(workdir_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms(created_by);

CREATE TABLE IF NOT EXISTS automation_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'slack' CHECK(provider IN ('slack','whatsapp','email')),
  token_type   TEXT NOT NULL DEFAULT 'bot' CHECK(token_type IN ('bot','user','qr','password','oauth')),
  credentials  TEXT NOT NULL DEFAULT '{}',
  metadata     TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error','connecting')),
  error_msg    TEXT DEFAULT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_connections_provider ON automation_connections(provider, status);

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
  reply_mode       TEXT NOT NULL DEFAULT 'none',
  watch_reply      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now')),
  connection_id    INTEGER DEFAULT NULL REFERENCES automation_connections(id) ON DELETE SET NULL
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
CREATE INDEX IF NOT EXISTS idx_automations_connection_id ON automations(connection_id);
CREATE INDEX IF NOT EXISTS idx_messages_slack_thread_ts ON messages(slack_thread_ts) WHERE slack_thread_ts IS NOT NULL;
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

-- Defaults. Not INSERT OR IGNORE: scope_id is NULL, and NULLs never collide in the UNIQUE
-- constraint, so that inserted a duplicate row on every start (see 20261021-settings-dedup.sql).
INSERT INTO settings (scope, key_name, value)
SELECT d.scope, d.key_name, d.value FROM (
  SELECT 'global' AS scope, 'idle_timeout_seconds' AS key_name, '300' AS value
  UNION ALL SELECT 'global', 'max_active_rooms_per_ai', '3'
  UNION ALL SELECT 'global', 'max_ai_turns_per_round', '5'
) d
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.scope = d.scope AND s.scope_id IS NULL AND s.key_name = d.key_name);


CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  room_id INTEGER,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES actors(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_actor_created ON usage_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_model_created ON usage_log(model, created_at);

CREATE TABLE IF NOT EXISTS wa_incoming_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
  chat_id       TEXT NOT NULL,
  sender        TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  msg_key       TEXT NOT NULL,
  media_path    TEXT,
  media_type    TEXT,
  direction     TEXT NOT NULL DEFAULT 'in',
  created_at    DATETIME DEFAULT (datetime('now')),
  UNIQUE(msg_key, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_incoming_conn_chat
  ON wa_incoming_messages(connection_id, chat_id, created_at DESC);

-- R28: busy_input_mode queue
CREATE TABLE IF NOT EXISTS room_message_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  attachments TEXT,
  reply_to    INTEGER,
  event_id    TEXT,
  thread_id   INTEGER DEFAULT NULL,
  queued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rmq_room ON room_message_queue(room_id, position);

-- R25: Memory per-room/agent
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

CREATE TABLE IF NOT EXISTS debug_bundles (
  id          TEXT PRIMARY KEY,
  format      INTEGER NOT NULL DEFAULT 1,
  redacted    INTEGER NOT NULL DEFAULT 1,
  read_count  INTEGER NOT NULL DEFAULT 0,
  max_reads   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  consent_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_threads (
  thread_id     INTEGER PRIMARY KEY REFERENCES messages(id),
  connection_id INTEGER NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
  message_id    TEXT NOT NULL,
  ref_headers   TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  from_address  TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_threads_connection ON email_threads(connection_id);

CREATE TABLE IF NOT EXISTS email_message_ids (
  message_id   TEXT PRIMARY KEY,
  thread_id    INTEGER NOT NULL,
  connection_id INTEGER NOT NULL REFERENCES automation_connections(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL CHECK(direction IN ('in','out')),
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_message_ids_thread ON email_message_ids(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_message_ids_conn ON email_message_ids(connection_id);

CREATE TABLE IF NOT EXISTS harnesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS harness_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id),
  model_id TEXT NOT NULL,
  display_name TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(harness_id, model_id)
);

-- MCP gateway (migrations/20261022-mcp-gateway.sql, 20261022-mcp-p3.sql)
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY,
  -- Tool namespace prefix (slug__tool). No '__' inside so the split on the first '__' is unambiguous.
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 32 AND slug GLOB '[a-z]*' AND slug NOT GLOB '*[^a-z0-9_]*' AND instr(slug, '__') = 0),
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
  command TEXT,
  args_json TEXT,
  url TEXT,
  -- lib/credentials.js ciphertext of a JSON object: env vars (stdio) or headers (http).
  env_enc TEXT,
  preset TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  default_access TEXT NOT NULL DEFAULT 'none' CHECK(default_access IN ('all','none')),
  -- Remote servers: 'headers' = static headers from env_enc, 'oauth' = lib/mcp-oauth.js; oauth_enc is
  -- the encrypted client registration + tokens, never returned by the API.
  auth TEXT NOT NULL DEFAULT 'none' CHECK(auth IN ('none','headers','oauth')),
  oauth_enc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_tool_overrides (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  -- Calls per minute per (agent, sub-agent, tool); NULL = no limit. Counted in memory by the gateway.
  rate_limit_per_min INTEGER CHECK(rate_limit_per_min IS NULL OR rate_limit_per_min BETWEEN 1 AND 10000),
  PRIMARY KEY (server_id, tool)
);

-- subject_id is polymorphic (actors.id / sub_agents.id / rooms.id), so server.js deletes these rows
-- itself when the subject is deleted.
CREATE TABLE IF NOT EXISTS mcp_access (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('agent','sub_agent','room')),
  subject_id INTEGER NOT NULL,
  allow INTEGER NOT NULL CHECK(allow IN (0,1)),
  PRIMARY KEY (server_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_access_subject ON mcp_access(subject_type, subject_id);

-- One token per (actor, room, thread, sub-agent) session. token_enc lets the server hand the same
-- token out again, so the agent's session env stays stable (an env change respawns the session).
-- Lookups go through token_hash only.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  token_enc TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  room_id INTEGER,
  thread_id INTEGER,
  sub_agent_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_actor ON mcp_tokens(actor_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_sub_agent ON mcp_tokens(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp_calls (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES mcp_servers(id) ON DELETE SET NULL,
  server_slug TEXT,
  tool TEXT NOT NULL,
  actor_id INTEGER,
  sub_agent_id INTEGER,
  room_id INTEGER,
  thread_id INTEGER,
  args_preview TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','error','denied','timeout','rate_limited')),
  error TEXT,
  duration_ms INTEGER,
  result_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_created ON mcp_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_server ON mcp_calls(server_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_actor ON mcp_calls(actor_id, id);

-- Owner approval for tools marked requires_approval: the gateway holds the agent's tools/call open until
-- the owner decides or expires_at passes (expired = denied). Rows still pending at boot belong to a
-- request that died with the old process and are expired then.
CREATE TABLE IF NOT EXISTS mcp_approvals (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES mcp_servers(id) ON DELETE SET NULL,
  server_slug TEXT NOT NULL,
  tool TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  sub_agent_id INTEGER,
  room_id INTEGER,
  thread_id INTEGER,
  args_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_approvals_room ON mcp_approvals(room_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_approvals_pending ON mcp_approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_mcp_approvals_created ON mcp_approvals(created_at);

-- Parent-agent triggers refused while the agent was outdated; see migrations/20261022-pending-retriggers.sql.
CREATE TABLE IF NOT EXISTS pending_retriggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  trigger_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  thread_id INTEGER DEFAULT NULL,
  prompt TEXT NOT NULL,
  attachments TEXT,
  outside_history INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_participant ON pending_retriggers(participant_id, thread_id, id);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_trigger ON pending_retriggers(trigger_message_id);
CREATE INDEX IF NOT EXISTS idx_pending_retriggers_room ON pending_retriggers(room_id);
