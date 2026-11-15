'use strict';
// Venice image tools: stoa__image_generate / stoa__image_edit (served by lib/mcp-gateway.js), plus the
// image-model discovery and the owner's image_models setting of a vendor 'venice' platform.
//
// The tools follow the chat model of the session's run, and only the server decides (owner decision
// 2026-11-15):
//   run on a Venice model with uncensored:true → the platform's uncensored image model, safe_mode:false
//   run on any other Venice model              → the platform's standard image model, safe_mode:true
//   run on anything else (Anthropic, other platforms, other harnesses) → the tools do not exist
// "The run" is what server.js recorded for the session's token scope at trigger time (gateway
// setRunContext), re-checked against the platform on every tools/list and call: still there, enabled,
// vendor venice, model still one the proxy would send. The agent never chooses the model, safe_mode,
// variants or pixel sizes: the input schemas are closed and unknown fields are refused, and nothing
// else (headers, sub-agent label, the model a proxied request names) feeds the decision.
// The API key never leaves the server; prompts, image bytes and keys are never logged.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { billingMessage, veniceModelNames, isVenice } = require('./venice');

const SLOTS = ['generate', 'generate_uncensored', 'edit', 'edit_uncensored'];
const SLOT_KIND = { generate: 'generate', generate_uncensored: 'generate', edit: 'edit', edit_uncensored: 'edit' };
// Edit defaults are what Venice docs name (firered: Venice's own default; qwen-edit-uncensored: the
// one recommended for uncensored edits); generate defaults come from GET /models/traits.
const DEFAULT_EDIT = 'firered-image-edit';
const DEFAULT_EDIT_UNCENSORED = 'qwen-edit-uncensored';
const MULTI_EDIT_DEFAULT_MAX = 3;          // Venice: maxInputImages absent = 3

// Venice input limits (docs, /image/edit and /image/multi-edit).
const INPUT_MAX_BYTES = 25 * 1024 * 1024;  // per file, "< 25MB"
const INPUT_TOTAL_MAX_BYTES = 50 * 1024 * 1024; // all inputs of one call, so one call cannot pin hundreds of MB
const INPUT_MIN_PIXELS = 65536;            // 256x256
const INPUT_MAX_PIXELS = 33177600;
// What Stoa reads back: a 4K webp/png is a few MB, so 30 MB binary (base64 JSON ~4/3 of it) is generous.
const RESULT_MAX_BYTES = 30 * 1024 * 1024;
// The agent's MCP call waits for approval (max 10 min) plus this; stoa.js MCP_TOOL_TIMEOUT_MS (12 min) must outlast both.
const REQUEST_TIMEOUT_MS = 110_000;
// Pixel models (widthHeightDivisor > 1, no aspectRatios): long side, Venice max (width/height ≤ 1280).
const PIXEL_LONG_SIDE = 1024;
const PIXEL_MAX = 1280;
const RATIO_RE = /^(\d{1,4}(?:\.\d{1,3})?):(\d{1,4}(?:\.\d{1,3})?)$/;
const UPLOAD_NAME_RE = /^[A-Za-z0-9._-]{1,200}$/;
const FILE_ONLY = '\u{1F4CE}';

const strList = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s && s.length <= 32) : []);
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

// One /models entry → cached_image_models entry, or null (unusable: bad id, ':' suffix, offline).
function imageEntry(m, kind, traitsById) {
  const id = m?.id;
  if (typeof id !== 'string' || !id || id.length > 100 || id.includes(':')) return null;
  const spec = m.model_spec || {};
  if (spec.offline === true) return null;
  const c = spec.constraints || {};
  const constraints = {};
  const ar = strList(c.aspectRatios);
  if (ar.length) constraints.aspect_ratios = ar;
  const res = strList(c.resolutions);
  if (res.length) constraints.resolutions = res;
  if (posInt(c.widthHeightDivisor)) constraints.width_height_divisor = c.widthHeightDivisor;
  if (typeof c.defaultAspectRatio === 'string') constraints.default_aspect_ratio = c.defaultAspectRatio;
  if (typeof c.defaultResolution === 'string') constraints.default_resolution = c.defaultResolution;
  if (kind === 'edit') {
    // combineImages:false = the model edits one image only, so /image/multi-edit is not for it.
    constraints.max_input_images = c.combineImages === false ? 1 : (posInt(c.maxInputImages) ?? MULTI_EDIT_DEFAULT_MAX);
  }
  const traits = [...new Set([...strList(spec.traits), ...(traitsById.get(id) || [])])];
  return {
    model: id, kind, uncensored: spec.uncensored === true,
    prompt_limit: posInt(c.promptCharacterLimit), constraints, traits,
  };
}

