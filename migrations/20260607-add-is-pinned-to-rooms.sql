-- Add is_pinned column to rooms table for pin room feature
ALTER TABLE rooms ADD COLUMN is_pinned INTEGER DEFAULT 0;
