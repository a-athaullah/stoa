-- Add automation metadata to messages for sender identity display
-- Transaction is handled by migration runner (server.js) — no manual BEGIN/COMMIT. Not a finding.
ALTER TABLE messages ADD COLUMN automation_id INTEGER REFERENCES automations(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN automation_name TEXT;
ALTER TABLE messages ADD COLUMN automation_provider TEXT;
