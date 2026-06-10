-- Remove agent_workdirs.model column
-- Single source of truth for model is now rooms.model
ALTER TABLE agent_workdirs DROP COLUMN model;
