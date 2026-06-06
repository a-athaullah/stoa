-- Add model column to agent_workdirs for per-workdir model override
ALTER TABLE agent_workdirs ADD COLUMN model TEXT DEFAULT NULL;
