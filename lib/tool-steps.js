// Tool steps an agent reports while answering, stored on the message so the chat's process
// trail survives a reload. Only what the trail shows is kept: the tool name and a one-line summary.

const MAX_STEPS = 50;
const MAX_NAME = 200;
const MAX_SUMMARY = 64;

// Must match toolSummary() in public/js/chat/trail.js (test.js checks both on the same inputs).
const SUMMARY_KEYS = { Bash: 'command', Read: 'file_path', Write: 'file_path', Edit: 'file_path',
  Glob: 'pattern', Grep: 'pattern', WebFetch: 'url', WebSearch: 'query',
  NotebookEdit: 'notebook_path', mcp__ide__executeCode: 'code' };

function toolStepSummary(name, input) {
  if (!input || typeof input !== 'object') return '';
  const key = SUMMARY_KEYS[name];
  let val = (key && input[key]) ? String(input[key]) : (Object.values(input).find(v => typeof v === 'string') || '');
  if (val.length > MAX_SUMMARY) val = val.slice(0, MAX_SUMMARY - 3) + '…';
  return val;
}

function compactToolStep(tool) {
  if (!tool || typeof tool.name !== 'string' || !tool.name) return null;
  return { name: tool.name.slice(0, MAX_NAME), summary: toolStepSummary(tool.name, tool.input) };
}

// Appends while the message is still running and only to a message posted by actorId, so an agent
// cannot write steps onto another actor's message or onto a finished one.
function recordToolStep(db, { messageId, actorId, tool }) {
  const step = compactToolStep(tool);
  if (!step || !Number.isInteger(Number(messageId)) || !actorId) return false;
  const r = db.prepare(`
    UPDATE messages SET tool_steps = json_insert(COALESCE(tool_steps, '[]'), '$[#]', json(?))
    WHERE id = ? AND state IN ('requesting','streaming')
      AND participant_id IN (SELECT id FROM room_participants WHERE actor_id = ?)
      AND json_array_length(COALESCE(tool_steps, '[]')) < ?
  `).run(JSON.stringify(step), Number(messageId), actorId, MAX_STEPS);
  return r.changes > 0;
}

module.exports = { MAX_STEPS, toolStepSummary, compactToolStep, recordToolStep };
