CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_actor_id ON usage_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_actor_created ON usage_log(actor_id, created_at);
