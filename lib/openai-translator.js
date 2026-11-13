'use strict';
// Anthropic Messages <-> OpenAI Chat Completions translation for platforms with api_format
// 'openai_chat'. Pure: no network, no filesystem, no database. The /v1/messages proxy in
// server.js does the I/O and calls in here.
const crypto = require('crypto');

const genId = (prefix) => `${prefix}${crypto.randomBytes(12).toString('hex')}`;

// base_url may be given with or without /v1, or as the full /chat/completions endpoint.
// A bare origin gets /v1 (the common convention); any other path is taken as the API root
// as configured (e.g. /api/paas/v4, /v1beta/openai), so providers off the /v1 pattern still work.
function chatCompletionsUrl(baseUrl) {
  const u = new URL(baseUrl);
  let p = u.pathname.replace(/\/+$/, '');
  if (!p.endsWith('/chat/completions')) p = (p || '/v1') + '/chat/completions';
  return u.origin + p;
}

function platformModelNames(plat) {
  if (Array.isArray(plat?.enabled_models) && plat.enabled_models.length) return plat.enabled_models.filter(m => typeof m === 'string');
  if (!Array.isArray(plat?.cached_models)) return [];
  return plat.cached_models.map(m => (typeof m === 'string' ? m : m?.model)).filter(m => typeof m === 'string');
}

// The CLI also calls models of its own (claude-haiku-* for titles, summaries, quick checks) that
// an OpenAI-format platform does not serve. A model the platform lists is sent unchanged; any
// other name maps to the platform's first enabled model (else first discovered model). With no
// model list at all the name passes through and the upstream decides.
function pickModel(requested, plat) {
  const names = platformModelNames(plat);
  if (!names.length || names.includes(requested)) return requested;
  return names[0];
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n\n');
}

function imagePart(block) {
  const src = block?.source;
  if (src?.type === 'base64' && typeof src.data === 'string' && typeof src.media_type === 'string') {
    return { type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } };
  }
  if (src?.type === 'url' && typeof src.url === 'string') return { type: 'image_url', image_url: { url: src.url } };
  return null;
}

// Text-only parts collapse to a plain string: several OpenAI-compatible servers reject part arrays.
function userContent(parts) {
  if (parts.every(p => p.type === 'text')) return parts.map(p => p.text).join('\n\n');
  return parts;
}

function translateUser(content, out) {
  if (typeof content === 'string') { out.push({ role: 'user', content }); return; }
  if (!Array.isArray(content)) return;
  const parts = [];
  // tool messages must directly follow the assistant tool_calls message, so they go first;
  // images returned by a tool (OpenAI tool messages are text-only) ride in the user message after.
  for (const b of content) {
    if (b?.type === 'tool_result') {
      let text = typeof b.content === 'string' ? b.content : blockText(b.content);
      if (Array.isArray(b.content)) for (const c of b.content) { if (c?.type === 'image') { const img = imagePart(c); if (img) parts.push(img); } }
      if (b.is_error) text = `[tool error] ${text}`;
      out.push({ role: 'tool', tool_call_id: String(b.tool_use_id ?? ''), content: text });
    } else if (b?.type === 'text' && typeof b.text === 'string') {
      parts.push({ type: 'text', text: b.text });
    } else if (b?.type === 'image') {
      const img = imagePart(b);
      if (img) parts.push(img);
    }
  }
  if (parts.length) out.push({ role: 'user', content: userContent(parts) });
}

function translateAssistant(content, out) {
  if (typeof content === 'string') { out.push({ role: 'assistant', content }); return; }
  if (!Array.isArray(content)) return;
  const texts = [];
  const toolCalls = [];
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b?.type === 'tool_use') {
      toolCalls.push({ id: String(b.id ?? ''), type: 'function', function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) } });
    }
    // thinking / redacted_thinking: dropped — the upstream cannot verify Anthropic thinking signatures.
  }
  const msg = { role: 'assistant', content: texts.length ? texts.join('\n\n') : (toolCalls.length ? null : '') };
  if (toolCalls.length) msg.tool_calls = toolCalls;
  out.push(msg);
}

const TOOL_CHOICE = { auto: 'auto', any: 'required', none: 'none' };

