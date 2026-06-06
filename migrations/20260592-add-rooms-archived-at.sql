-- Add archived_at column to rooms for soft-delete / archive feature
ALTER TABLE rooms ADD COLUMN archived_at TEXT DEFAULT NULL;
