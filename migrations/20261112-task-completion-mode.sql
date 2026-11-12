-- Task board runner: how a card's run ends, per room. 'quiet' (default, the behaviour so far): the card's
-- thread staying quiet ends it, the last agent reply is the result. 'agent': a quiet thread never ends it;
-- only stoa__task_complete / _block / _fail do (with a nudge and a timeout to Awaiting in the runner).
-- One column with a default, no existing row changes. Same column is in db/schema.sqlite.sql for a fresh
-- clone; the ALTER is skipped there as "already present".
ALTER TABLE room_task_settings ADD COLUMN completion_mode TEXT NOT NULL DEFAULT 'quiet' CHECK(completion_mode IN ('quiet','agent'));
