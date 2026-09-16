-- Add watch_reply to automations (only relevant for Slack provider)
ALTER TABLE automations ADD COLUMN watch_reply INTEGER NOT NULL DEFAULT 0;

-- Add slack_thread_ts to messages for tracking Slack thread references
ALTER TABLE messages ADD COLUMN slack_thread_ts TEXT DEFAULT NULL;

-- Index for fast lookup when matching incoming Slack thread replies
CREATE INDEX IF NOT EXISTS idx_messages_slack_thread_ts ON messages(slack_thread_ts) WHERE slack_thread_ts IS NOT NULL;
