'use strict';
// Venice video tool stoa__video_generate (served by lib/mcp-gateway.js), the video_jobs poller, and the
// video-model discovery + owner's video_settings of a vendor 'venice' platform.
//
// Same rule as the image tools (lib/venice-images.js imageMode), decided by the server only:
//   run on a Venice model with uncensored:true → the platform's uncensored video model
//   run on any other Venice model              → the platform's standard video model
//   run on anything else                       → the tool does not exist
// Video has no safe_mode: "uncensored" is purely which model is used (model_spec.uncensored), and a
// standard slot never holds an uncensored model. The agent never names the model; text-to-video and
// image-to-video (when `image` is given) each have their own pair of slots, because Venice serves them
// as separate models.
//
// Cost guard: the owner's duration / resolution are the default AND the ceiling of what an agent may
// ask; every job is priced with POST /video/quote first and refused above max_usd_per_job; at most
// max_concurrent_per_room jobs are active per room (checked and reserved in one synchronous step).
//
// Async: /video/queue → queue_id (+ download_url, returned once) stored in video_jobs → the poller calls
// /video/retrieve every POLL_MS (backoff on 429/500/503/network), picks the job up again after a server
// restart (state lives in the table), gives up at the job's deadline. The mp4 (inline, or GET
// download_url once retrieve says COMPLETED) becomes a room upload posted in the session's thread, the
// agent is woken, then download_url is DELETEd and /video/complete called.
// Never logged or returned: the API key, prompts, download_url (a pre-signed URL), queue_id.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { billingMessage, MEDIA_TOOL_META } = require('./venice');
const { imageMode: runMode, sniffImage, uploadNameOf, readCapped, INPUT_MAX_BYTES } = require('./venice-images');

const SLOTS = ['model', 'model_uncensored', 'model_i2v', 'model_i2v_uncensored'];
const SLOT_KIND = { model: 't2v', model_uncensored: 't2v', model_i2v: 'i2v', model_i2v_uncensored: 'i2v' };
const KIND_OF_TYPE = { 'text-to-video': 't2v', 'image-to-video': 'i2v' };
// Defaults (quotes of 2026-11-15, 5s 720p): grok-imagine-1-5-lite is the cheapest standard model with
// both kinds ($0.18 / $0.19); longcat-distilled the cheapest uncensored one ($0.09). Missing from a
// discovery → the first discovered model that fits the slot.
const PREFERRED = {
  model: 'grok-imagine-1-5-lite-text-to-video',
  model_uncensored: 'longcat-distilled-text-to-video',
  model_i2v: 'grok-imagine-1-5-lite-image-to-video',
  model_i2v_uncensored: 'longcat-distilled-image-to-video',
};
const DEFAULTS = { duration: '5s', resolution: '720p', max_usd_per_job: 0.5, max_concurrent_per_room: 2 };
const USD_PER_JOB_MAX = 50;
const CONCURRENT_MAX = 10;
const PROMPT_LIMIT_DEFAULT = 2500;         // Venice: models that declare no limit
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const JSON_MAX_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 110_000;        // quote / queue / retrieve-status (see venice-images REQUEST_TIMEOUT_MS)
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;   // an mp4 body
const POLL_MS = 5000;
const BACKOFF_MAX_MS = 60_000;
const JOB_TIMEOUT_MS = 45 * 60_000;
const ORPHAN_MS = 10 * 60_000;             // a reserved row the queue call never filled (server stopped mid-call)
const RETENTION_DAYS = 30;
const ACTIVE = ['queued', 'processing'];
const FILE_ONLY = '\u{1F4CE}';

const strList = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s && s.length <= 32) : []);
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const clip = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, max);

// "5s" → 5; anything else (e.g. "Auto") → null.
const seconds = (d) => { const m = /^(\d{1,3})s$/.exec(String(d)); return m ? Number(m[1]) : null; };
// "720p" → 720, "4k" → 2160; anything else → null. Used to compare against the owner's ceiling.
const RES_K = { 1: 1080, 2: 1440, 4: 2160, 8: 4320 };
const resRank = (r) => {
  const s = String(r).toLowerCase();
  let m = /^(\d{3,4})p$/.exec(s);
  if (m) return Number(m[1]);
  m = /^([1248])k$/.exec(s);
  return m ? RES_K[m[1]] : null;
};

// One GET /models?type=video entry → cached_video_models entry, or null (other model types, offline, bad id).
function videoEntry(m) {
  const id = m?.id;
  if (typeof id !== 'string' || !id || id.length > 100 || id.includes(':')) return null;
  const spec = m.model_spec || {};
  if (spec.offline === true) return null;
  const c = spec.constraints || {};
  const kind = KIND_OF_TYPE[c.model_type];
  if (!kind) return null;
  const durations = strList(c.durations).filter(d => seconds(d) !== null);
  if (!durations.length) return null;
  const constraints = { durations, resolutions: strList(c.resolutions), aspect_ratios: strList(c.aspect_ratios), audio: c.audio === true };
  if (kind === 'i2v') {
    if (posInt(c.reference_image_min_short_side_pixels)) constraints.min_short_side = c.reference_image_min_short_side_pixels;
    if (posNum(c.reference_image_min_aspect_ratio)) constraints.min_aspect_ratio = c.reference_image_min_aspect_ratio;
    if (posNum(c.reference_image_max_aspect_ratio)) constraints.max_aspect_ratio = c.reference_image_max_aspect_ratio;
  }
  return { model: id, kind, uncensored: spec.uncensored === true, prompt_limit: posInt(c.prompt_character_limit), constraints };
}

