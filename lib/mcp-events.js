'use strict';
// Event channel for MCP servers run by the gateway: a stdio upstream gets STOA_EVENTS_URL and
// STOA_EVENTS_TOKEN in its env and POSTs /api/mcp/events to put a message into a room it has access to.
// The message goes through handleHumanMessage with provider 'mcp', so routing (primary agent, or the
// @mentioned one), busy mode and the thread limit match Slack / email; no actor is created for it.

const crypto = require('crypto');

const EVENTS_PATH = '/api/mcp/events';
const TOKEN_PREFIX = 'stoa_mev_';
const MAX_TEXT = 8000;
const MAX_EVENT_ID = 128;
const MAX_BODY = 64 * 1024;
const RATE_PER_MIN = 30;
const RATE_WINDOW_MS = 60_000;
const BODY_KEYS = new Set(['room_id', 'thread_id', 'text', 'event_id']);

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const isId = (v) => Number.isSafeInteger(v) && v > 0;

function bearerToken(authorization) {
  const m = typeof authorization === 'string' && authorization.match(/^Bearer\s+(\S{1,256})$/i);
  return m && m[1].startsWith(TOKEN_PREFIX) ? m[1] : null;
}

// → { roomId, threadId, text, eventId } or { error }.
function validateBody(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'invalid JSON body' };
  const unknown = Object.keys(b).find(k => !BODY_KEYS.has(k));
  if (unknown) return { error: `unknown field: ${unknown.slice(0, 64)}` };
  if (!isId(b.room_id)) return { error: 'room_id must be a positive integer' };
  if (b.thread_id != null && !isId(b.thread_id)) return { error: 'thread_id must be a positive integer' };
  if (typeof b.text !== 'string' || !b.text.trim()) return { error: 'text is required' };
  if (b.text.length > MAX_TEXT) return { error: `text is longer than ${MAX_TEXT} characters` };
  if (b.event_id != null && (typeof b.event_id !== 'string' || !b.event_id || b.event_id.length > MAX_EVENT_ID || /[\0-\x1f\x7f]/.test(b.event_id))) {
    return { error: `event_id must be a string of 1-${MAX_EVENT_ID} printable characters` };
  }
  return { roomId: b.room_id, threadId: b.thread_id ?? null, text: b.text, eventId: b.event_id ?? null };
}

function createMcpEvents({ db, encrypt, decrypt, baseUrl, handleHumanMessage, resolveThread, log = console, ratePerMin = RATE_PER_MIN }) {
  const q = {
    tokenOf: db.prepare('SELECT token_enc FROM mcp_event_tokens WHERE server_id=?'),
    upsertToken: db.prepare(`INSERT INTO mcp_event_tokens (server_id, token_hash, token_enc) VALUES (?,?,?)
      ON CONFLICT(server_id) DO UPDATE SET token_hash=excluded.token_hash, token_enc=excluded.token_enc, created_at=datetime('now')`),
    serverByHash: db.prepare(`SELECT s.id, s.name, s.enabled, s.default_access FROM mcp_event_tokens t
      JOIN mcp_servers s ON s.id=t.server_id WHERE t.token_hash=?`),
    roomExists: db.prepare('SELECT 1 FROM rooms WHERE id=?'),
    roomGrant: db.prepare("SELECT allow FROM mcp_access WHERE server_id=? AND subject_type='room' AND subject_id=?"),
    byEventId: db.prepare('SELECT id, content FROM messages WHERE room_id=? AND client_event_id=?'),
  };

  // Same token on every spawn of a server (a new one only when the stored copy is unreadable).
  // No TTL. Not a finding: it lives only in the upstream's env (never argv or an API response) and
  // its row goes with the server (ON DELETE CASCADE); disabling the server refuses it at once.
  function tokenFor(serverId) {
    const row = q.tokenOf.get(serverId);
    if (row) {
      try { return decrypt(row.token_enc); }
      catch (e) { log.warn(`[mcp-events] stored token of server ${serverId} unreadable, issuing a new one: ${e.message}`); }
    }
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    q.upsertToken.run(serverId, hashToken(token), encrypt(token));
    return token;
  }

  // Extra env for a spawned upstream; applied after the server's own env so it cannot be overridden.
  // http upstreams get nothing (v1): they are not spawned here and the token would leave the machine.
  function envFor(row) {
    if (row.transport !== 'stdio') return {};
    try { return { STOA_EVENTS_URL: baseUrl, STOA_EVENTS_TOKEN: tokenFor(row.id) }; }
    catch (e) { log.error(`[mcp-events] token for server ${row.id} failed: ${e.message}`); return {}; }
  }

  // Sliding one-minute window per server, in memory (a restart resets it). → seconds to wait, 0 = allowed.
  const hits = new Map();
  function rateLimitWait(serverId) {
    const now = Date.now();
    const recent = (hits.get(serverId) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length >= ratePerMin) {
      hits.set(serverId, recent);
      return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
    }
    recent.push(now);
    hits.set(serverId, recent);
    return 0;
  }

  // A room row allow=1 grants, allow=0 denies even under default_access 'all'.
  function roomAllowed(server, roomId) {
    const g = q.roomGrant.get(server.id, roomId);
    return g ? g.allow === 1 : server.default_access === 'all';
  }

  async function handle(req, res, { json, readBody, parseJsonBody }) {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    // Only the events token: no session cookie, no agent secret.
    const token = bearerToken(req.headers.authorization);
    const server = token && q.serverByHash.get(hashToken(token));
    if (!server) return json(res, { error: 'unauthorized' }, 401);
    if (!server.enabled) return json(res, { error: 'server is disabled' }, 403);
    const wait = rateLimitWait(server.id);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return json(res, { error: 'rate limited', retry_after: wait }, 429);
    }
    let raw;
    try { raw = await readBody(req, MAX_BODY); }
    catch { return json(res, { error: 'request body too large' }, 413); }
    const body = validateBody(parseJsonBody(raw || ''));
    if (body.error) return json(res, { error: body.error }, 400);
    if (!q.roomExists.get(body.roomId)) return json(res, { error: 'room not found' }, 404);
    if (!roomAllowed(server, body.roomId)) return json(res, { error: 'server has no access to this room' }, 403);
    const threadErr = resolveThread(body.roomId, body.threadId);
    if (threadErr) return json(res, { error: threadErr }, 400);

    // Namespaced per server so two servers (or a browser tab) never share an idempotency key; a
    // generated one when absent lets the message be found even when handleHumanMessage returns nothing.
    const eventKey = `mcp:${server.id}:${body.eventId ?? crypto.randomUUID()}`;
    const prior = q.byEventId.get(body.roomId, eventKey);
    if (prior) {
      if (prior.content !== body.text) return json(res, { error: 'event_id already used with different text' }, 409);
      return json(res, { message_id: prior.id, idempotent: true });
    }
    await handleHumanMessage(body.roomId, body.text, null, null, null, eventKey, body.threadId, { id: null, name: server.name, provider: 'mcp' });
    const stored = q.byEventId.get(body.roomId, eventKey);
    // Not stored: the room has no human participant to post under.
    if (!stored) return json(res, { error: 'room cannot receive messages' }, 409);
    return json(res, { message_id: stored.id });
  }

  return { tokenFor, envFor, handle };
}

module.exports = { createMcpEvents, EVENTS_PATH, TOKEN_PREFIX, MAX_TEXT, RATE_PER_MIN };