// GET /models?type=image, GET /models?type=inpaint (Venice's edit models) and GET /models/traits?type=image
// → cached_image_models. traits data maps trait → model id.
function parseVeniceImageModels(imageData, editData, traitsData) {
  const traitsById = new Map();
  const t = traitsData?.data;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    for (const [trait, id] of Object.entries(t)) {
      if (typeof id !== 'string' || typeof trait !== 'string') continue;
      if (!traitsById.has(id)) traitsById.set(id, []);
      traitsById.get(id).push(trait);
    }
  }
  const list = (d) => (Array.isArray(d?.data) ? d.data : []);
  return [
    ...list(imageData).map(m => imageEntry(m, 'generate', traitsById)),
    ...list(editData).map(m => imageEntry(m, 'edit', traitsById)),
  ].filter(Boolean);
}

const findImageModel = (cached, name, kind) => (Array.isArray(cached) ? cached : []).find(e => e && e.model === name && e.kind === kind) || null;

// → why `name` may not fill `slot`, or null. A standard slot never holds an uncensored model.
function imageSlotError(slot, name, cached) {
  if (name === null) return null;
  if (typeof name !== 'string' || !name || name.length > 100) return `image_models.${slot} must be a model name or null`;
  if (name.includes(':')) return `image_models.${slot}: model names with ':' are not allowed`;
  const entry = findImageModel(cached, name, SLOT_KIND[slot]);
  if (!entry) return `image_models.${slot}: "${name}" is not a discovered ${SLOT_KIND[slot]} model (run "discover models" first)`;
  if (!slot.endsWith('_uncensored') && entry.uncensored) return `image_models.${slot}: "${name}" is an uncensored model; pick it for ${slot}_uncensored instead`;
  return null;
}

// PATCH body.image_models over the current value. → { value } or { error }. Missing keys keep their value.
function mergeImageModels(current, patch, cached) {
  if (patch === null) return { value: Object.fromEntries(SLOTS.map(s => [s, null])) };
  if (typeof patch !== 'object' || Array.isArray(patch)) return { error: 'image_models must be an object or null' };
  const unknown = Object.keys(patch).filter(k => !SLOTS.includes(k));
  if (unknown.length) return { error: `image_models: unknown slot(s) ${unknown.slice(0, 5).join(', ')}; allowed: ${SLOTS.join(', ')}` };
  const value = Object.fromEntries(SLOTS.map(s => [s, current && typeof current[s] === 'string' ? current[s] : null]));
  for (const [slot, name] of Object.entries(patch)) {
    const err = imageSlotError(slot, name, cached);
    if (err) return { error: err };
    value[slot] = name;
  }
  return { value };
}

// After a discovery: each slot keeps a choice that is still valid, else gets its default (null when there is none).
function defaultImageModels(current, cached) {
  const byTrait = (trait, uncensoredOk) => (cached.find(e => e.kind === 'generate' && e.traits.includes(trait) && (uncensoredOk || !e.uncensored)) || {}).model ?? null;
  const ifValid = (slot, name) => (name && !imageSlotError(slot, name, cached) ? name : null);
  const defaults = {
    generate: byTrait('default', false),
    generate_uncensored: byTrait('most_uncensored', true),
    edit: ifValid('edit', DEFAULT_EDIT),
    edit_uncensored: ifValid('edit_uncensored', DEFAULT_EDIT_UNCENSORED),
  };
  return Object.fromEntries(SLOTS.map((s) => {
    const keep = current && typeof current[s] === 'string' ? ifValid(s, current[s]) : null;
    return [s, keep ?? defaults[s]];
  }));
}