function toOpenAIRequest(body, model) {
  const messages = [];
  const system = blockText(body.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (m?.role === 'assistant') translateAssistant(m.content, messages);
    else if (m?.role === 'user') translateUser(m.content, messages);
  }
  const out = { model, messages };
  if (Number.isFinite(body.max_tokens)) out.max_tokens = body.max_tokens;
  if (Number.isFinite(body.temperature)) out.temperature = body.temperature;
  if (Number.isFinite(body.top_p)) out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences.slice(0, 4);
  // Server tools (web_search_*, code_execution_*, ...) have no input_schema and only run on Anthropic.
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter(t => t && typeof t.name === 'string' && t.input_schema);
  if (tools.length) {
    out.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema } }));
    const tc = body.tool_choice;
    if (tc?.type === 'tool' && typeof tc.name === 'string') out.tool_choice = { type: 'function', function: { name: tc.name } };
    else if (TOOL_CHOICE[tc?.type]) out.tool_choice = TOOL_CHOICE[tc.type];
    if (tc?.disable_parallel_tool_use === true) out.parallel_tool_calls = false;
  }
  if (body.stream === true) { out.stream = true; out.stream_options = { include_usage: true }; }
  return out;
}

const STOP_REASON = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'refusal' };
const mapStopReason = (finish, hasTools) => (hasTools ? 'tool_use' : (STOP_REASON[finish] || 'end_turn'));

// Anthropic input_tokens excludes cache reads; OpenAI prompt_tokens includes them.
function mapUsage(u) {
  const prompt = Number(u?.prompt_tokens) || 0;
  const cached = Math.min(Number(u?.prompt_tokens_details?.cached_tokens) || 0, prompt);
  return { input_tokens: prompt - cached, output_tokens: Number(u?.completion_tokens) || 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 };
}

function parseArgs(s) {
  if (typeof s !== 'string' || !s.trim()) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

function fromOpenAIResponse(oa, model) {
  const choice = oa?.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content });
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    content.push({ type: 'tool_use', id: tc.id || genId('toolu_'), name: tc.function?.name || '', input: parseArgs(tc.function?.arguments) });
  }
  const hasTools = content.some(b => b.type === 'tool_use');
  return {
    id: genId('msg_'), type: 'message', role: 'assistant', model, content,
    stop_reason: mapStopReason(choice.finish_reason, hasTools), stop_sequence: null, usage: mapUsage(oa?.usage),
  };
}

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

