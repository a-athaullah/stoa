-- Venice video jobs (stoa__video_generate, lib/venice-video.js). Venice has no endpoint listing past
-- jobs, so queue_id (and download_url, sent only once) must live here; the server poller resumes every
-- queued/processing row after a restart. download_url is a pre-signed URL: cleared when the job ends,
-- never returned by any endpoint or tool. key_ref is a short sha256 of the API key that queued the job
-- (the job belongs to that key's account), never the key. Times: next_poll_at / deadline_at are epoch ms.
-- No foreign keys: a job of a deleted room or platform is failed by the poller, not cascaded away
-- (its media at Venice is still cleaned up). New table only, no existing row changes.
-- Same table is in db/schema.sqlite.sql for a fresh clone.
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