const parseVeniceVideoModels = (data) => (Array.isArray(data?.data) ? data.data : []).map(videoEntry).filter(Boolean);

const findVideoModel = (cached, name, kind) => (Array.isArray(cached) ? cached : []).find(e => e && e.model === name && e.kind === kind) || null;

// → why `name` may not fill `slot`, or null.
function videoSlotError(slot, name, cached) {
  if (name === null) return null;
  if (typeof name !== 'string' || !name || name.length > 100) return `video_settings.${slot} must be a model name or null`;
  if (name.includes(':')) return `video_settings.${slot}: model names with ':' are not allowed`;
  const kind = SLOT_KIND[slot];
  const entry = findVideoModel(cached, name, kind);
  if (!entry) return `video_settings.${slot}: "${name}" is not a discovered ${kind === 'i2v' ? 'image-to-video' : 'text-to-video'} model (run "discover models" first)`;
  if (!slot.endsWith('_uncensored') && entry.uncensored) return `video_settings.${slot}: "${name}" is an uncensored model; pick it for ${slot}_uncensored instead`;
  return null;
}

function scalarError(key, v) {
  if (key === 'duration') return typeof v === 'string' && seconds(v) && seconds(v) <= 600 ? null : 'video_settings.duration must look like "5s"';
  if (key === 'resolution') return typeof v === 'string' && resRank(v) ? null : 'video_settings.resolution must look like "720p" or "4k"';
  if (key === 'max_usd_per_job') return posNum(v) && v <= USD_PER_JOB_MAX ? null : `video_settings.max_usd_per_job must be a number above 0 and at most ${USD_PER_JOB_MAX}`;
  if (key === 'max_concurrent_per_room') return posInt(v) && v <= CONCURRENT_MAX ? null : `video_settings.max_concurrent_per_room must be an integer from 1 to ${CONCURRENT_MAX}`;
  return null;
}
const SCALARS = Object.keys(DEFAULTS);
const KEYS = [...SLOTS, ...SCALARS];

// The stored value with every key present: an invalid or missing scalar reads as its default, a slot as null.
function normalizeVideoSettings(v) {
  const cur = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    ...Object.fromEntries(SLOTS.map(s => [s, typeof cur[s] === 'string' ? cur[s] : null])),
    ...Object.fromEntries(SCALARS.map(k => [k, scalarError(k, cur[k]) ? DEFAULTS[k] : cur[k]])),
  };
}

// After a discovery: each slot keeps a still-valid choice, else its preferred default, else the first
// discovered model fitting it (null when there is none). Scalars are kept.
function defaultVideoSettings(current, cached) {
  const cur = normalizeVideoSettings(current);
  const list = Array.isArray(cached) ? cached : [];
  const valid = (slot, name) => (name && !videoSlotError(slot, name, list) ? name : null);
  const firstFit = (slot) => {
    const kind = SLOT_KIND[slot];
    const fits = list.filter(e => e.kind === kind && (slot.endsWith('_uncensored') || !e.uncensored));
    return ((slot.endsWith('_uncensored') ? fits.find(e => e.uncensored) : null) || fits[0] || {}).model ?? null;
  };
  for (const s of SLOTS) cur[s] = valid(s, cur[s]) ?? valid(s, PREFERRED[s]) ?? firstFit(s);
  return cur;
}

// PATCH body.video_settings over the current value. → { value } or { error }. null resets to the defaults.
function mergeVideoSettings(current, patch, cached) {
  if (patch === null) return { value: defaultVideoSettings(null, cached) };
  if (typeof patch !== 'object' || Array.isArray(patch)) return { error: 'video_settings must be an object or null' };
  const unknown = Object.keys(patch).filter(k => !KEYS.includes(k));
  if (unknown.length) return { error: `video_settings: unknown key(s) ${unknown.slice(0, 5).map(k => clip(k, 40)).join(', ')}; allowed: ${KEYS.join(', ')}` };
  const value = normalizeVideoSettings(current);
  for (const [k, v] of Object.entries(patch)) {
    const err = SLOTS.includes(k) ? videoSlotError(k, v, cached) : scalarError(k, v);
    if (err) return { error: err };
    value[k] = v;
  }
  return { value };
}

