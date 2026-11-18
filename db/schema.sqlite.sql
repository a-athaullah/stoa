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
  -- migrations/20261118-knowledge-schema.sql: Knowledge opt-in per room.
  knowledge_enabled INTEGER NOT NULL DEFAULT 0 CHECK(knowledge_enabled IN (0,1)),
  FOREIGN KEY (created_by) REFERENCES actors(id)
);
-- rooms.primary_actor_id is added by migrations/20261028-room-primary-agent.sql.

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
  thread_completed_at TEXT DEFAULT NULL,
  thread_completed_through INTEGER DEFAULT NULL,
  task_id INTEGER DEFAULT NULL REFERENCES room_tasks(id) ON DELETE SET NULL,
  task_seq INTEGER DEFAULT NULL,
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
  position    INTEGER NOT NULL DEFAULT 0,
  message_id  INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE CASCADE,
  target_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE CASCADE
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
  -- stdio only: never idle-stopped or evicted, started at boot, restarted after an exit (lib/mcp-upstreams.js).
  keep_alive INTEGER NOT NULL DEFAULT 0 CHECK(keep_alive IN (0,1)),
  -- Remote servers: 'headers' = static headers from env_enc, 'oauth' = lib/mcp-oauth.js; oauth_enc is
  -- the encrypted client registration + tokens, never returned by the API.
  auth TEXT NOT NULL DEFAULT 'none' CHECK(auth IN ('none','headers','oauth')),
  oauth_enc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 1 = Stoa's own tools (slug 'stoa', seeded by migrations/20261101-mcp-builtin-server.sql): never
  -- started as an upstream, cannot be deleted, connection fields cannot be edited.
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1))
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
  revoked_at TEXT,
  -- Platform + chat model of the scope's latest run, only when it ran on a Venice platform (image tools).
  run_platform_id TEXT,
  run_model TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_actor ON mcp_tokens(actor_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_sub_agent ON mcp_tokens(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

-- One events token per installed server (POST /api/mcp/events, lib/mcp-events.js), given to a stdio
-- upstream as STOA_EVENTS_TOKEN. Lookups by hash; token_enc keeps it stable across respawns.
CREATE TABLE IF NOT EXISTS mcp_event_tokens (
  server_id INTEGER PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 'owner' = approved on its card, 'exemption' = mcp_approval_exemptions; NULL = no approval needed.
  approval TEXT CHECK(approval IS NULL OR approval IN ('owner','exemption'))
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

-- "Always allow": exempts one agent (sub_agent_id NULL) or one sub-agent from approval for one tool.
-- Exact match only; AUTOINCREMENT so a stale id never hits a newer row. See migrations/20261026-mcp-approval-exemptions.sql.
CREATE TABLE IF NOT EXISTS mcp_approval_exemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_key
  ON mcp_approval_exemptions(server_id, tool, actor_id, COALESCE(sub_agent_id, 0));
CREATE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_actor ON mcp_approval_exemptions(actor_id);
CREATE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_sub_agent ON mcp_approval_exemptions(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

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

-- Self-healing 3/3: journal sessions accepted for recovery (lib/session-recovery.js).
CREATE TABLE IF NOT EXISTS pending_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('turn_running','background_only')),
  exit_reason TEXT NOT NULL CHECK(exit_reason IN ('update','restart','crash')),
  server_restarted INTEGER NOT NULL DEFAULT 0,
  restarted_at TEXT NOT NULL,
  resume_session_id TEXT,
  recovery_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(actor_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_pending_recoveries_thread ON pending_recoveries(room_id, thread_id);

-- Skills library (migrations/20261027-skills-library.sql). messages.skill_refs is added by that migration.
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  argument_hint TEXT DEFAULT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  current_revision_id INTEGER DEFAULT NULL,
  created_by_actor_id INTEGER DEFAULT NULL,
  created_by_sub_agent_id INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by_actor_id) REFERENCES actors(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_sub_agent_id) REFERENCES sub_agents(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS skill_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  author_actor_id INTEGER DEFAULT NULL,
  author_sub_agent_id INTEGER DEFAULT NULL,
  note TEXT DEFAULT NULL,
  source_url TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (skill_id, version),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS skill_files (
  revision_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mode INTEGER NOT NULL DEFAULT 420,
  PRIMARY KEY (revision_id, path),
  FOREIGN KEY (revision_id) REFERENCES skill_revisions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_files_sha ON skill_files(sha256);
CREATE INDEX IF NOT EXISTS idx_skills_created_by_actor ON skills(created_by_actor_id);
-- Git source of a skill (migrations/20261029-skill-sources.sql, lib/skill-git.js).
CREATE TABLE IF NOT EXISTS skill_sources (
  skill_id INTEGER PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('git')),
  url TEXT NOT NULL,
  ref TEXT DEFAULT NULL,
  subdir TEXT DEFAULT NULL,
  commit_sha TEXT DEFAULT NULL,
  synced_revision_id INTEGER DEFAULT NULL,
  checked_commit TEXT DEFAULT NULL,
  checked_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Harness accounts & limits per agent machine (migrations/20261030-harness-accounts.sql, lib/harness-accounts.js).
CREATE TABLE IF NOT EXISTS harness_account_snapshots (
  machine_id TEXT PRIMARY KEY,
  hostname TEXT,
  platform TEXT,
  payload TEXT NOT NULL,
  probed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_machines (
  actor_id INTEGER PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_machines_machine ON agent_machines(machine_id);
-- Model a run proved unknown to one agent's CLI (migrations/20261110-claude-models-from-cli.sql).
CREATE TABLE IF NOT EXISTS agent_model_failures (
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  harness TEXT NOT NULL,
  model_id TEXT NOT NULL,
  cli_version TEXT,
  failed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (actor_id, harness, model_id)
);
-- Kanban task board per room (migrations/20261112-room-tasks.sql, lib/room-tasks.js).
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
  -- migrations/20261112-task-claimed-by.sql: set when an agent started the card itself (no runner thread).
  claimed_by_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE SET NULL,
  claimed_by_sub_agent_id INTEGER DEFAULT NULL REFERENCES sub_agents(id) ON DELETE SET NULL,
  UNIQUE(room_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_room_tasks_col_rank ON room_tasks(room_id, col, rank);
CREATE INDEX IF NOT EXISTS idx_room_tasks_status ON room_tasks(room_id, status);
-- Foreign keys to actors / sub_agents: an actor or sub-agent delete updates its rows without a scan.
CREATE INDEX IF NOT EXISTS idx_room_tasks_assignee ON room_tasks(assignee_actor_id) WHERE assignee_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_assignee_sub ON room_tasks(assignee_sub_agent_id) WHERE assignee_sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_created_by ON room_tasks(created_by_actor_id) WHERE created_by_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_claimed_by ON room_tasks(claimed_by_actor_id) WHERE claimed_by_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_tasks_claimed_by_sub ON room_tasks(claimed_by_sub_agent_id) WHERE claimed_by_sub_agent_id IS NOT NULL;

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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completion_mode TEXT NOT NULL DEFAULT 'quiet' CHECK(completion_mode IN ('quiet','agent'))
);

CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id) WHERE task_id IS NOT NULL;

-- Venice video jobs (lib/venice-video.js): queue_id + one-time download_url kept for the poller, which
-- resumes queued/processing rows after a restart. download_url is cleared at the end and never returned.
CREATE TABLE IF NOT EXISTS video_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL,
  room_id INTEGER NOT NULL,
  thread_id INTEGER,
  actor_id INTEGER NOT NULL,
  sub_agent_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed','timeout')),
  kind TEXT NOT NULL CHECK(kind IN ('t2v','i2v')),
  mode TEXT NOT NULL CHECK(mode IN ('standard','uncensored')),
  model TEXT NOT NULL,
  duration TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  quote_usd REAL,
  queue_id TEXT,
  download_url TEXT,
  key_ref TEXT,
  poll_failures INTEGER NOT NULL DEFAULT 0,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  deadline_at INTEGER,
  error TEXT,
  upload_url TEXT,
  message_id INTEGER,
  wake_pending INTEGER NOT NULL DEFAULT 0 CHECK(wake_pending IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_active ON video_jobs(status, next_poll_at) WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_video_jobs_room_active ON video_jobs(room_id) WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_video_jobs_platform ON video_jobs(platform_id, id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_wake ON video_jobs(id) WHERE wake_pending=1;

-- Knowledge: nodes, sources, edges, usage. See migrations/20261118-knowledge-schema.sql (same statements;
-- deletion is enforced by the knowledge_sources_ad trigger and FK cascades, not by server.js).
-- status 'stale' = at least one source was deleted; the node waits for re-extraction from the
-- sources it still has (queue: WHERE status='stale' ORDER BY stale_at). Search and retrieval MUST
-- filter status='active': a stale summary may still describe content that has been deleted.
-- embedding: same format as message_embeddings.vec (little-endian Float32, lib/semantic-index.js);
-- embedding_model keys the vector space, a different model means the vector must be recomputed.
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL CHECK(category IN ('eng','ops','dec','res')),
  embedding BLOB,
  embedding_model TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale')),
  stale_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(embedding IS NULL OR embedding_model IS NOT NULL),
  CHECK((status = 'stale') = (stale_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_status ON knowledge_nodes(status, stale_at);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  added_by_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  bytes INTEGER,
  updated_at TEXT,
  updated_by_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_room ON knowledge_documents(room_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_actor ON knowledge_documents(added_by_actor_id) WHERE added_by_actor_id IS NOT NULL;
-- Knowledge documents (migrations/20261119-knowledge-documents.sql): name identifies a document in its
-- room (re-adding it updates it); updated_at has no default (ADD COLUMN), the code writes it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_name ON knowledge_documents(room_id, name);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_updated_by ON knowledge_documents(updated_by_actor_id) WHERE updated_by_actor_id IS NOT NULL;

-- One row per (node, message) or (node, document); exactly one of the two is set.
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  section TEXT,
  section_hash TEXT,
  CHECK((message_id IS NULL) <> (document_id IS NULL)),
  UNIQUE(node_id, message_id),
  UNIQUE(node_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_message ON knowledge_sources(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_document ON knowledge_sources(document_id) WHERE document_id IS NOT NULL;
-- Document sources: section key and the sha256 of its stored text (lib/knowledge-documents.js).
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_sources_doc_section ON knowledge_sources(document_id, section) WHERE document_id IS NOT NULL;

-- Undirected edge stored once: node_a < node_b.
CREATE TABLE IF NOT EXISTS knowledge_edges (
  node_a INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  node_b INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  CHECK(node_a < node_b),
  UNIQUE(node_a, node_b)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_b ON knowledge_edges(node_b);

-- sub_agent_id ON DELETE SET NULL: the use still happened under actor_id (the sub-agent's parent);
-- deleting a sub-agent must not erase a node's usage history. sub_agent_label: its label at the time
-- of the use (migrations/20261119-knowledge-privacy.sql).
CREATE TABLE IF NOT EXISTS knowledge_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE SET NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (datetime('now')),
  sub_agent_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_node ON knowledge_usage(node_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_room ON knowledge_usage(room_id, used_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_actor ON knowledge_usage(actor_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_sub_agent ON knowledge_usage(sub_agent_id) WHERE sub_agent_id IS NOT NULL;
-- GET /api/knowledge/usage: range on used_at, node_id read from the index (migrations/20261119-knowledge-usage-time.sql).
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_time ON knowledge_usage(used_at, node_id);

-- A source is gone (its message/document was deleted, or the row itself): a node with no source
-- left is deleted (edges/usage cascade), otherwise it turns stale. COALESCE keeps the original
-- stale_at so a node already queued is not pushed back. Fires once per row, so a multi-row delete
-- (thread, room) ends with the node deleted once its last source goes. When the node itself is
-- deleted, its sources cascade here and both statements match nothing.
CREATE TRIGGER IF NOT EXISTS knowledge_sources_ad AFTER DELETE ON knowledge_sources BEGIN
  DELETE FROM knowledge_nodes WHERE id = old.node_id
    AND NOT EXISTS (SELECT 1 FROM knowledge_sources WHERE node_id = old.node_id);
  UPDATE knowledge_nodes SET status = 'stale', stale_at = COALESCE(stale_at, datetime('now')), updated_at = datetime('now')
    WHERE id = old.node_id;
END;

-- Knowledge privacy: origin rooms per node and the archive of deleted, used nodes. See
-- migrations/20261119-knowledge-privacy.sql (same statements, without the backfill).
-- Rooms a node has ever had a source in. Filled by knowledge_sources_ai; never cleared when a source
-- goes (only with the node or the room).
CREATE TABLE IF NOT EXISTS knowledge_node_rooms (
  node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(node_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_node_rooms_room ON knowledge_node_rooms(room_id);

-- NOT EXISTS instead of OR IGNORE: inside a trigger the outer statement's conflict clause would win.
CREATE TRIGGER IF NOT EXISTS knowledge_sources_ai AFTER INSERT ON knowledge_sources BEGIN
  INSERT INTO knowledge_node_rooms (node_id, room_id)
    SELECT new.node_id, src.room_id FROM (SELECT COALESCE(
      (SELECT room_id FROM messages WHERE id = new.message_id),
      (SELECT room_id FROM knowledge_documents WHERE id = new.document_id)) AS room_id) src
    WHERE src.room_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM knowledge_node_rooms WHERE node_id = new.node_id AND room_id = src.room_id);
END;

-- A deleted node that had been used. node_id has no FK (the node is gone); node ids are AUTOINCREMENT,
-- never reused, so one archive row per node.
CREATE TABLE IF NOT EXISTS knowledge_deleted_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_deleted_nodes_node ON knowledge_deleted_nodes(node_id);

CREATE TABLE IF NOT EXISTS knowledge_deleted_node_rooms (
  deleted_id INTEGER NOT NULL REFERENCES knowledge_deleted_nodes(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(deleted_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_node_rooms_room ON knowledge_deleted_node_rooms(room_id);

-- id = the knowledge_usage.id it was copied from (AUTOINCREMENT, never reused), so live and archived
-- uses share one id space and the history pages through both with one cursor.
CREATE TABLE IF NOT EXISTS knowledge_deleted_usage (
  id INTEGER PRIMARY KEY,
  deleted_id INTEGER NOT NULL REFERENCES knowledge_deleted_nodes(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  actor_name TEXT,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE SET NULL,
  sub_agent_label TEXT,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  room_title TEXT,
  used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_deleted ON knowledge_deleted_usage(deleted_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_actor ON knowledge_deleted_usage(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_sub_agent ON knowledge_deleted_usage(sub_agent_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_deleted_usage_room ON knowledge_deleted_usage(room_id) WHERE room_id IS NOT NULL;

-- Every delete path (panel, message / thread / room / document deletion through knowledge_sources_ad)
-- passes here, before the cascade takes usage and node_rooms with the node. Only a node that was used
-- is archived: with no use there is no copy to trace, and its title (itself possibly sensitive) is not
-- kept.
CREATE TRIGGER IF NOT EXISTS knowledge_nodes_bd BEFORE DELETE ON knowledge_nodes
WHEN EXISTS (SELECT 1 FROM knowledge_usage WHERE node_id = old.id)
  AND EXISTS (SELECT 1 FROM knowledge_node_rooms WHERE node_id = old.id) BEGIN
  INSERT INTO knowledge_deleted_nodes (node_id, title, category) VALUES (old.id, old.title, old.category);
  INSERT INTO knowledge_deleted_node_rooms (deleted_id, room_id)
    SELECT (SELECT id FROM knowledge_deleted_nodes WHERE node_id = old.id), room_id FROM knowledge_node_rooms WHERE node_id = old.id;
  INSERT INTO knowledge_deleted_usage (id, deleted_id, actor_id, actor_name, sub_agent_id, sub_agent_label, room_id, room_title, used_at)
    SELECT u.id, (SELECT id FROM knowledge_deleted_nodes WHERE node_id = old.id), u.actor_id, a.name, u.sub_agent_id, u.sub_agent_label,
      u.room_id, r.title, u.used_at
    FROM knowledge_usage u LEFT JOIN actors a ON a.id = u.actor_id LEFT JOIN rooms r ON r.id = u.room_id
    WHERE u.node_id = old.id;
END;

-- An archive no room can show any more (its last origin room was deleted) is dropped: it would be
-- unreachable from every panel and only keep the title around.
CREATE TRIGGER IF NOT EXISTS knowledge_deleted_node_rooms_ad AFTER DELETE ON knowledge_deleted_node_rooms
WHEN NOT EXISTS (SELECT 1 FROM knowledge_deleted_node_rooms WHERE deleted_id = old.deleted_id) BEGIN
  DELETE FROM knowledge_deleted_nodes WHERE id = old.deleted_id;
END;

-- Knowledge layout: cached 3D positions of the knowledge brain. See migrations/20261120-knowledge-layout.sql
-- (same statements).

-- The projection basis (one row): mean vector, 3 principal components and their spreads of the node
-- embeddings of `model`, as little-endian Float32 (lib/knowledge-layout.js packBasis). n_basis = nodes
-- it was computed from; the module decides when it is recomputed.
CREATE TABLE IF NOT EXISTS knowledge_layout_basis (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  n_basis INTEGER NOT NULL,
  basis BLOB NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Position per node. model = the embedding model the position was projected from; '' = the node had
-- no vector of that model and sits at a spot derived from its id.
CREATE TABLE IF NOT EXISTS knowledge_node_layout (
  node_id INTEGER PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  model TEXT NOT NULL
);

-- A node whose vector changes (re-extraction, merge, document section rewritten) is about something
-- else now: its position is dropped and projected again on the next graph read. Adding a node never
-- moves another one.
CREATE TRIGGER IF NOT EXISTS knowledge_nodes_layout_au AFTER UPDATE OF embedding, embedding_model ON knowledge_nodes
WHEN new.embedding IS NOT old.embedding OR new.embedding_model IS NOT old.embedding_model BEGIN
  DELETE FROM knowledge_node_layout WHERE node_id = new.id;
END;

-- Knowledge extraction queue. See migrations/20261118-knowledge-extraction.sql (same statements).

-- How far each conversation has been summarized: thread_id NULL = the room's main feed, else a
-- thread root. A job reads complete messages after through_message_id; success moves it forward.
CREATE TABLE IF NOT EXISTS knowledge_cursors (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  through_message_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_cursors_key ON knowledge_cursors(room_id, COALESCE(thread_id, 0));
CREATE INDEX IF NOT EXISTS idx_knowledge_cursors_thread ON knowledge_cursors(thread_id) WHERE thread_id IS NOT NULL;

-- A queue, not a log: a job that succeeds is deleted. node_id set = re-summarize a stale node
-- (reason 'stale'); otherwise the job reads a conversation (room_id, thread_id). 'failed' after
-- the last attempt stays as a tombstone so the idle sweep does not retry it forever; a new
-- thread-complete / task-done trigger replaces it. leased_actor_id = the agent the job was sent
-- to; only its knowledge_extract_result is accepted.
CREATE TABLE IF NOT EXISTS knowledge_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('thread_complete','task_done','idle','stale')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  leased_actor_id INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  leased_at TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((reason = 'stale') = (node_id IS NOT NULL)),
  CHECK((status = 'running') = (leased_actor_id IS NOT NULL AND leased_at IS NOT NULL))
);
-- One pending job per conversation and per node: a second trigger is a no-op (INSERT OR IGNORE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_jobs_conv_pending ON knowledge_jobs(room_id, COALESCE(thread_id, 0))
  WHERE status = 'pending' AND node_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_jobs_node_pending ON knowledge_jobs(node_id)
  WHERE status = 'pending' AND node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status ON knowledge_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_conv ON knowledge_jobs(room_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_thread ON knowledge_jobs(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_node ON knowledge_jobs(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_actor ON knowledge_jobs(leased_actor_id) WHERE leased_actor_id IS NOT NULL;

-- Deleting an actor that holds a lease: leased_actor_id ON DELETE SET NULL alone would leave a
-- running job without its lease holder, which the running CHECK refuses (the DELETE would fail).
-- So the job goes back to pending first; if a pending twin for the same conversation or node was
-- queued meanwhile, the running job is deleted instead (the twin covers it, from the same cursor).
-- Same rule as dropTwinned in lib/knowledge-extraction.js.
CREATE TRIGGER IF NOT EXISTS knowledge_jobs_actor_bd BEFORE DELETE ON actors BEGIN
  DELETE FROM knowledge_jobs WHERE status = 'running' AND leased_actor_id = old.id
    AND EXISTS (SELECT 1 FROM knowledge_jobs p WHERE p.status = 'pending' AND CASE WHEN knowledge_jobs.node_id IS NULL
      THEN p.node_id IS NULL AND p.room_id = knowledge_jobs.room_id AND COALESCE(p.thread_id, 0) = COALESCE(knowledge_jobs.thread_id, 0)
      ELSE p.node_id = knowledge_jobs.node_id END);
  UPDATE knowledge_jobs SET status = 'pending', leased_actor_id = NULL, leased_at = NULL, updated_at = datetime('now')
    WHERE status = 'running' AND leased_actor_id = old.id;
END;

-- Editing a message's text makes every node built from it stale: the summary may no longer match.
-- The source stays; re-extraction reads the new text. Only a real content change counts (state
-- or other column updates, and writes of the same text, do not). Streaming replies are not
-- sources yet (only complete messages are extracted), so their updates touch no node.
CREATE TRIGGER IF NOT EXISTS knowledge_messages_au AFTER UPDATE OF content ON messages
WHEN old.content IS NOT new.content BEGIN
  UPDATE knowledge_nodes SET status = 'stale', stale_at = COALESCE(stale_at, datetime('now')), updated_at = datetime('now')
    WHERE id IN (SELECT node_id FROM knowledge_sources WHERE message_id = new.id);
END;

