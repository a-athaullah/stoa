-- R17: idempotent message insert via client-supplied event ID.
--
-- When a browser or agent sends a message during an unstable connection it may
-- retry and post the same logical message twice. Adding a nullable
-- client_event_id + a partial UNIQUE index on (room_id, client_event_id)
-- WHERE client_event_id IS NOT NULL lets the server detect the duplicate and
-- return the original row instead of inserting a second one.
--
-- The column is NULL-able so all existing rows and clients that do not supply
-- an event ID continue to work without change (no dedup applied for them).
-- Clients that DO supply an event ID use UUIDv4, scoped to room_id to prevent
-- cross-room ID collisions from being treated as duplicates.

ALTER TABLE messages ADD COLUMN client_event_id TEXT DEFAULT NULL;

-- Partial index: only rows with a non-NULL client_event_id participate in
-- uniqueness enforcement. SQLite WHERE clause on CREATE INDEX is supported
-- since SQLite 3.8.0 (2013) — well within the project's minimum.
CREATE UNIQUE INDEX messages_room_client_event
  ON messages(room_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
