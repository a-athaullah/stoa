-- Fix: compact_complete without thread_id wrote thread-specific session IDs to thread_id=0 rows.
-- NULL out claude_session_id on thread_id=0 rows where the same session ID exists on a non-zero thread
-- for the same participant. This forces the next wake at thread 0 to start a fresh session
-- instead of resuming a session that belongs to another thread.
UPDATE ai_sessions SET claude_session_id = NULL
WHERE thread_id = 0
  AND claude_session_id IN (
    SELECT a2.claude_session_id FROM ai_sessions a2
    WHERE a2.participant_id = ai_sessions.participant_id
      AND a2.thread_id != 0
      AND a2.claude_session_id = ai_sessions.claude_session_id
  );
