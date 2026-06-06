-- Add missing indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(trigger_type, trigger_event, enabled);
CREATE INDEX IF NOT EXISTS idx_actors_type ON actors(type);
CREATE INDEX IF NOT EXISTS idx_messages_state ON messages(state);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_settings_scope_key ON settings(scope, key_name);