// Duration, resolution and aspect ratio of one job: the agent's ask within the model's constraints and
// the owner's ceiling, else the owner's value (or the nearest the model has below it). → { fields } or { error }.
function videoSize(entry, settings, args) {
  const c = entry.constraints || {};
  const fields = {};
  const maxSec = seconds(settings.duration);
  const allowedDur = c.durations.filter(d => seconds(d) <= maxSec);
  if (args.duration !== undefined) {
    if (!c.durations.includes(args.duration)) return { error: `${entry.model} does not support duration "${clip(args.duration, 32)}"; supported: ${c.durations.join(', ')}` };
    if (seconds(args.duration) > maxSec) return { error: `duration "${clip(args.duration, 32)}" is above the owner's limit of ${settings.duration}` };
    fields.duration = args.duration;
  } else {
    if (!allowedDur.length) return { error: `${entry.model} has no duration within the owner's limit of ${settings.duration} (shortest: ${c.durations.slice().sort((a, b) => seconds(a) - seconds(b))[0]})` };
    fields.duration = allowedDur.includes(settings.duration) ? settings.duration : allowedDur.slice().sort((a, b) => seconds(b) - seconds(a))[0];
  }
  if (c.resolutions.length) {
    const maxRes = resRank(settings.resolution);
    const allowedRes = c.resolutions.filter(r => resRank(r) && resRank(r) <= maxRes);
    if (args.resolution !== undefined) {
      if (!c.resolutions.includes(args.resolution)) return { error: `${entry.model} does not support resolution "${clip(args.resolution, 32)}"; supported: ${c.resolutions.join(', ')}` };
      if (!allowedRes.includes(args.resolution)) return { error: `resolution "${clip(args.resolution, 32)}" is above the owner's limit of ${settings.resolution}` };
      fields.resolution = args.resolution;
    } else {
      if (!allowedRes.length) return { error: `${entry.model} has no resolution within the owner's limit of ${settings.resolution}; supported: ${c.resolutions.join(', ')}` };
      fields.resolution = allowedRes.includes(settings.resolution) ? settings.resolution : allowedRes.slice().sort((a, b) => resRank(b) - resRank(a))[0];
    }
  } else if (args.resolution !== undefined) {
    return { error: `${entry.model} has no resolution option; leave resolution out` };
  }
  // Image-to-video takes the input image's shape; text-to-video models with options require one.
  if (entry.kind === 't2v' && c.aspect_ratios.length) {
    if (args.aspect_ratio !== undefined && !c.aspect_ratios.includes(args.aspect_ratio)) {
      return { error: `${entry.model} does not support aspect_ratio "${clip(args.aspect_ratio, 32)}"; supported: ${c.aspect_ratios.join(', ')}` };
    }
    fields.aspect_ratio = args.aspect_ratio ?? (c.aspect_ratios.includes('16:9') ? '16:9' : c.aspect_ratios[0]);
  } else if (args.aspect_ratio !== undefined) {
    return { error: `${entry.model} takes no aspect_ratio${entry.kind === 'i2v' ? ' (the video follows the input image)' : ''}; leave it out` };
  }
  return { fields };
}

// download_url must be Venice's own (https, *.venice.ai) or, under test, the same origin as the API.
function trustedDownloadUrl(u, baseUrl) {
  if (typeof u !== 'string' || u.length > 4096) return false;
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:' && (url.hostname === 'venice.ai' || url.hostname.endsWith('.venice.ai'))) return true;
  try { return url.origin === new URL(baseUrl).origin; } catch { return false; }
}

const keyRef = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16);
const isMp4 = (head) => Buffer.isBuffer(head) && head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp';

function publicJob(row) {
  return {
    id: row.id, platform_id: row.platform_id, room_id: row.room_id, status: row.status, model: row.model, mode: row.mode, kind: row.kind,
    duration: row.duration, resolution: row.resolution, quote_usd: row.quote_usd, error: row.error,
    created_at: row.created_at, finished_at: row.finished_at, upload_url: row.upload_url,
  };
}

