-- Thread "mark as complete" (owner only). Set on the thread ROOT message. thread_completed_through is
-- the newest reply id when it was marked: a reply with a larger id reopens the thread (derived on
-- read, lib/room-messages.js THREAD_COMPLETED), so no insert path needs a hook.
ALTER TABLE messages ADD COLUMN thread_completed_at TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN thread_completed_through INTEGER DEFAULT NULL;
