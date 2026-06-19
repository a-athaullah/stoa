CREATE INDEX IF NOT EXISTS idx_usage_log_model ON usage_log(model);
CREATE INDEX IF NOT EXISTS idx_usage_log_model_created ON usage_log(model, created_at);
