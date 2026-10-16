-- Agent default model + model_source on messages
ALTER TABLE actors ADD COLUMN default_model TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN model_source TEXT DEFAULT NULL;