function createVeniceVideo({
  db, platforms, platformKeys, runContext, uploadsDir, baseUrl,
  postVideo, onJobChange = () => {}, canWake = () => 'wait', wake = () => {},
  fetchImpl = (...a) => fetch(...a), log = console, now = () => Date.now(),
  pollMs = POLL_MS, jobTimeoutMs = JOB_TIMEOUT_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS, downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS,
}) {
  const q = {
    room: db.prepare('SELECT archived_at FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    attachedInRoom: db.prepare(`SELECT 1 FROM messages WHERE room_id=? AND (image_url=? OR file_url=? OR (attachments LIKE '%' || ? || '%'
      AND json_valid(attachments) AND EXISTS (SELECT 1 FROM json_each(attachments) WHERE json_extract(value, '$.url')=?))) LIMIT 1`),
    activeInRoom: db.prepare(`SELECT COUNT(*) AS n FROM video_jobs WHERE room_id=? AND status IN ('queued','processing')`),
    reserve: db.prepare(`INSERT INTO video_jobs (platform_id, room_id, thread_id, actor_id, sub_agent_id, kind, mode, model, duration, resolution, aspect_ratio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
    get: db.prepare('SELECT * FROM video_jobs WHERE id=?'),
    setQuote: db.prepare('UPDATE video_jobs SET quote_usd=? WHERE id=?'),
    queued: db.prepare(`UPDATE video_jobs SET queue_id=?, download_url=?, key_ref=?, next_poll_at=?, deadline_at=? WHERE id=? AND status='queued'`),
    processing: db.prepare(`UPDATE video_jobs SET status='processing', poll_failures=0, next_poll_at=? WHERE id=? AND status IN ('queued','processing')`),
    backoff: db.prepare(`UPDATE video_jobs SET poll_failures=poll_failures+1, next_poll_at=? WHERE id=? AND status IN ('queued','processing')`),
    finish: db.prepare(`UPDATE video_jobs SET status=?, error=?, upload_url=?, message_id=?, download_url=NULL, wake_pending=?, finished_at=datetime('now')
      WHERE id=? AND status IN ('queued','processing')`),
    due: db.prepare(`SELECT * FROM video_jobs WHERE status IN ('queued','processing') AND (queue_id IS NULL OR next_poll_at<=?) ORDER BY id LIMIT 20`),
    wakes: db.prepare('SELECT * FROM video_jobs WHERE wake_pending=1 ORDER BY id LIMIT 20'),
    claimWake: db.prepare('UPDATE video_jobs SET wake_pending=0 WHERE id=? AND wake_pending=1'),
    list: db.prepare('SELECT * FROM video_jobs WHERE platform_id=? ORDER BY id DESC LIMIT ?'),
    prune: db.prepare(`DELETE FROM video_jobs WHERE status NOT IN ('queued','processing') AND wake_pending=0 AND finished_at < datetime('now', ?)`),
  };
  const reserveTx = db.transaction((max, values) => {
    if (q.activeInRoom.get(values[1]).n >= max) return null;
    return Number(q.reserve.run(...values).lastInsertRowid);
  });
  const queuing = new Set();   // job ids whose queue call runs in this process
  const polling = new Set();
  let ticking = false;
  let lastPrune = 0;
  let timer = null;

  const changed = (id) => {
    const row = q.get.get(id);
    if (row) try { onJobChange(publicJob(row)); } catch (e) { log.error(`[venice-video] job update broadcast failed: ${e.message}`); }
  };
  const result = (body, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(body) }], ...(isError ? { isError: true } : {}) });
  const failure = (error, extra = {}) => result({ error, ...extra }, true);

  function resolve(ident) {
    if (ident?.roomId == null) return null;
    const ctx = runContext(ident);
    if (!ctx) return null;
    const plat = (platforms() || []).find(p => p?.id === ctx.platformId);
    const mode = runMode(plat, ctx.model);
    return mode ? { plat, mode } : null;
  }

  function roomProblem(ident) {
    const room = q.room.get(ident.roomId);
    if (!room) return 'room not found';
    if (room.archived_at) return 'room is archived';
    if (!q.inRoom.get(ident.roomId, ident.actorId)) return 'agent_scope_denied';
    return null;
  }

  const ARGS = ['prompt', 'duration', 'resolution', 'aspect_ratio', 'image'];
  function argsProblem(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
    const unknown = Object.keys(args).filter(k => !ARGS.includes(k));
    if (unknown.length) {
      return `unsupported argument(s): ${unknown.slice(0, 5).map(k => clip(k, 40)).join(', ')}. Stoa picks the video model and its limits from this session's chat model and the owner's settings; only ${ARGS.join(', ')} are accepted`;
    }
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) return 'prompt is required';
    for (const k of ['duration', 'resolution', 'aspect_ratio']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || !args[k] || args[k].length > 32)) return `${k} must be a short string`;
    }
    if (args.image !== undefined && (typeof args.image !== 'string' || !args.image || args.image.length > 2048)) return 'image must be a /uploads URL';
    return null;
  }

  // → { r, entry, settings, prompt, size } or { error }. Everything checkable without Venice.
  function prepare(ident, args) {
    const r = resolve(ident);
    if (!r) return { error: 'the video tool is only available when this session runs on a Venice model' };
    const room = roomProblem(ident);
    if (room) return { error: room };
    const bad = argsProblem(args);
    if (bad) return { error: bad };
    const kind = args.image !== undefined ? 'i2v' : 't2v';
    const slot = `${kind === 'i2v' ? 'model_i2v' : 'model'}${r.mode === 'uncensored' ? '_uncensored' : ''}`;
    const settings = normalizeVideoSettings(r.plat.video_settings);
    const label = `${r.mode} ${kind === 'i2v' ? 'image-to-video' : 'text-to-video'}`;
    const name = settings[slot];
    if (!name) return { error: `the owner has not chosen a ${label} model for this Venice platform yet (Settings → AI platforms → Video)` };
    // Re-checked here, not only when saved: the setting could have been written by an older server.
    const err = videoSlotError(slot, name, r.plat.cached_video_models);
    if (err) return { error: `the ${label} model setting is invalid (${err}); the owner must fix it in Settings` };
    const entry = findVideoModel(r.plat.cached_video_models, name, kind);
    const prompt = args.prompt.trim();
    const limit = entry.prompt_limit || PROMPT_LIMIT_DEFAULT;
    if (prompt.length > limit) return { error: `prompt is ${prompt.length} characters; ${entry.model} accepts at most ${limit}` };
    const size = videoSize(entry, settings, args);
    if (size.error) return { error: size.error };
    return { r, entry, settings, prompt, size: size.fields };
  }

  // The image-to-video input: an upload attached to a message of this room, a real png/jpeg/webp. → { dataUrl } or { error }.
  function readInput(ident, ref, entry) {
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
    if (st.size >= INPUT_MAX_BYTES) return { error: `${shown}: ${Math.round(st.size / 1024 / 1024)} MB; the input image must be under 25 MB` };
    const buf = fs.readFileSync(fp);
    const img = sniffImage(buf);
    if (!img) return { error: `${shown}: not a png, jpeg or webp image` };
    const c = entry.constraints || {};
    const short = Math.min(img.width, img.height);
    if (c.min_short_side && short < c.min_short_side) return { error: `${shown}: ${img.width}x${img.height}; ${entry.model} needs a short side of at least ${c.min_short_side} px` };
    const ratio = img.width / img.height;
    if ((c.min_aspect_ratio && ratio < c.min_aspect_ratio) || (c.max_aspect_ratio && ratio > c.max_aspect_ratio)) {
      return { error: `${shown}: aspect ratio ${ratio.toFixed(2)} is outside what ${entry.model} accepts (${c.min_aspect_ratio ?? '-'} to ${c.max_aspect_ratio ?? '-'})` };
    }
    return { dataUrl: `data:${img.mime};base64,${buf.toString('base64')}` };
  }

  // POST to Venice. With `key` only that key; else the platform keys in turn (429 / 401 / 402 / network:
  // next key, like the chat proxy). → { resp, buf, key } (JSON body read, capped) or { error }.
  async function veniceJson(plat, route, body, key = null) {
    const keys = key ? [key] : platformKeys(plat);
    if (!keys.length) return { error: 'the Venice platform has no API key configured' };
    const payload = JSON.stringify(body);
    let last = null;
    for (const k of keys) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), requestTimeoutMs);
      try {
        const resp = await fetchImpl(baseUrl + route, {
          method: 'POST', signal: ctrl.signal, body: payload,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${k}` },
        });
        const buf = await readCapped(resp, JSON_MAX_BYTES);
        last = { resp, buf: buf ?? Buffer.alloc(0), key: k };
        if (resp.status !== 429 && resp.status !== 401 && resp.status !== 402) return last;
      } catch (e) {
        last = last || { error: e.name === 'AbortError' ? `Venice did not answer within ${Math.round(requestTimeoutMs / 1000)} s` : 'Venice unreachable' };
      } finally { clearTimeout(t); }
    }
    return last;
  }

  const parse = (buf) => { try { const j = JSON.parse(buf.toString('utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };

  // A non-200 queue / quote / retrieve answer → { error, extra } for the agent or the job row.
  function upstreamError(status, headers, buf, what) {
    const raw = buf ? buf.toString('utf8', 0, Math.min(buf.length, JSON_MAX_BYTES)) : '';
    const json = parse(buf || Buffer.alloc(0));
    const msg = clip(json?.error ?? json?.message ?? raw);
    if (status === 422) {
      const extra = { status: 422 };
      for (const k of ['suggested_prompt', 'recommended_model']) if (typeof json?.[k] === 'string') extra[k] = clip(json[k], 4000);
      return { error: `Venice refused the ${what} (422): ${msg || 'content policy'}`, extra };
    }
    if (status === 402) return { error: billingMessage(raw), extra: { status: 402 } };
    if (status === 429) {
      const after = clip(headers.get('retry-after'), 32);
      return { error: `Venice rate limit (429)${after ? `; retry after ${after} s` : '; retry later'}`, extra: { status: 429, ...(after ? { retry_after: after } : {}) } };
    }
    if (status === 401) return { error: 'Venice rejected the platform API key (401); the owner must check the key in Settings', extra: { status: 401 } };
    if (status === 403) return { error: 'Venice refused the platform API key (403: IP restriction or API access disabled)', extra: { status: 403 } };
    if (status === 404) return { error: what === 'video job' ? 'the video expired or was deleted at Venice (404)' : `Venice does not know this video model (404): ${msg}`, extra: { status: 404 } };
    if (status === 413) return { error: 'request too large for Venice (413): use a smaller input image', extra: { status: 413 } };
    if (status === 400) return { error: `Venice rejected the ${what} (400): ${msg || 'invalid parameters'}`, extra: { status: 400 } };
    if (status === 503) return { error: `the video model is offline or at capacity at Venice (503); try again later`, extra: { status: 503 } };
    return { error: `Venice ${what} failed (HTTP ${status})`, extra: { status } };
  }

  function finish(id, status, { error = null, uploadUrl = null, messageId = null } = {}) {
    const row = q.get.get(id);
    if (!row || q.finish.run(status, error ? clip(error, 1000) : null, uploadUrl, messageId, row.queue_id ? 1 : 0, id).changes === 0) return;
    log.log(`[venice-video] job #${id} ${status} model=${row.model}${error ? ` error=${clip(error, 200)}` : ''}`);
    changed(id);
    // Media cleanup at Venice after the row no longer holds the URL; best-effort, never retried.
    if (row.queue_id) cleanup(row).catch(e => log.warn(`[venice-video] job #${id} cleanup failed: ${e.message}`));
  }

  async function cleanup(row) {
    if (row.download_url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), requestTimeoutMs);
      try {
        const resp = await fetchImpl(row.download_url, { method: 'DELETE', signal: ctrl.signal, redirect: 'error' });
        resp.body?.cancel().catch(() => {});
        if (!resp.ok && resp.status !== 404 && resp.status !== 410) log.warn(`[venice-video] job #${row.id} download link revoke: HTTP ${resp.status}`);
      } catch (e) { log.warn(`[venice-video] job #${row.id} download link revoke failed: ${e.name === 'AbortError' ? 'timeout' : 'network'}`); }
      finally { clearTimeout(t); }
    }
    const plat = (platforms() || []).find(p => p?.id === row.platform_id);
    const key = plat && platformKeys(plat).find(k => keyRef(k) === row.key_ref);
    if (!key) return;
    const res = await veniceJson(plat, '/video/complete', { model: row.model, queue_id: row.queue_id }, key);
    if (res.error || res.resp.status !== 200) log.warn(`[venice-video] job #${row.id} /video/complete: ${res.error || `HTTP ${res.resp.status}`}`);
  }

  // Stream a response body into a new hidden file in uploads/. → { tmp, size } or { error }.
  async function bodyToFile(resp) {
    const declared = Number(resp.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > VIDEO_MAX_BYTES) {
      resp.body?.cancel().catch(() => {});
      return { error: `the video is larger than ${VIDEO_MAX_BYTES / 1024 / 1024} MB` };
    }
    const tmp = path.join(uploadsDir, `.venice-video-${crypto.randomBytes(12).toString('hex')}.part`);
    const fd = fs.openSync(tmp, 'wx');
    let size = 0;
    try {
      if (resp.body) {
        for await (const chunk of resp.body) {
          size += chunk.length;
          if (size > VIDEO_MAX_BYTES) throw Object.assign(new Error(`the video is larger than ${VIDEO_MAX_BYTES / 1024 / 1024} MB`), { capped: true });
          fs.writeSync(fd, Buffer.from(chunk));
        }
      }
    } catch (e) {
      fs.closeSync(fd);
      fs.rmSync(tmp, { force: true });
      return { error: e.capped ? e.message : 'the video download was interrupted', retry: !e.capped };
    }
    fs.closeSync(fd);
    return { tmp, size };
  }

  // The finished mp4 in tmp → upload + message in the job's thread → completed (agent woken by the tick).
  function deliver(job, tmp) {
    const head = Buffer.alloc(12);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (!isMp4(head)) {
      fs.rmSync(tmp, { force: true });
      return finish(job.id, 'failed', { error: 'Venice returned something that is not an mp4 video' });
    }
    const file = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.mp4`;
    const fp = path.join(uploadsDir, file);
    fs.renameSync(tmp, fp);
    const url = `/uploads/${file}`;
    let posted;
    try { posted = postVideo(job, { url, name: `venice-video-${job.id}.mp4`, type: 'file' }, FILE_ONLY); } catch (e) { posted = { status: 500, body: { error: e.message } }; }
    if (!posted || posted.status >= 300 || !posted.body?.message_id) {
      fs.rmSync(fp, { force: true });
      return finish(job.id, 'failed', { error: `the video was made but could not be posted: ${clip(posted?.body?.error || 'unknown error', 200)}` });
    }
    return finish(job.id, 'completed', { uploadUrl: url, messageId: posted.body.message_id });
  }

  function retryLater(job, why) {
    const delay = Math.min(BACKOFF_MAX_MS, pollMs * 2 ** Math.min(job.poll_failures + 1, 10));
    q.backoff.run(now() + delay, job.id);
    log.warn(`[venice-video] job #${job.id} poll: ${why}; next try in ${Math.round(delay / 1000)} s`);
  }

  async function download(job) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), downloadTimeoutMs);
      try {
        // No Authorization: the URL is pre-signed, and the API key must not go anywhere else.
        const resp = await fetchImpl(job.download_url, { method: 'GET', signal: ctrl.signal, redirect: 'error' });
        if (resp.status === 404 || resp.status === 410) {
          resp.body?.cancel().catch(() => {});
          return { error: `the download link expired or was already used (${resp.status})` };
        }
        if (resp.status !== 200) {
          resp.body?.cancel().catch(() => {});
          if (attempt === 3) return { error: `the video download failed (HTTP ${resp.status})` };
          continue;
        }
        const saved = await bodyToFile(resp);
        if (!saved.error || !saved.retry || attempt === 3) return saved;
      } catch (e) {
        if (attempt === 3) return { error: e.name === 'AbortError' ? 'the video download timed out' : 'the video download failed (network)' };
      } finally { clearTimeout(t); }
    }
    return { error: 'the video download failed' };
  }

  async function pollOne(job) {
    const plat = (platforms() || []).find(p => p?.id === job.platform_id);
    if (!plat) return finish(job.id, 'failed', { error: 'the Venice platform was removed' });
    const key = platformKeys(plat).find(k => keyRef(k) === job.key_ref);
    if (!key) return finish(job.id, 'failed', { error: 'the API key that queued this job was removed from the platform' });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), downloadTimeoutMs);
    let resp;
    try {
      resp = await fetchImpl(baseUrl + '/video/retrieve', {
        method: 'POST', signal: ctrl.signal, body: JSON.stringify({ model: job.model, queue_id: job.queue_id }),
        headers: { 'Content-Type': 'application/json', Accept: 'video/mp4, application/json', Authorization: `Bearer ${key}` },
      });
      const type = String(resp.headers.get('content-type') || '');
      if (resp.status === 200 && type.includes('video/mp4')) {
        const saved = await bodyToFile(resp);
        if (saved.error) return saved.retry ? retryLater(job, saved.error) : finish(job.id, 'failed', { error: saved.error });
        return deliver(job, saved.tmp);
      }
      const buf = (await readCapped(resp, JSON_MAX_BYTES)) ?? Buffer.alloc(0);
      if (resp.status === 429 || resp.status === 500 || resp.status === 502 || resp.status === 503 || resp.status === 504) return retryLater(job, `HTTP ${resp.status}`);
      if (resp.status !== 200) return finish(job.id, 'failed', { error: upstreamError(resp.status, resp.headers, buf, 'video job').error });
      const status = parse(buf)?.status;
      if (status === 'COMPLETED') {
        if (!job.download_url) return finish(job.id, 'failed', { error: 'Venice reported the video complete but sent no video' });
        const saved = await download(job);
        if (saved.error) return finish(job.id, 'failed', { error: saved.error });
        return deliver(job, saved.tmp);
      }
      q.processing.run(now() + pollMs, job.id);
      if (job.status !== 'processing') changed(job.id);
    } catch (e) {
      retryLater(job, e.name === 'AbortError' ? 'timeout' : 'network error');
    } finally { clearTimeout(t); }
  }

  function wakeDue() {
    for (const job of q.wakes.all()) {
      let state;
      try { state = canWake(job); } catch (e) { log.error(`[venice-video] wake check failed: ${e.message}`); continue; }
      if (state === 'wait') continue;
      if (q.claimWake.run(job.id).changes === 0 || state !== 'ready') continue;
      try { wake(job); } catch (e) { log.error(`[venice-video] job #${job.id} wake failed: ${e.message}`); }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      if (t - lastPrune > 3600_000) {
        lastPrune = t;
        q.prune.run(`-${RETENTION_DAYS} days`);
      }
      const work = [];
      for (const job of q.due.all(t)) {
        if (polling.has(job.id) || queuing.has(job.id)) continue;
        if (!job.queue_id) {
          if (t - Date.parse(`${job.created_at.replace(' ', 'T')}Z`) > ORPHAN_MS) finish(job.id, 'failed', { error: 'the server stopped before the job reached Venice' });
          continue;
        }
        if (job.deadline_at && t > job.deadline_at) {
          finish(job.id, 'timeout', { error: `no video after ${Math.round(jobTimeoutMs / 60_000)} minutes` });
          continue;
        }
        polling.add(job.id);
        work.push(pollOne(job).catch(e => log.error(`[venice-video] job #${job.id} poll error: ${e.message}`)).finally(() => polling.delete(job.id)));
      }
      await Promise.all(work);
      wakeDue();
    } finally { ticking = false; }
  }

  const PROMPT = { type: 'string', minLength: 1, description: 'What should happen in the video (for image-to-video: the motion). The limit depends on the video model (default 2500 characters).' };
  const tool = {
    name: 'video_generate',
    description: 'Start one video with the Venice video model the owner set for this session\'s chat model. Returns at once with a job id and the price quote; the video takes minutes. When it is ready Stoa posts it (an .mp4 upload) in this session\'s thread (or feed) and wakes you with its URL, or with the error. Give image (a /uploads URL of an image attached in this room) for image-to-video. Duration and resolution default to the owner\'s setting, which is also the maximum; the model is chosen by Stoa, not by you.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: PROMPT,
        duration: { type: 'string', maxLength: 32, description: 'Optional, e.g. "5s". Must be one the model supports and not above the owner\'s limit.' },
        resolution: { type: 'string', maxLength: 32, description: 'Optional, e.g. "720p". Must be one the model supports and not above the owner\'s limit.' },
        aspect_ratio: { type: 'string', maxLength: 32, description: 'Optional for text-to-video, e.g. "16:9" or "9:16". Image-to-video follows the input image.' },
        image: { type: 'string', minLength: 1, maxLength: 2048, description: 'Optional: /uploads/<file> URL of an image attached in this room, for image-to-video.' },
      },
      required: ['prompt'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: MEDIA_TOOL_META,
    availableTo: (ident) => {
      try { return !!resolve(ident); } catch (e) { log.error(`[venice-video] availability check failed: ${e.message}`); return false; }
    },
    precheck: (ident, args) => prepare(ident, args).error ?? null,
    call: async (ident, args) => {
      const p = prepare(ident, args);
      if (p.error) return failure(p.error);
      const { r, entry, settings, prompt, size } = p;
      let input = null;
      if (entry.kind === 'i2v') {
        input = readInput(ident, args.image, entry);
        if (input.error) return failure(input.error);
      }
      const id = reserveTx(settings.max_concurrent_per_room, [r.plat.id, ident.roomId, ident.threadId ?? null, ident.actorId, ident.subAgentId ?? null,
        entry.kind, r.mode, entry.model, size.duration, size.resolution ?? null, size.aspect_ratio ?? null]);
      if (id === null) return failure(`this room already has ${settings.max_concurrent_per_room} video job(s) running (the owner's limit); wait until one finishes`);
      queuing.add(id);
      try {
        changed(id);
        const fail = (error, extra = {}) => { finish(id, 'failed', { error }); return failure(error, { job_id: id, ...extra }); };
        const quote = await veniceJson(r.plat, '/video/quote', { model: entry.model, ...size });
        if (quote.error) return fail(quote.error);
        if (quote.resp.status !== 200) { const u = upstreamError(quote.resp.status, quote.resp.headers, quote.buf, 'price quote'); return fail(u.error, u.extra); }
        const usd = parse(quote.buf)?.quote;
        if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return fail('Venice sent no usable price quote; the job was not started');
        q.setQuote.run(usd, id);
        if (usd > settings.max_usd_per_job) {
          return fail(`this video would cost $${usd.toFixed(2)}, above the owner's limit of $${settings.max_usd_per_job.toFixed(2)} per job; ask for a shorter duration or lower resolution`, { quote_usd: usd });
        }
        const body = { model: entry.model, prompt, ...size, ...(input ? { image_url: input.dataUrl } : {}) };
        const queued = await veniceJson(r.plat, '/video/queue', body);
        if (queued.error) return fail(queued.error);
        if (queued.resp.status !== 200) { const u = upstreamError(queued.resp.status, queued.resp.headers, queued.buf, 'video request'); return fail(u.error, u.extra); }
        const qj = parse(queued.buf);
        const queueId = typeof qj?.queue_id === 'string' && qj.queue_id && qj.queue_id.length <= 200 ? qj.queue_id : null;
        if (!queueId) return fail('Venice accepted the request but sent no queue id');
        let downloadUrl = null;
        if (qj.download_url !== undefined) {
          if (trustedDownloadUrl(qj.download_url, baseUrl)) downloadUrl = qj.download_url;
          else log.warn(`[venice-video] job #${id}: download_url ignored (not a Venice https URL)`);
        }
        const t = now();
        q.queued.run(queueId, downloadUrl, keyRef(queued.key), t + pollMs, t + jobTimeoutMs, id);
        log.log(`[venice-video] job #${id} queued mode=${r.mode} kind=${entry.kind} model=${entry.model} ${size.duration} ${size.resolution ?? '-'} quote=$${usd}`);
        changed(id);
        return result({
          job_id: id, status: 'queued', model: entry.model, model_mode: r.mode, kind: entry.kind,
          duration: size.duration, ...(size.resolution ? { resolution: size.resolution } : {}), ...(size.aspect_ratio ? { aspect_ratio: size.aspect_ratio } : {}),
          quote_usd: usd,
          note: 'Video generation runs in the background (usually a few minutes). Stoa posts the video in this thread and wakes you with the result; do not poll.',
        });
      } catch (e) {
        log.error(`[venice-video] job #${id} start failed: ${e.message}`);
        finish(id, 'failed', { error: 'internal error while starting the job' });
        return failure('internal error while starting the video job', { job_id: id });
      } finally { queuing.delete(id); }
    },
  };

  return {
    tools: [tool],
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => { tick().catch(e => log.error(`[venice-video] tick error: ${e.message}`)); }, Math.max(200, Math.min(pollMs, 5000)));
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    listJobs: (platformId, limit) => q.list.all(platformId, limit).map(publicJob),
  };
}

module.exports = {
  createVeniceVideo, parseVeniceVideoModels, mergeVideoSettings, defaultVideoSettings, normalizeVideoSettings, videoSlotError, videoSize,
  trustedDownloadUrl, publicJob, VIDEO_SLOTS: SLOTS, VIDEO_DEFAULTS: DEFAULTS, VIDEO_MAX_BYTES,
};