// Same event sequence the streaming path produces, for an upstream that ignored stream:true.
function messageToStreamEvents(m) {
  let out = sse('message_start', { message: { ...m, content: [], stop_reason: null, usage: { ...m.usage, output_tokens: 0 } } });
  m.content.forEach((b, index) => {
    if (b.type === 'text') {
      out += sse('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += sse('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      out += sse('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      out += sse('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    out += sse('content_block_stop', { index });
  });
  out += sse('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: m.usage });
  return out + sse('message_stop', {});
}

// OpenAI SSE -> Anthropic SSE. push() takes decoded text in arbitrary chunk sizes and returns the
// Anthropic events ready to write; end() flushes. Text streams live. Tool calls are collected per
// OpenAI index and emitted as whole tool_use blocks once the stream finishes: providers may
// interleave argument deltas across indexes, and Anthropic blocks cannot be reopened once stopped.
// onText (optional) sees every upstream text delta; it observes only and cannot alter the output.
function createStreamTranslator(model, { onText } = {}) {
  let buf = '';
  let started = false;
  let finished = false;
  let index = 0;
  let textOpen = false;
  let finish = null;
  let usage = null;
  const tools = new Map();

  const start = () => {
    if (started) return '';
    started = true;
    return sse('message_start', { message: { id: genId('msg_'), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  };
  const closeText = () => {
    if (!textOpen) return '';
    textOpen = false;
    return sse('content_block_stop', { index: index++ });
  };

  function finalize() {
    if (finished) return '';
    finished = true;
    let out = start() + closeText();
    for (const t of [...tools.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])) {
      out += sse('content_block_start', { index, content_block: { type: 'tool_use', id: t.id || genId('toolu_'), name: t.name, input: {} } });
      out += sse('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(parseArgs(t.args)) } });
      out += sse('content_block_stop', { index: index++ });
    }
    out += sse('message_delta', { delta: { stop_reason: mapStopReason(finish, tools.size > 0), stop_sequence: null }, usage: mapUsage(usage) });
    return out + sse('message_stop', {});
  }

  function onData(payload) {
    if (payload === '[DONE]') return finalize();
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return ''; }
    if (chunk?.error) {
      const e = chunk.error;
      return fail((typeof e === 'string' ? e : e.message) || 'upstream stream error');
    }
    let out = start();
    if (chunk?.usage) usage = chunk.usage;
    for (const choice of Array.isArray(chunk?.choices) ? chunk.choices : []) {
      const d = choice.delta || {};
      if (typeof d.content === 'string' && d.content) {
        if (onText) onText(d.content);
        if (!textOpen) { textOpen = true; out += sse('content_block_start', { index, content_block: { type: 'text', text: '' } }); }
        out += sse('content_block_delta', { index, delta: { type: 'text_delta', text: d.content } });
      }
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const k = Number.isInteger(tc.index) ? tc.index : 0;
        const t = tools.get(k) || { id: '', name: '', args: '' };
        if (tc.id) t.id = tc.id;
        if (tc.function?.name) t.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') t.args += tc.function.arguments;
        tools.set(k, t);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    return out;
  }

  function push(text) {
    if (finished) return '';
    buf += text;
    let out = '';
    let nl;
    while (!finished && (nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) out += onData(line.slice(5).trim());
    }
    return out;
  }

  // A stream that closes without [DONE] still yields a well-formed Anthropic message.
  function end() {
    let out = '';
    if (!finished && buf.trim().startsWith('data:')) out += onData(buf.trim().slice(5).trim());
    buf = '';
    return out + finalize();
  }

  // Upstream broke mid-stream: an error event, never a message_stop that would pass a cut-off reply as complete.
  function fail(message) {
    if (finished) return '';
    finished = true;
    return sse('error', { error: { type: 'api_error', message: String(message).slice(0, 500) } });
  }

  return { push, end, fail, get finishReason() { return finish; } };
}

const ERROR_TYPE = { 400: 'invalid_request_error', 401: 'authentication_error', 402: 'billing_error', 403: 'permission_error', 404: 'not_found_error', 413: 'request_too_large', 429: 'rate_limit_error', 503: 'overloaded_error', 529: 'overloaded_error' };

function mapError(status, text) {
  let message = '';
  try {
    const j = JSON.parse(text);
    const e = j?.error;
    message = (typeof e === 'string' ? e : e?.message) || j?.message || '';
  } catch {}
  if (!message) message = String(text || '').slice(0, 500) || `upstream HTTP ${status}`;
  const type = ERROR_TYPE[status] || (status >= 500 ? 'api_error' : 'invalid_request_error');
  return { status, body: { type: 'error', error: { type, message: String(message).slice(0, 1000) } } };
}

// Rough count_tokens: ~4 characters per token over everything the model would read.
function estimateTokens(body) {
  let chars = blockText(body?.system).length;
  for (const m of Array.isArray(body?.messages) ? body.messages : []) {
    if (typeof m?.content === 'string') { chars += m.content.length; continue; }
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b?.type === 'text') chars += String(b.text || '').length;
      else if (b?.type === 'tool_use') chars += JSON.stringify(b.input ?? {}).length + String(b.name || '').length;
      else if (b?.type === 'tool_result') chars += (typeof b.content === 'string' ? b.content : blockText(b.content)).length;
      else if (b?.type === 'image') chars += 6400; // ~1600 tokens, Anthropic's figure for a ~1.15 MP image
    }
  }
  if (Array.isArray(body?.tools)) chars += JSON.stringify(body.tools).length;
  return Math.max(1, Math.ceil(chars / 4));
}

module.exports = {
  chatCompletionsUrl, pickModel, toOpenAIRequest, fromOpenAIResponse, messageToStreamEvents,
  createStreamTranslator, mapError, estimateTokens,
};