// 'uncensored' | 'standard' | null for a run on platform `plat` with chat model `model`. Only a name the
// proxy would really send counts (lib/venice.js veniceModelNames); its cached_models flag decides.
function imageMode(plat, model) {
  if (!plat || !isVenice(plat) || plat.enabled !== true || typeof model !== 'string' || !model) return null;
  if (!veniceModelNames(plat).includes(model)) return null;
  const entry = (Array.isArray(plat.cached_models) ? plat.cached_models : []).find(m => m && typeof m === 'object' && m.model === model);
  return entry?.uncensored === true ? 'uncensored' : 'standard';
}

// Generic size (aspect_ratio, resolution) → the fields this model takes. → { fields } or { error }.
function sizeFields(entry, { aspect_ratio: aspect, resolution }, { pixels = true } = {}) {
  const c = entry.constraints || {};
  const fields = {};
  if (resolution !== undefined) {
    if (!c.resolutions?.length) return { error: `${entry.model} has no resolution option; leave resolution out` };
    if (!c.resolutions.includes(resolution)) return { error: `${entry.model} does not support resolution "${resolution}"; supported: ${c.resolutions.join(', ')}` };
    fields.resolution = resolution;
  }
  if (aspect === undefined) return { fields };
  if (c.aspect_ratios?.length) {
    if (!c.aspect_ratios.includes(aspect)) return { error: `${entry.model} does not support aspect_ratio "${aspect}"; supported: ${c.aspect_ratios.join(', ')}` };
    fields.aspect_ratio = aspect;
    return { fields };
  }
  const d = c.width_height_divisor;
  if (!pixels || !d || d < 2) return { error: `${entry.model} takes no aspect_ratio; leave it out` };
  const m = RATIO_RE.exec(aspect);
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  if (!Number.isFinite(r) || r < 0.25 || r > 4) return { error: 'aspect_ratio must look like "16:9", between 1:4 and 4:1' };
  const fit = (v) => Math.min(Math.floor(PIXEL_MAX / d) * d, Math.max(d, Math.round(v / d) * d));
  fields.width = fit(r >= 1 ? PIXEL_LONG_SIDE : PIXEL_LONG_SIDE * r);
  fields.height = fit(r >= 1 ? PIXEL_LONG_SIDE / r : PIXEL_LONG_SIDE);
  return { fields };
}

