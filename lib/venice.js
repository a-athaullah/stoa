'use strict';
// Venice.ai platform preset (vendor 'venice', api_format 'openai_chat') and the generic
// extra_body field of openai_chat platforms. Pure: the HTTP calls live in server.js.

// The only upstream a venice platform may use. Under STOA_TEST=1 (run-tests.js, never production:
// test.js refuses to run without it and the launchd server does not set it) STOA_TEST_VENICE_PORT
// redirects it to a mock on loopback; nothing else can point it anywhere.
function veniceBaseUrl(env = process.env) {
  if (env.STOA_TEST === '1' && /^\d{2,5}$/.test(env.STOA_TEST_VENICE_PORT || '')) return `http://127.0.0.1:${env.STOA_TEST_VENICE_PORT}/api/v1`;
  return 'https://api.venice.ai/api/v1';
}
const VENICE_BASE_URL = veniceBaseUrl();

const isVenice = (p) => p?.vendor === 'venice';

// Venice otherwise adds its own system prompt next to the agent's, and web search is billed per call.
const defaultExtraBody = () => ({ venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off' } });

const EXTRA_BODY_MAX_BYTES = 4096;
// The translator owns these: letting extra_body set them would bypass model validation or break the stream.
const EXTRA_BODY_RESERVED = ['model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options'];

// → error message, or null when valid. null itself is valid (= no extra_body).
function extraBodyError(v) {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'extra_body must be a JSON object or null';
  const size = Buffer.byteLength(JSON.stringify(v), 'utf8');
  if (size > EXTRA_BODY_MAX_BYTES) return `extra_body is ${size} bytes; the limit is ${EXTRA_BODY_MAX_BYTES}`;
  const reserved = EXTRA_BODY_RESERVED.filter(k => Object.hasOwn(v, k));
  if (reserved.length) return `extra_body cannot set ${reserved.join(', ')}: Stoa controls these fields`;
  return null;
}

// Model names the proxy may send to Venice: discovered (cached_models) and, when the owner picked
// some, enabled. Names with ':' are refused even if stored, because Venice reads a ':' suffix as
// venice_parameters (e.g. ':enable_web_search=on'), which would bypass extra_body.
function veniceModelNames(plat) {
  const cached = (Array.isArray(plat?.cached_models) ? plat.cached_models : [])
    .map(m => (typeof m === 'string' ? m : m?.model)).filter(m => typeof m === 'string' && m && !m.includes(':'));
  const cachedSet = new Set(cached);
  const enabled = Array.isArray(plat?.enabled_models) && plat.enabled_models.length ? plat.enabled_models.filter(n => cachedSet.has(n)) : [];
  return enabled.length ? enabled : cached;
}

function cachedModel(plat, name) {
  return (Array.isArray(plat?.cached_models) ? plat.cached_models : []).find(m => m && typeof m === 'object' && m.model === name) || null;
}

// The final /chat/completions body. A platform without extra_body (and not venice) gets the
// translator output untouched. extra_body keys go first so the translator's keys win on overlap.
function buildChatRequest(plat, oaReq) {
  const extra = plat?.extra_body && typeof plat.extra_body === 'object' && !Array.isArray(plat.extra_body) ? plat.extra_body : null;
  if (!extra && !isVenice(plat)) return oaReq;
  const out = { ...structuredClone(extra || {}), ...oaReq };
  if (!isVenice(plat)) return out;
  if (Object.hasOwn(out, 'max_tokens')) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  // Reasoning arrives in reasoning_content / reasoning_details / thought_signature, which the
  // translator passes through as thinking blocks; strip_thinking_response only removes <think>
  // tags a model writes into content, keeping them out of the reply text. An explicit owner choice
  // in extra_body is kept.
  if (cachedModel(plat, oaReq.model)?.reasoning === true) {
    const vp = out.venice_parameters && typeof out.venice_parameters === 'object' && !Array.isArray(out.venice_parameters) ? out.venice_parameters : {};
    if (vp.strip_thinking_response === undefined) out.venice_parameters = { ...vp, strip_thinking_response: true };
  }
  return out;
}

// GET /models?type=text → cached_models entries. Claude CLI needs tool calling, and e2ee-* models
// need an end-to-end encryption handshake Stoa does not do, so both are left out.
function parseVeniceModels(data) {
  const list = Array.isArray(data?.data) ? data.data : [];
  const total = list.length;
  const usable = [];
  for (const m of list) {
    const id = m?.id;
    if (typeof id !== 'string' || !id || id.includes(':') || id.startsWith('e2ee-')) continue;
    const spec = m.model_spec || {};
    const caps = spec.capabilities || {};
    if (caps.supportsFunctionCalling !== true || spec.offline === true) continue;
    const context = Number.isFinite(spec.availableContextTokens) ? spec.availableContextTokens : (Number.isFinite(m.context_length) ? m.context_length : null);
    usable.push({ model: id, tools: true, vision: caps.supportsVision === true, reasoning: caps.supportsReasoning === true, uncensored: spec.uncensored === true, context, local: false });
  }
  return { total, usable };
}

// GET /api_keys/rate_limits → { accessPermitted, balances: { usd, diem } } (numbers or null).
function parseRateLimits(data) {
  const d = data?.data;
  if (!d || typeof d !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { accessPermitted: d.accessPermitted === true, balances: { usd: num(d.balances?.USD), diem: num(d.balances?.DIEM) } };
}

// 402 from Venice means one of three things; the agent should know which, since only the owner can fix it.
function billingMessage(text) {
  const t = String(text || '');
  if (/API_KEY_USD_SPEND_LIMIT_EXCEEDED|USD spend limit exceeded/i.test(t)) {
    return 'Venice API key USD spend limit reached (API_KEY_USD_SPEND_LIMIT_EXCEEDED). The account may still have balance; the owner must raise this key\'s spend limit in Venice or wait for the next epoch.';
  }
  if (/API_KEY_DIEM_SPEND_LIMIT_EXCEEDED|DIEM spend limit exceeded/i.test(t)) {
    return 'Venice API key DIEM spend limit reached (API_KEY_DIEM_SPEND_LIMIT_EXCEEDED). The account may still have balance; the owner must raise this key\'s spend limit in Venice or wait for the next epoch.';
  }
  return 'Venice account balance is insufficient (402). The owner must add credits at venice.ai/settings/api.';
}

// The Venice media built-ins (lib/venice-images.js, lib/venice-video.js). Claude Code defers MCP tools
// behind ToolSearch, which non-Claude models rarely call; _meta "anthropic/alwaysLoad" asks it to load
// just these upfront (code.claude.com/docs/en/mcp, "Mark a tool to load upfront or stay deferred").
const MEDIA_TOOLS = ['image_generate', 'image_edit', 'video_generate'];
const MEDIA_TOOL_META = Object.freeze({ 'anthropic/alwaysLoad': true });

module.exports = {
  MEDIA_TOOLS, MEDIA_TOOL_META,
  VENICE_BASE_URL, veniceBaseUrl, isVenice, defaultExtraBody, extraBodyError, EXTRA_BODY_MAX_BYTES, EXTRA_BODY_RESERVED,
  veniceModelNames, cachedModel, buildChatRequest, parseVeniceModels, parseRateLimits, billingMessage,
};
