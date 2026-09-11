-- Backfill thread_id for legacy messages using reply_to chains.
-- Root = end of reply_to chain within the same room, max depth 20.
-- Messages without reply_to (or pointing to a different room) stay as root (thread_id NULL).
-- Idempotent: only processes messages where thread_id IS NULL AND reply_to IS NOT NULL.

CREATE TEMP TABLE _backfill_chain (
  msg_id INTEGER,
  current_id INTEGER,
  depth INTEGER
);

INSERT INTO _backfill_chain (msg_id, current_id, depth)
WITH RECURSIVE chain(msg_id, current_id, room_id, depth) AS (
  SELECT m.id, m.reply_to, m.room_id, 1
  FROM messages m
  JOIN messages parent ON parent.id = m.reply_to
  WHERE m.reply_to IS NOT NULL
    AND m.thread_id IS NULL
    AND parent.room_id = m.room_id
  UNION ALL
  SELECT c.msg_id, cur.reply_to, c.room_id, c.depth + 1
  FROM chain c
  JOIN messages cur ON cur.id = c.current_id
  JOIN messages parent ON parent.id = cur.reply_to
  WHERE parent.room_id = c.room_id
    AND c.depth < 20
)
SELECT msg_id, current_id, depth FROM chain;

UPDATE messages SET thread_id = (
  SELECT bc.current_id FROM _backfill_chain bc
  WHERE bc.msg_id = messages.id
  ORDER BY bc.depth DESC LIMIT 1
)
WHERE id IN (SELECT DISTINCT msg_id FROM _backfill_chain)
  AND thread_id IS NULL;

DROP TABLE _backfill_chain;
