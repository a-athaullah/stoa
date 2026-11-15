'use strict';
// Anthropic Messages <-> OpenAI Chat Completions translation for platforms with api_format
// 'openai_chat'. Pure: no network, no filesystem, no database. The /v1/messages proxy in
// server.js does the I/O and calls in here.
const crypto = require('crypto');
const { STOA_REASONING_PREFIX: ENVELOPE_PREFIX } = require('./thinking-sanitizer');

const genId = (prefix) => `${prefix}${crypto.randomBytes(12).toString('hex')}`;

// ── Reasoning round-trip ──
// Reasoning models return reasoning_content (or reasoning), reasoning_details and thought_signature,
// and tool calls may carry extra_content (Gemini: extra_content.google.thought_signature). In a tool
// loop these must come back exactly as received. They travel through the CLI inside an Anthropic
// thinking block whose signature is a Stoa envelope:
//   stoa-oa1.<base64url platId>.<base64url JSON payload>.<hmac>
// The HMAC (server key) binds platform id, payload and the block's thinking text, so reasoning
// only returns to the platform that produced it and an edited block is dropped. Anthropic cannot
// verify this signature: lib/thinking-sanitizer.js treats the prefix as unsigned.
// Payload: rk = key the thinking text came from (reasoning_content | reasoning), rd =
// reasoning_details, ts = thought_signature, tc = { tool_call id: extra_content }.
// Past this the upstream data is not preserved (the thinking text is still shown).
const ENVELOPE_PAYLOAD_MAX = 192 * 1024;
const ENVELOPE_MAX = ENVELOPE_PAYLOAD_MAX * 2;
const REASONING_TEXT_KEYS = ['reasoning_content', 'reasoning'];
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// key: the server's secret signing key. → { seal(payload, text), open(signature, text) }.
function reasoningCodec(platId, key) {
  const platTag = b64u(String(platId));
  const mac = (payloadB64, text) => crypto.createHmac('sha256', key).update(`oa1|${platId}|${payloadB64}|${sha256(text)}`).digest('hex');
  function seal(payload, text) {
    let json = JSON.stringify(payload);
    if (Buffer.byteLength(json, 'utf8') > ENVELOPE_PAYLOAD_MAX) {
      console.warn(`[openai-proxy] reasoning data over ${ENVELOPE_PAYLOAD_MAX} bytes not preserved (platform ${platId})`);
      json = JSON.stringify(payload.rk ? { rk: payload.rk } : {});
    }
    const p = Buffer.from(json, 'utf8').toString('base64url');
    return `${ENVELOPE_PREFIX}${platTag}.${p}.${mac(p, text)}`;
  }
  // → payload, or null for anything not sealed by this codec (other platform, forged, damaged).
  function open(signature, text) {
    if (typeof signature !== 'string' || !signature.startsWith(ENVELOPE_PREFIX) || signature.length > ENVELOPE_MAX) return null;
    const parts = signature.slice(ENVELOPE_PREFIX.length).split('.');
    if (parts.length !== 3 || parts[0] !== platTag || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
    const want = Buffer.from(mac(parts[1], typeof text === 'string' ? text : ''), 'hex');
    if (!crypto.timingSafeEqual(want, Buffer.from(parts[2], 'hex'))) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
    if (!isPlainObject(payload)) return null;
    return {
      rk: REASONING_TEXT_KEYS.includes(payload.rk) ? payload.rk : null,
      rd: Array.isArray(payload.rd) ? payload.rd : null,
      ts: typeof payload.ts === 'string' ? payload.ts : null,
      tc: isPlainObject(payload.tc) ? payload.tc : null,
    };
  }
  return { seal, open };
}

function reasoningText(src) {
  for (const k of REASONING_TEXT_KEYS) if (typeof src?.[k] === 'string' && src[k]) return { key: k, text: src[k] };
  return null;
}

// Readable text of reasoning_details, for display when there is no reasoning_content.
function detailsText(rd) {
  return rd.map(d => (typeof d?.text === 'string' ? d.text : (typeof d?.summary === 'string' ? d.summary : ''))).filter(Boolean).join('\n\n');
}

// Streamed reasoning_details arrive in fragments; consecutive fragments of one entry (same index
// and type) are joined, string fields concatenated, as a non-streamed response would carry them.
function appendDetails(list, items) {
  for (const it of items) {
    if (!isPlainObject(it)) continue;
    const last = list[list.length - 1];
    if (last && Number.isInteger(it.index) && last.index === it.index && last.type === it.type) {
      for (const [k, v] of Object.entries(it)) {
        if (typeof v === 'string' && typeof last[k] === 'string' && !['type', 'format', 'id'].includes(k)) last[k] += v;
        else if (last[k] === undefined) last[k] = v;
      }
    } else list.push({ ...it });
  }
}

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

function translateAssistant(content, out, codec) {
  if (typeof content === 'string') { out.push({ role: 'assistant', content }); return; }
  if (!Array.isArray(content)) return;
  const texts = [];
  const toolCalls = [];
  const reasoning = {};
  let details = null;
  let thoughtSig = null;
  const extras = {};
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b?.type === 'tool_use') {
      toolCalls.push({ id: String(b.id ?? ''), type: 'function', function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) } });
    } else if (b?.type === 'thinking' && codec) {
      // Only reasoning this platform produced goes back; Anthropic-signed or foreign thinking is dropped.
      const p = codec.open(b.signature, b.thinking);
      if (!p) continue;
      if (p.rk && typeof b.thinking === 'string') reasoning[p.rk] = (reasoning[p.rk] || '') + b.thinking;
      if (p.rd) details = (details || []).concat(p.rd);
      if (p.ts) thoughtSig = p.ts;
      if (p.tc) Object.assign(extras, p.tc);
    }
  }
  const msg = { role: 'assistant', content: texts.length ? texts.join('\n\n') : (toolCalls.length ? null : '') };
  Object.assign(msg, reasoning);
  if (details) msg.reasoning_details = details;
  if (thoughtSig) msg.thought_signature = thoughtSig;
  for (const tc of toolCalls) if (isPlainObject(extras[tc.id])) tc.extra_content = extras[tc.id];
  if (toolCalls.length) msg.tool_calls = toolCalls;
  out.push(msg);
}