// Magic bytes + dimensions of a png / jpeg / webp buffer, or null for anything else.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { type: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', mime: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    const webp = (width, height) => ({ type: 'webp', mime: 'image/webp', width, height });
    if (chunk === 'VP8 ') return webp(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return webp((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return webp(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
    return null;
  }
  return null;
}

// The upload file name behind an image reference: "/uploads/<file>" or a URL whose path is that.
function uploadNameOf(ref) {
  if (typeof ref !== 'string' || ref.length > 2048) return null;
  let p = ref.trim();
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { return null; }
  }
  if (!p.startsWith('/uploads/')) return null;
  const name = p.slice('/uploads/'.length);
  return UPLOAD_NAME_RE.test(name) && !name.includes('..') ? name : null;
}

// Body of a response, refusing anything over `max` bytes (declared or streamed).
async function readCapped(resp, max) {
  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    resp.body?.cancel().catch(() => {});
    return null;
  }
  if (!resp.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of resp.body) {
    total += chunk.length;
    if (total > max) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const headerFlag = (h, name) => h.get(name) === 'true';
const errText = (buf) => {
  const raw = buf ? buf.toString('utf8', 0, Math.min(buf.length, 64 * 1024)) : '';
  let j = null;
  try { j = JSON.parse(raw); } catch { /* not JSON */ }
  return { raw, json: j && typeof j === 'object' ? j : null };
};
const clip = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, max);

function veniceImageTools({
  db, platforms, platformKeys, runContext, uploadsDir, postImage,
  baseUrl, fetchImpl = (...a) => fetch(...a), log = console, timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const q = {
    room: db.prepare('SELECT archived_at FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    // An input image must be an upload attached to a message of the session's room (from the DB, not
    // from the reference string). LIKE narrows the rows before the JSON is parsed.
    attachedInRoom: db.prepare(`SELECT 1 FROM messages WHERE room_id=? AND (image_url=? OR file_url=? OR (attachments LIKE '%' || ? || '%'
      AND json_valid(attachments) AND EXISTS (SELECT 1 FROM json_each(attachments) WHERE json_extract(value, '$.url')=?))) LIMIT 1`),
  };

  const result = (body, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(body) }], ...(isError ? { isError: true } : {}) });
  const failure = (error, extra = {}) => result({ error, ...extra }, true);

  // → { plat, mode } for this session now, or null (no tools).
  function resolve(ident) {
    if (ident?.roomId == null) return null;
    const ctx = runContext(ident);
    if (!ctx) return null;
    const plat = (platforms() || []).find(p => p?.id === ctx.platformId);
    const mode = imageMode(plat, ctx.model);
    return mode ? { plat, mode } : null;
  }

  function roomProblem(ident) {
    const room = q.room.get(ident.roomId);
    if (!room) return 'room not found';
    if (room.archived_at) return 'room is archived';
    if (!q.inRoom.get(ident.roomId, ident.actorId)) return 'agent_scope_denied';
    return null;
  }

  // Unknown arguments are refused by name, so an agent learns that model / safe_mode are not its choice.
  function argsProblem(args, allowed) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
    const unknown = Object.keys(args).filter(k => !allowed.includes(k));
    if (unknown.length) {
      return `unsupported argument(s): ${unknown.slice(0, 5).map(k => clip(k, 40)).join(', ')}. Stoa picks the image model and safe_mode from this session's chat model; only ${allowed.join(', ')} are accepted`;
    }
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) return 'prompt is required';
    for (const k of ['aspect_ratio', 'resolution']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || !args[k] || args[k].length > 32)) return `${k} must be a short string`;
    }
    return null;
  }

  function pickModel(r, kind) {
    const slot = r.mode === 'uncensored' ? `${kind}_uncensored` : kind;
    const name = r.plat.image_models?.[slot];
    if (typeof name !== 'string' || !name) return { error: `the owner has not chosen a ${slot.replace('_', ' ')} image model for this Venice platform yet (Settings → AI platforms → Image models)` };
    // Re-checked here, not only when saved: the setting could have been written by an older server.
    const err = imageSlotError(slot, name, r.plat.cached_image_models);
    if (err) return { error: `the ${slot.replace('_', ' ')} image model setting is invalid (${err}); the owner must fix it in Settings` };
    return { entry: findImageModel(r.plat.cached_image_models, name, kind) };
  }

  // POST to Venice with the platform keys in turn (429 / 401 / 402 / network: next key, like the chat
  // proxy). → { resp, buf } of the last answer, or { error }.
  async function veniceCall(plat, route, body, accept) {
    const keys = platformKeys(plat);
    if (!keys.length) return { error: 'the Venice platform has no API key configured' };
    const payload = JSON.stringify(body);
    let last = null;
    for (const key of keys) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetchImpl(baseUrl + route, {
          method: 'POST', signal: ctrl.signal, body: payload,
          headers: { 'Content-Type': 'application/json', Accept: accept, Authorization: `Bearer ${key}` },
        });
        const buf = await readCapped(resp, RESULT_MAX_BYTES * (accept === 'application/json' ? 1.4 : 1));
        if (buf === null) return { error: `Venice answered with more than ${RESULT_MAX_BYTES / 1024 / 1024} MB; refused` };
        last = { resp, buf };
        if (resp.status !== 429 && resp.status !== 401 && resp.status !== 402) return last;
      } catch (e) {
        last = last || { error: e.name === 'AbortError' ? `Venice did not answer within ${Math.round(timeoutMs / 1000)} s` : 'Venice unreachable' };
      } finally { clearTimeout(timer); }
    }
    return last;
  }

  // A non-200 answer → the tool error the agent sees. 422 is passed on as Venice sent it (no automatic
  // switch to recommended_model: the model is the owner's choice).
  function upstreamError(status, headers, buf) {
    const { raw, json } = errText(buf);
    const msg = clip(json?.error ?? json?.message ?? raw);
    if (status === 422) {
      const extra = { status: 422 };
      for (const k of ['suggested_prompt', 'recommended_model']) if (typeof json?.[k] === 'string') extra[k] = clip(json[k], 4000);
      if (typeof json?.retryable === 'boolean') extra.retryable = json.retryable;
      return failure(`Venice refused the request (422): ${msg || 'content policy'}`, extra);
    }
    if (status === 402) return failure(billingMessage(raw), { status: 402 });
    if (status === 429) {
      const after = clip(headers.get('retry-after'), 32);
      return failure(`Venice rate limit (429)${after ? `; retry after ${after} s` : '; retry later'}`, { status: 429, ...(after ? { retry_after: after } : {}) });
    }
    if (status === 401) return failure('Venice rejected the platform API key (401); the owner must check the key in Settings', { status: 401 });
    if (status === 403) return failure('Venice refused the platform API key (403: IP restriction or API access disabled)', { status: 403 });
    if (status === 413) return failure('input image too large for Venice (413, limit 25 MB)', { status: 413 });
    if (status === 400) return failure(`Venice rejected the request (400): ${msg || 'invalid parameters'}`, { status: 400 });
    return failure(`Venice image request failed (HTTP ${status})`, { status });
  }

  async function saveAndPost(ident, buf, kind) {
    const img = sniffImage(buf);
    if (!img) return { error: 'Venice returned something that is not a png, jpeg or webp image' };
    const ext = img.type === 'jpeg' ? 'jpg' : img.type;
    const file = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
    const fp = path.join(uploadsDir, file);
    fs.writeFileSync(fp, buf, { flag: 'wx' });
    const url = `/uploads/${file}`;
    let posted;
    try { posted = postImage(ident, { url, name: `venice-${kind}.${ext}`, type: 'image' }, FILE_ONLY); } catch (e) { posted = { status: 500, body: { error: e.message } }; }
    if (!posted || posted.status >= 300 || !posted.body?.message_id) {
      fs.rmSync(fp, { force: true });
      return { error: `the image was made but could not be posted: ${clip(posted?.body?.error || 'unknown error', 200)}` };
    }
    return { url, message_id: posted.body.message_id, width: img.width, height: img.height };
  }

  // Shared path of both tools after their own input checks. → MCP result.
  async function run(ident, r, entry, kind, route, body, accept) {
    const res = await veniceCall(r.plat, route, body, accept);
    if (res.error) {
      log.warn(`[venice-image] ${kind} mode=${r.mode} model=${entry.model} failed: ${res.error}`);
      return failure(res.error);
    }
    const { resp, buf } = res;
    log.log(`[venice-image] ${kind} mode=${r.mode} model=${entry.model} status=${resp.status} bytes=${buf.length}`);
    if (resp.status !== 200) return upstreamError(resp.status, resp.headers, buf);
    let image = buf;
    let violations;
    if (accept === 'application/json') {
      let parsed = null;
      try { parsed = JSON.parse(buf.toString('utf8')); } catch { /* checked below */ }
      const b64 = Array.isArray(parsed?.images) && typeof parsed.images[0] === 'string' ? parsed.images[0] : null;
      if (posInt(parsed?.content_policy_violation_count)) violations = parsed.content_policy_violation_count;
      if (!b64) return failure('Venice returned no image (content policy)', { status: 200, ...(violations ? { content_policy_violation_count: violations } : {}) });
      image = Buffer.from(b64, 'base64');
    }
    const saved = await saveAndPost(ident, image, kind);
    if (saved.error) return failure(saved.error);
    const h = resp.headers;
    return result({
      url: saved.url, message_id: saved.message_id, width: saved.width, height: saved.height,
      model: entry.model, model_mode: r.mode,
      blurred: headerFlag(h, 'x-venice-is-blurred'),
      content_violation: headerFlag(h, 'x-venice-is-content-violation'),
      adult_model_content_violation: headerFlag(h, 'x-venice-is-adult-model-content-violation'),
      ...(violations ? { content_policy_violation_count: violations } : {}),
    });
  }

  // Common gate of both tools. → { r, entry } or { error } (text for the agent).
  function prepare(ident, args, kind, allowed) {
    const r = resolve(ident);
    if (!r) return { error: 'image tools are only available when this session runs on a Venice model' };
    const room = roomProblem(ident);
    if (room) return { error: room };
    const bad = argsProblem(args, allowed);
    if (bad) return { error: bad };
    const picked = pickModel(r, kind);
    if (picked.error) return { error: picked.error };
    const { entry } = picked;
    const prompt = args.prompt.trim();
    if (entry.prompt_limit && prompt.length > entry.prompt_limit) {
      return { error: `prompt is ${prompt.length} characters; ${entry.model} accepts at most ${entry.prompt_limit}` };
    }
    return { r, entry, prompt };
  }

  // Edit inputs: uploads attached to a message of this session's room, real png/jpeg/webp within Venice's limits.
  function readInputs(ident, refs) {
    const out = [];
    let total = 0;
    for (const ref of refs) {
      const name = uploadNameOf(ref);
      const shown = clip(ref, 120);
      if (!name) return { error: `${shown}: use the /uploads/<file> URL of an image attached in this room` };
      const url = `/uploads/${name}`;
      if (!q.attachedInRoom.get(ident.roomId, url, url, url, url)) return { error: `${shown}: not an attachment of a message in this room` };
      const fp = path.resolve(uploadsDir, name);
      if (path.dirname(fp) !== path.resolve(uploadsDir)) return { error: `${shown}: invalid path` };
      let st;
      try { st = fs.statSync(fp); } catch { return { error: `${shown}: file no longer exists` }; }
      if (!st.isFile()) return { error: `${shown}: not a file` };
      if (st.size >= INPUT_MAX_BYTES) return { error: `${shown}: ${Math.round(st.size / 1024 / 1024)} MB; Venice accepts less than 25 MB per image` };
      total += st.size;
      if (total > INPUT_TOTAL_MAX_BYTES) return { error: `input images total more than ${INPUT_TOTAL_MAX_BYTES / 1024 / 1024} MB` };
      const buf = fs.readFileSync(fp);
      const img = sniffImage(buf);
      if (!img) return { error: `${shown}: not a png, jpeg or webp image` };
      const px = img.width * img.height;
      if (px < INPUT_MIN_PIXELS) return { error: `${shown}: ${img.width}x${img.height} is too small (at least 65536 pixels, e.g. 256x256)` };
      if (px > INPUT_MAX_PIXELS) return { error: `${shown}: ${img.width}x${img.height} is too large (at most 33177600 pixels)` };
      out.push(buf.toString('base64'));
    }
    return { images: out };
  }

  const PROMPT = { type: 'string', minLength: 1, description: 'What to draw (or, for edit, what to change). The limit depends on the image model; an over-long prompt is refused with the limit.' };
  const ASPECT = { type: 'string', maxLength: 32, description: 'Optional, e.g. "1:1", "16:9", "9:16". Unsupported values are refused with the list the model accepts.' };
  const RESOLUTION = { type: 'string', maxLength: 10, description: 'Optional resolution tier such as "1K" or "2K", only for models that have tiers.' };
  const IMAGE_REF = { type: 'string', minLength: 1, maxLength: 2048 };
  const GEN_ARGS = ['prompt', 'aspect_ratio', 'resolution'];
  const EDIT_ARGS = ['prompt', 'image', 'images', 'aspect_ratio', 'resolution'];
  const availableTo = (ident) => {
    try { return !!resolve(ident); } catch (e) { log.error(`[venice-image] availability check failed: ${e.message}`); return false; }
  };

  return [
    {
      name: 'image_generate',
      description: 'Generate one image with the Venice image model the owner set for this session\'s chat model, and post it in this session\'s thread (or feed). Returns its /uploads URL and message id. The model and safe mode are chosen by Stoa, not by you.',
      inputSchema: { type: 'object', properties: { prompt: PROMPT, aspect_ratio: ASPECT, resolution: RESOLUTION }, required: ['prompt'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      availableTo,
      call: async (ident, args) => {
        const p = prepare(ident, args, 'generate', GEN_ARGS);
        if (p.error) return failure(p.error);
        const size = sizeFields(p.entry, args);
        if (size.error) return failure(size.error);
        const body = { model: p.entry.model, prompt: p.prompt, variants: 1, safe_mode: p.r.mode !== 'uncensored', format: 'webp', ...size.fields };
        return run(ident, p.r, p.entry, 'generate', '/image/generate', body, 'application/json');
      },
    },
    {
      name: 'image_edit',
      description: 'Edit an image (image) or combine several (images, the first is the base) with the Venice edit model the owner set for this session\'s chat model, and post the result in this session\'s thread (or feed). Inputs are /uploads/<file> URLs of images attached to messages in this room (stoa__messages_read lists them as file_urls; a stoa__image_generate result is one). The model and safe mode are chosen by Stoa, not by you.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: PROMPT,
          image: { ...IMAGE_REF, description: 'One image to edit: /uploads/<file> URL' },
          images: { type: 'array', minItems: 2, maxItems: 16, items: IMAGE_REF, description: '2 or more images to combine (the limit depends on the edit model): /uploads/<file> URLs' },
          aspect_ratio: ASPECT, resolution: RESOLUTION,
        },
        required: ['prompt'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      availableTo,
      call: async (ident, args) => {
        const p = prepare(ident, args, 'edit', EDIT_ARGS);
        if (p.error) return failure(p.error);
        const hasOne = args.image !== undefined;
        const hasMany = args.images !== undefined;
        if (hasOne === hasMany) return failure('send either image (one) or images (2 or more)');
        if (hasMany && (!Array.isArray(args.images) || args.images.length < 2 || args.images.length > 16)) return failure('images must be an array of 2 to 16 /uploads URLs');
        const refs = hasOne ? [args.image] : args.images;
        const max = p.entry.constraints?.max_input_images ?? MULTI_EDIT_DEFAULT_MAX;
        if (refs.length > max) return failure(`${p.entry.model} combines at most ${max} image${max === 1 ? '' : 's'}; got ${refs.length}`);
        const size = sizeFields(p.entry, args, { pixels: false });
        if (size.error) return failure(size.error);
        const inputs = readInputs(ident, refs);
        if (inputs.error) return failure(inputs.error);
        const common = { prompt: p.prompt, safe_mode: p.r.mode !== 'uncensored', output_format: 'webp', ...size.fields };
        // /image/edit names the model `model`; /image/multi-edit names it `modelId`.
        return hasOne
          ? run(ident, p.r, p.entry, 'edit', '/image/edit', { model: p.entry.model, image: inputs.images[0], ...common }, 'image/*')
          : run(ident, p.r, p.entry, 'edit', '/image/multi-edit', { modelId: p.entry.model, images: inputs.images, ...common }, 'image/*');
      },
    },
  ];
}

module.exports = {
  veniceImageTools, parseVeniceImageModels, mergeImageModels, defaultImageModels, imageSlotError, imageMode, sizeFields, sniffImage, uploadNameOf,
  IMAGE_SLOTS: SLOTS, INPUT_MAX_BYTES, INPUT_MIN_PIXELS, INPUT_MAX_PIXELS, RESULT_MAX_BYTES,
};
