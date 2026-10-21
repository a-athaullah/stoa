-- Indexes found missing by .claude/tools/query-plan-audit.js (see ~/project/stoa-feature/query-index-audit.md).
-- messages.automation_id: ON DELETE SET NULL from automations otherwise scans every message.
-- Partial: almost all messages have no automation, so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_messages_automation_id ON messages(automation_id) WHERE automation_id IS NOT NULL;
-- pending_wakes: FK cascade checks on every message / room participant delete, plus wake lookups.
CREATE INDEX IF NOT EXISTS idx_pending_wakes_sub_agent_message ON pending_wakes(sub_agent_message_id);
CREATE INDEX IF NOT EXISTS idx_pending_wakes_parent_participant ON pending_wakes(parent_participant_id);
-- ai_sessions.claude_session_id: session events from the agent are keyed by the Claude session id.
CREATE INDEX IF NOT EXISTS idx_ai_sessions_claude_session_id ON ai_sessions(claude_session_id);