const TOOL_CHOICE = { auto: 'auto', any: 'required', none: 'none' };

// codec (reasoningCodec of the target platform): returns that platform's reasoning to it. Without
// one every thinking block is dropped.
function toOpenAIRequest(body, model, codec = null) {
  const messages = [];
  const system = blockText(body.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (m?.role === 'assistant') translateAssistant(m.content, messages, codec);
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

// → envelope payload fields for the upstream data worth preserving, or null when there is none.
function preserved(rd, ts, tc) {
  const p = {};
  if (rd?.length) p.rd = rd;
  if (ts) p.ts = ts;
  if (tc && Object.keys(tc).length) p.tc = tc;
  return Object.keys(p).length ? p : null;
}

function fromOpenAIResponse(oa, model, codec = null) {
  const choice = oa?.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  const extras = {};
  const tools = [];
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    const id = tc.id || genId('toolu_');
    if (isPlainObject(tc.extra_content)) extras[id] = tc.extra_content;
    tools.push({ type: 'tool_use', id, name: tc.function?.name || '', input: parseArgs(tc.function?.arguments) });
  }
  if (codec) {
    const rt = reasoningText(msg);
    const rd = Array.isArray(msg.reasoning_details) ? msg.reasoning_details : null;
    const keep = preserved(rd, typeof msg.thought_signature === 'string' ? msg.thought_signature : null, extras);
    if (rt || keep) {
      const text = rt ? rt.text : detailsText(rd || []);
      content.push({ type: 'thinking', thinking: text, signature: codec.seal({ ...(rt ? { rk: rt.key } : {}), ...keep }, text) });
    }
  }
  if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content });
  content.push(...tools);
  const hasTools = tools.length > 0;
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
    } else if (b.type === 'thinking') {
      out += sse('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (b.thinking) out += sse('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      out += sse('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
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
// Anthropic events ready to write; end() flushes. Text and reasoning stream live. Tool calls are
// collected per OpenAI index and emitted as whole tool_use blocks once the stream finishes:
// providers may interleave argument deltas across indexes, and Anthropic blocks cannot be reopened
// once stopped. With a codec, reasoning text becomes thinking blocks; each is signed when it closes
// with the reasoning data received so far, and data arriving after that (late reasoning_details,
// thought_signature, tool extra_content) is sealed in one more empty thinking block at the end.
function createStreamTranslator(model, codec = null) {
  let buf = '';
  let started = false;
  let finished = false;
  let index = 0;
  let open = null; // 'text' | 'thinking'
  let thinkText = '';
  let thinkKey = null;
  let details = [];
  let thoughtSig = '';
  let finish = null;
  let usage = null;
  const tools = new Map();

  const start = () => {
    if (started) return '';
    started = true;
    return sse('message_start', { message: { id: genId('msg_'), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  };
  const takePreserved = (tc) => {
    const p = preserved(details, thoughtSig, tc);
    details = [];
    thoughtSig = '';
    return p;
  };
  const sealedBlock = (payload) => {
    let out = sse('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    out += sse('content_block_delta', { index, delta: { type: 'signature_delta', signature: codec.seal(payload, '') } });
    return out + sse('content_block_stop', { index: index++ });
  };
  const close = (tc = null) => {
    if (!open) return '';
    let out = '';
    if (open === 'thinking') {
      const payload = { ...(thinkKey ? { rk: thinkKey } : {}), ...takePreserved(tc) };
      out += sse('content_block_delta', { index, delta: { type: 'signature_delta', signature: codec.seal(payload, thinkText) } });
      thinkText = '';
      thinkKey = null;
    }
    open = null;
    return out + sse('content_block_stop', { index: index++ });
  };
  const openBlock = (type) => {
    if (open === type) return '';
    const out = close();
    open = type;
    const block = type === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '', signature: '' };
    return out + sse('content_block_start', { index, content_block: block });
  };

  function finalize() {
    if (finished) return '';
    finished = true;
    let out = start();
    const list = [...tools.entries()].sort((a, b) => a[0] - b[0]).map(e => ({ ...e[1], id: e[1].id || genId('toolu_') }));
    const extras = {};
    for (const t of list) if (isPlainObject(t.extra)) extras[t.id] = t.extra;
    if (codec && open === 'thinking') out += close(extras);
    else {
      out += close();
      const late = codec ? takePreserved(extras) : null;
      if (late) out += sealedBlock(late);
    }
    for (const t of list) {
      out += sse('content_block_start', { index, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
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
      if (codec) {
        if (Array.isArray(d.reasoning_details)) appendDetails(details, d.reasoning_details);
        if (typeof d.thought_signature === 'string') thoughtSig += d.thought_signature;
        const rt = reasoningText(d);
        if (rt) {
          out += openBlock('thinking');
          thinkKey = thinkKey || rt.key;
          thinkText += rt.text;
          out += sse('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: rt.text } });
        }
      }
      if (typeof d.content === 'string' && d.content) {
        out += openBlock('text');
        out += sse('content_block_delta', { index, delta: { type: 'text_delta', text: d.content } });
      }
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const k = Number.isInteger(tc.index) ? tc.index : 0;
        const t = tools.get(k) || { id: '', name: '', args: '', extra: null };
        if (tc.id) t.id = tc.id;
        if (tc.function?.name) t.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') t.args += tc.function.arguments;
        if (isPlainObject(tc.extra_content)) t.extra = tc.extra_content;
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

  return { push, end, fail };
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
  createStreamTranslator, mapError, estimateTokens, reasoningCodec, ENVELOPE_PREFIX,
};
