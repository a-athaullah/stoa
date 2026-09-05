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
