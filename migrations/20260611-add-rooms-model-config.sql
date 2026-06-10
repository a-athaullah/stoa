-- Store platform-specific config per room (base_url, api_key as JSON)
-- NULL = Anthropic subscription (no extra env vars needed)
ALTER TABLE rooms ADD COLUMN model_config TEXT DEFAULT NULL;
