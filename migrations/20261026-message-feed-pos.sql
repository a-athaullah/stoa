-- Display order of the room feed and threads. An agent's reply row is a placeholder inserted when its
-- turn starts, so its id sits before the proactive progress messages it posts during the turn; ordering
-- by id showed the final reply above that progress. feed_pos is the sort key instead: it equals id
-- for every row, except that a reply which finishes after its own newer messages in the same scope
-- moves just past the last of them. id never changes (reply_to, thread_id, tool steps, wakes, Slack
-- and the agent protocol all reference it). Reads ORDER BY feed_pos, id; before/since cursors stay
-- message ids and are resolved to the cursor row's feed_pos.
-- Column added here only (not in the schema.sqlite.sql CREATE): boot runs the schema before the
-- migrations, and an existing DB would hit the index on a column it does not have yet.
ALTER TABLE messages ADD COLUMN feed_pos REAL;
UPDATE messages SET feed_pos = id WHERE feed_pos IS NULL;

-- Every insert site gets feed_pos = id without each one having to set it.
CREATE TRIGGER IF NOT EXISTS messages_feed_pos_ai AFTER INSERT ON messages WHEN NEW.feed_pos IS NULL BEGIN
  UPDATE messages SET feed_pos = NEW.id WHERE id = NEW.id;
END;

-- A run that ends (complete or error, from streaming/requesting, or a sub-agent run held in error
-- while awaiting its agent) after the same participant + sub-agent posted newer messages in the same
-- scope (same thread, or the root feed) lands 0.5 past the last of them: after its own progress,
-- before anything newer than that. A trigger, so every finishing path is covered (agent_complete,
-- stop, disconnect/reconnect cleanup, server-restart orphans) without wiring each UPDATE site.
CREATE TRIGGER IF NOT EXISTS messages_feed_pos_settle AFTER UPDATE OF state ON messages
WHEN OLD.state IS NOT NEW.state
  AND OLD.state IN ('streaming', 'requesting', 'error')
  AND NEW.state IN ('complete', 'error')
BEGIN
  UPDATE messages SET feed_pos = (
    SELECT MAX(p.feed_pos) FROM messages p
    WHERE p.participant_id = NEW.participant_id AND p.room_id = NEW.room_id AND p.id > NEW.id
      AND p.sub_agent_id IS NEW.sub_agent_id AND p.thread_id IS NEW.thread_id
  ) + 0.5
  WHERE id = NEW.id AND (
    SELECT MAX(p.feed_pos) FROM messages p
    WHERE p.participant_id = NEW.participant_id AND p.room_id = NEW.room_id AND p.id > NEW.id
      AND p.sub_agent_id IS NEW.sub_agent_id AND p.thread_id IS NEW.thread_id
  ) > feed_pos;
END;

CREATE INDEX IF NOT EXISTS idx_messages_room_feed_pos ON messages(room_id, feed_pos, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_feed_pos ON messages(thread_id, feed_pos, id) WHERE thread_id IS NOT NULL;
