-- Add available_models column to actors for Ollama model discovery
ALTER TABLE actors ADD COLUMN available_models TEXT DEFAULT NULL;
