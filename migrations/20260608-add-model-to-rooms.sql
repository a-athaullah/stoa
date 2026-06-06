-- Add model column to rooms table for switch model feature
ALTER TABLE rooms ADD COLUMN model TEXT DEFAULT NULL;
