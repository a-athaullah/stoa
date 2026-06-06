-- Add automation feature: Slack Socket Mode integration
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
