-- Harness accounts & limits (lib/harness-accounts.js): the last snapshot an agent machine reported
-- about its Claude / Codex login and plan limits, and which machine each agent runs on. machine_id is
-- a hash computed by stoa.js (hostname, OS user, harness config dirs); payload is the server-validated
-- JSON of { claude, codex }. Tokens are never part of it.
-- New tables only: no existing data is touched.
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
