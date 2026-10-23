-- Tool steps reported while an agent answers ([{name, summary}], capped in lib/tool-steps.js),
-- so the chat process trail survives a reload. NULL for messages without tool calls.
-- Not in schema.sqlite.sql: boot runs schema then migrations, so the ALTER would hit a duplicate column.
ALTER TABLE messages ADD COLUMN tool_steps TEXT DEFAULT NULL;
