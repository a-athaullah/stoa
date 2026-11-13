'use strict';
// Diagnostics for api_format 'openai_chat' platforms whose model writes its native tool-call markup
// (DeepSeek "<｜DSML｜ calls>") into the reply text instead of returning tool_calls — the agent then
// sees plain text and ends the turn without running any tool. A leak writes one JSON line describing
// the request SHAPE (counts, tool names, flags), never message contents, the system prompt or any key.
const fs = require('fs');
const path = require('path');

const MARKER = 'DSML';
const HEAD_CHARS = 600;
const MAX_DROPPED_NAMES = 50;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

// Streams arrive in pieces and the marker may straddle two deltas: carry the tail of the previous one.
function createLeakDetector() {
  let head = '';
  let tail = '';
  let leaked = false;
  return {
    push(text) {
      if (typeof text !== 'string' || !text) return;
      if (head.length < HEAD_CHARS) head += text.slice(0, HEAD_CHARS - head.length);
      if (!leaked && (tail + text).includes(MARKER)) leaked = true;
      tail = (tail + text).slice(-(MARKER.length - 1));
    },
    get leaked() { return leaked; },
    get head() { return head; },
  };
}

function systemChars(system) {
  if (typeof system === 'string') return system.length;
  if (!Array.isArray(system)) return 0;
  return system.reduce((n, b) => n + (b?.type === 'text' && typeof b.text === 'string' ? b.text.length : 0), 0);
}

function toolChoiceShape(tc) {
  if (!tc || typeof tc !== 'object') return null;
  const out = { type: typeof tc.type === 'string' ? tc.type : null };
  if (tc.type === 'tool' && typeof tc.name === 'string') out.name = tc.name;
  if (tc.disable_parallel_tool_use === true) out.disable_parallel_tool_use = true;
  return out;
}

// body: the Anthropic request as the CLI sent it; sent: what toOpenAIRequest produced.
function buildLeakEntry({ body, sent, reqModel, model, platformId, stream, head, finishReason, now = new Date() }) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const sentNames = new Set((Array.isArray(sent?.tools) ? sent.tools : []).map(t => t?.function?.name));
  const dropped = tools.map(t => (typeof t?.name === 'string' ? t.name : '?')).filter(n => !sentNames.has(n));
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return {
    ts: now.toISOString(),
    platform: String(platformId ?? ''),
    requested_model: String(reqModel ?? ''),
    upstream_model: String(model ?? ''),
    stream: stream === true,
    tools_in: tools.length,
    tools_sent: sentNames.size,
    tools_dropped: dropped.slice(0, MAX_DROPPED_NAMES),
    tools_dropped_total: dropped.length,
    tool_choice: toolChoiceShape(body?.tool_choice),
    tool_choice_sent: sent?.tool_choice ?? null,
    messages_in: messages.length,
    messages_sent: Array.isArray(sent?.messages) ? sent.messages.length : 0,
    last_role: messages.at(-1)?.role ?? null,
    system_chars: systemChars(body?.system),
    has_thinking: body?.thinking != null,
    thinking_type: typeof body?.thinking?.type === 'string' ? body.thinking.type : null,
    has_metadata: body?.metadata != null,
    max_tokens: Number.isFinite(body?.max_tokens) ? body.max_tokens : null,
    finish_reason: finishReason ?? null,
    content_head: String(head ?? '').slice(0, HEAD_CHARS),
  };
}

// Past maxBytes the file is rotated to <file>.1 (one generation kept), so it stays bounded at ~2x.
async function appendLeakEntry(file, entry, maxBytes = MAX_LOG_BYTES) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const size = await fs.promises.stat(file).then(s => s.size, () => 0);
  if (size >= maxBytes) await fs.promises.rename(file, `${file}.1`);
  await fs.promises.appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

module.exports = { createLeakDetector, buildLeakEntry, appendLeakEntry, MAX_LOG_BYTES };
