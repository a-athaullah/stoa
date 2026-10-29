-- Where a skill came from, for skills imported from a git repository (or GitHub): url / ref / subdir
-- to fetch again, the commit the current content was taken from, and the last `ls-remote` result.
-- synced_revision_id is the revision a git import / update wrote; a current revision other than it
-- means local edits since (plain integer, no FK: pruning may drop that revision, which then reads as
-- "changed locally" — true by then). The url never carries credentials (rejected before it is stored).
-- New table only: no existing data is touched.
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
