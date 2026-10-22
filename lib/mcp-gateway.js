'use strict';
// MCP gateway: agents see one MCP server ("stoa" in their config) at POST /mcp. Each request carries a
// per-session bearer token; identity (agent, sub-agent, room, thread) comes from that token only,
// never from tool arguments. Tools of upstream servers are exposed as `<slug>__<tool>`.
//
// Streamable HTTP with sessions: an initialize opens a session (bound to the token that opened it) and
// the client's GET stream on it carries notifications/tools/list_changed whenever the tools that session
// would see change (access, servers, tool overrides, an upstream's tool list). Claude Code re-lists on
// that notification mid-session; Codex starts a new process (and session) every turn anyway. A request
// with an unknown session id gets 404, which makes the client initialize again (e.g. after a restart).
// Requests without a session id that are not an initialize are served statelessly.

const crypto = require('crypto');

const TOKEN_PREFIX = 'stoa_mcp_';
const NAME_SEP = '__';
const PREVIEW_MAX = 2048;
// Agents hold a tools/call open while the owner decides; their own MCP tool timeout (stoa.js
// MCP_TOOL_TIMEOUT_MS) must outlast this cap plus the call timeout.
const APPROVAL_TIMEOUT_MAX_MS = 10 * 60_000;
const APPROVAL_MAX_PENDING_PER_AGENT = 20;
const APPROVAL_DECISIONS = Object.freeze({ approve: 'approved', deny: 'denied' });
const RATE_WINDOW_MS = 60_000;
// Sessions without an open GET stream are closed after this long without a request (Codex leaves one
// behind every turn). Per-token cap: Claude Code opens two at once while connecting.
const SESSION_IDLE_MS = 10 * 60_000;
const SESSION_MAX_PER_TOKEN = 8;
const SESSION_MAX = 1000;
const SESSION_SWEEP_MS = 60_000;
const NOTIFY_DEBOUNCE_MS = 250;
const SENSITIVE_KEY_RE = /token|secret|passw(or)?d|api[-_]?key|authorization|cookie|credential|private[-_]?key|session/i;
const WRITE_NAME_RE = /(^|[_\-.])(send|create|delete|remove|update|write|edit|post|push|merge|set|add|close|archive|move|rename|upload|comment|assign|fork|publish|replace|insert|drop|execute|run)([_\-.]|$)/i;

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Access decision for one server. Explicit grants are looked up for the sub-agent, its parent agent
// and the room; any explicit deny wins, then any explicit allow, else the server's default_access.
// So a sub-agent deny narrows an agent allow, and a room deny is a hard boundary for every agent in it.
function decideAccess(server, grants) {
  if (!server.enabled) return false;
  if (grants.some(g => g.allow === 0)) return false;
  if (grants.some(g => g.allow === 1)) return true;
  return server.default_access === 'all';
}

// Annotations win when the upstream sets them; otherwise guess from the verb in the name.
function writeHint(tool) {
  const a = tool?.annotations || {};
  if (a.readOnlyHint === true) return false;
  if (a.destructiveHint === true || a.readOnlyHint === false) return true;
  return WRITE_NAME_RE.test(String(tool?.name || ''));
}

function redact(value, depth = 0) {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY_RE.test(k) ? '***' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…';
  return value;
}

function argsPreview(args) {
  let s;
  try { s = JSON.stringify(redact(args ?? {})); } catch { s = '"[unserializable]"'; }
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX - 1) + '…' : s;
}

// Results over the cap keep their text (cut to fit) and lose non-text parts, with a notice so the
// agent knows it is looking at a partial result.
function capResult(result, capBytes) {
  const raw = JSON.stringify(result ?? {});
  const bytes = Buffer.byteLength(raw);
  if (bytes <= capBytes) return { result, bytes };
  const parts = Array.isArray(result?.content) ? result.content : [];
  let text = parts.map(p => (p?.type === 'text' ? String(p.text ?? '') : `[${p?.type || 'part'} omitted]`)).join('\n');
  if (!text && result?.structuredContent) text = JSON.stringify(result.structuredContent);
  const budget = Math.max(0, capBytes - 512);
  const buf = Buffer.from(text);
  text = buf.length > budget ? buf.subarray(0, budget).toString('utf8').replace(/�+$/, '') : text;
  const notice = `\n\n[stoa: result truncated — ${bytes} bytes exceeded the ${capBytes}-byte cap]`;
  return { result: { content: [{ type: 'text', text: text + notice }], isError: !!result?.isError }, bytes };
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const isoUtc = (s) => (typeof s === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);

// mcp_approvals row (+ actor_name, sub_agent_label) → the shape the WS events and the API share.
function approvalView(r) {
  return {
    id: r.id, server_slug: r.server_slug, tool: r.tool, args_preview: r.args_preview,
    actor_id: r.actor_id, actor_name: r.actor_name ?? null, sub_agent_id: r.sub_agent_id, sub_agent_label: r.sub_agent_label ?? null,
    room_id: r.room_id, thread_id: r.thread_id, status: r.status,
    created_at: isoUtc(r.created_at), expires_at: isoUtc(r.expires_at), decided_at: isoUtc(r.decided_at) ?? null,
  };
}

function createMcpGateway({
  db, upstreams, encrypt, decrypt, log = console,
  callTimeoutMs = 60_000, resultCapBytes = 256 * 1024, version = '1.0.0', sdk = null,
  approvalTimeoutMs = 5 * 60_000, sessionIdleMs = SESSION_IDLE_MS, notifyDebounceMs = NOTIFY_DEBOUNCE_MS,
  onApproval = () => {},           // ('mcp_approval' | 'mcp_approval_resolved', approvalView)
}) {
  const S = sdk || {
    Server: require('@modelcontextprotocol/sdk/server/index.js').Server,
    StreamableHTTPServerTransport: require('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport,
    ListToolsRequestSchema: require('@modelcontextprotocol/sdk/types.js').ListToolsRequestSchema,
    CallToolRequestSchema: require('@modelcontextprotocol/sdk/types.js').CallToolRequestSchema,
  };

  const q = {
    findToken: db.prepare(`SELECT token_enc FROM mcp_tokens WHERE actor_id=? AND room_id IS ? AND thread_id IS ? AND sub_agent_id IS ?
      AND revoked_at IS NULL ORDER BY rowid DESC LIMIT 1`),
    insertToken: db.prepare('INSERT INTO mcp_tokens (token_hash, token_enc, actor_id, room_id, thread_id, sub_agent_id) VALUES (?,?,?,?,?,?)'),
    tokenByHash: db.prepare('SELECT actor_id, room_id, thread_id, sub_agent_id FROM mcp_tokens WHERE token_hash=? AND revoked_at IS NULL'),
    actorOk: db.prepare("SELECT 1 FROM actors WHERE id=? AND type='ai'"),
    subAgentOk: db.prepare('SELECT 1 FROM sub_agents WHERE id=? AND parent_actor_id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    revokeActor: db.prepare("UPDATE mcp_tokens SET revoked_at=datetime('now') WHERE actor_id=? AND revoked_at IS NULL"),
    revokeSubAgent: db.prepare("UPDATE mcp_tokens SET revoked_at=datetime('now') WHERE sub_agent_id=? AND revoked_at IS NULL"),
    revokeRoom: db.prepare("UPDATE mcp_tokens SET revoked_at=datetime('now') WHERE room_id=? AND revoked_at IS NULL"),
    deleteAccess: db.prepare('DELETE FROM mcp_access WHERE subject_type=? AND subject_id=?'),
    subAgentsOf: db.prepare('SELECT id FROM sub_agents WHERE parent_actor_id=?'),
    enabledServers: db.prepare('SELECT * FROM mcp_servers WHERE enabled=1 ORDER BY id'),
    serverBySlug: db.prepare('SELECT * FROM mcp_servers WHERE slug=?'),
    grants: db.prepare(`SELECT server_id, allow FROM mcp_access WHERE
      (subject_type='sub_agent' AND subject_id=?) OR (subject_type='agent' AND subject_id=?) OR (subject_type='room' AND subject_id=?)`),
    overrides: db.prepare('SELECT server_id, tool, enabled FROM mcp_tool_overrides'),
    overridesFor: db.prepare('SELECT enabled, requires_approval, rate_limit_per_min FROM mcp_tool_overrides WHERE server_id=? AND tool=?'),
    insertCall: db.prepare(`INSERT INTO mcp_calls (server_id, server_slug, tool, actor_id, sub_agent_id, room_id, thread_id, args_preview, status, error, duration_ms, result_bytes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    insertApproval: db.prepare(`INSERT INTO mcp_approvals (server_id, server_slug, tool, actor_id, sub_agent_id, room_id, thread_id, args_preview, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`),
    approval: db.prepare(`SELECT ap.*, a.name AS actor_name, sa.label AS sub_agent_label FROM mcp_approvals ap
      LEFT JOIN actors a ON a.id=ap.actor_id LEFT JOIN sub_agents sa ON sa.id=ap.sub_agent_id WHERE ap.id=?`),
    settleApproval: db.prepare("UPDATE mcp_approvals SET status=?, decided_at=datetime('now') WHERE id=? AND status='pending'"),
    pendingOfActor: db.prepare("SELECT COUNT(*) AS n FROM mcp_approvals WHERE status='pending' AND actor_id=?"),
    pendingIdsBy: {
      actor: db.prepare("SELECT id FROM mcp_approvals WHERE status='pending' AND actor_id=?"),
      sub_agent: db.prepare("SELECT id FROM mcp_approvals WHERE status='pending' AND sub_agent_id=?"),
      room: db.prepare("SELECT id FROM mcp_approvals WHERE status='pending' AND room_id=?"),
    },
  };

  // Pending rows from before this process started have no request waiting on them any more.
  db.prepare("UPDATE mcp_approvals SET status='expired', decided_at=datetime('now') WHERE status='pending'").run();
  const waiters = new Map();         // approval id → (status) => void

  function emitApproval(type, id) {
    const row = q.approval.get(id);
    if (!row) return;
    try { onApproval(type, approvalView(row)); } catch (e) { log.error(`[mcp] approval listener failed: ${e.message}`); }
  }

  // Sliding one-minute window per (agent, sub-agent, server, tool). In memory: a restart resets it,
  // which only ever lets a few extra calls through. → seconds until the next call fits, 0 = allowed.
  const hits = new Map();
  function rateLimitWait(ident, server, tool, limit) {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, ts] of hits) if (!ts.length || now - ts[ts.length - 1] >= RATE_WINDOW_MS) hits.delete(k);
    }
    const key = `${ident.actorId}\n${ident.subAgentId ?? ''}\n${server.id}\n${tool}`;
    const recent = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
    }
    recent.push(now);
    hits.set(key, recent);
    return 0;
  }

  // The conditional UPDATE is the single arbiter between owner decision, timeout, abort and cleanup:
  // only the first to move the row off 'pending' wins. → true when this call settled it.
  function settle(id, status) {
    if (q.settleApproval.run(status, id).changes !== 1) return false;
    const done = waiters.get(id);
    waiters.delete(id);
    done?.(status);
    emitApproval('mcp_approval_resolved', id);
    return true;
  }

  // → 'approved' | 'denied' | 'expired' | 'too_many'. signal aborts when the agent drops the request.
  function awaitApproval(ident, server, tool, args, signal) {
    if (q.pendingOfActor.get(ident.actorId).n >= APPROVAL_MAX_PENDING_PER_AGENT) return Promise.resolve('too_many');
    if (signal?.aborted) return Promise.resolve('expired');
    const id = Number(q.insertApproval.run(server.id, server.slug, String(tool).slice(0, 200), ident.actorId, ident.subAgentId,
      ident.roomId, ident.threadId, argsPreview(args), sqlTime(Date.now() + approvalTimeoutMs)).lastInsertRowid);
    return new Promise((resolve) => {
      const onAbort = () => settle(id, 'expired');
      const timer = setTimeout(() => settle(id, 'expired'), approvalTimeoutMs);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.set(id, (status) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(status);
      });
      emitApproval('mcp_approval', id);
    });
  }

  // Owner decision. → { status: 200, approval } | { status: 404 | 409, error }.
  function decideApproval(id, decision) {
    const status = APPROVAL_DECISIONS[decision];
    if (!status) return { status: 400, error: 'decision must be approve or deny' };
    const row = q.approval.get(id);
    if (!row) return { status: 404, error: 'approval not found' };
    // Pending in the DB with nobody waiting (request already gone) is closed as expired, not approved.
    if (row.status === 'pending' && !waiters.has(id)) settle(id, 'expired');
    else if (row.status === 'pending' && settle(id, status)) return { status: 200, approval: approvalView(q.approval.get(id)) };
    return { status: 409, error: 'approval was already decided or has expired', approval: approvalView(q.approval.get(id)) };
  }

  function listApprovals({ roomId = null, threadId = null, status = null, beforeId = null, limit = 50 } = {}) {
    const where = [];
    const args = [];
    if (roomId != null) { where.push('ap.room_id=?'); args.push(roomId); }
    if (threadId != null) { where.push('ap.thread_id=?'); args.push(threadId); }
    if (status != null) { where.push('ap.status=?'); args.push(status); }
    if (beforeId != null) { where.push('ap.id<?'); args.push(beforeId); }
    const rows = db.prepare(`SELECT ap.*, a.name AS actor_name, sa.label AS sub_agent_label FROM mcp_approvals ap
      LEFT JOIN actors a ON a.id=ap.actor_id LEFT JOIN sub_agents sa ON sa.id=ap.sub_agent_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ap.id DESC LIMIT ?`).all(...args, limit);
    return { approvals: rows.map(approvalView), next_before_id: rows.length === limit ? rows[rows.length - 1].id : null };
  }

  function expirePending(kind, id) {
    for (const r of q.pendingIdsBy[kind].all(id)) settle(r.id, 'expired');
  }

  // Same token for the same session key, so the agent's session env (and thus the session) is stable.
  // No TTL. Not a finding: an expiring token would change the env and respawn the session; the token
  // lives only in the agent's env (never argv or an API response) and is revoked when its agent,
  // sub-agent or room is deleted (forget*), and authenticate() re-checks all three on every request.
  function issueToken({ actorId, roomId = null, threadId = null, subAgentId = null }) {
    const row = q.findToken.get(actorId, roomId, threadId, subAgentId);
    if (row) {
      try { return decrypt(row.token_enc); }
      catch (e) { log.warn(`[mcp] stored token unreadable (credentials key changed?), issuing a new one: ${e.message}`); }
    }
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    q.insertToken.run(hashToken(token), encrypt(token), actorId, roomId, threadId, subAgentId);
    return token;
  }

  function bearerToken(authorization) {
    const m = typeof authorization === 'string' && authorization.match(/^Bearer\s+(\S{1,256})$/i);
    return m && m[1].startsWith(TOKEN_PREFIX) ? m[1] : null;
  }

  // → identity or null. Re-checks that the agent, sub-agent and room membership still exist.
  function authenticate(authorization) {
    const token = bearerToken(authorization);
    return token ? identByHash(hashToken(token)) : null;
  }

  function identByHash(tokenHash) {
    const row = q.tokenByHash.get(tokenHash);
    if (!row) return null;
    if (!q.actorOk.get(row.actor_id)) return null;
    if (row.sub_agent_id != null && !q.subAgentOk.get(row.sub_agent_id, row.actor_id)) return null;
    if (row.room_id != null && !q.inRoom.get(row.room_id, row.actor_id)) return null;
    return { actorId: row.actor_id, roomId: row.room_id, threadId: row.thread_id, subAgentId: row.sub_agent_id };
  }

  function grantsBy(ident) {
    const by = new Map();
    for (const g of q.grants.all(ident.subAgentId ?? -1, ident.actorId, ident.roomId ?? -1)) {
      if (!by.has(g.server_id)) by.set(g.server_id, []);
      by.get(g.server_id).push(g);
    }
    return by;
  }

  function allowedServers(ident) {
    const by = grantsBy(ident);
    return q.enabledServers.all().filter(s => decideAccess(s, by.get(s.id) || []));
  }

  // requires_approval tools stay listed; the call waits for the owner (callTool).
  const toolUsable = (ov) => !ov || ov.enabled === 1;

  async function visibleTools(ident) {
    const servers = allowedServers(ident);
    const ovs = new Map(q.overrides.all().map(o => [`${o.server_id}\n${o.tool}`, o]));
    const lists = await Promise.all(servers.map(s => upstreams.listTools(s).then(
      tools => tools.map(t => ({ server: s, tool: t })),
      (err) => { log.warn(`[mcp:${s.slug}] tools/list skipped: ${err.message}`); return []; },
    )));
    return lists.flat()
      .filter(({ server, tool }) => toolUsable(ovs.get(`${server.id}\n${tool.name}`)))
      .map(({ server, tool }) => ({ ...tool, name: server.slug + NAME_SEP + tool.name }));
  }

  function record(ident, server, slug, tool, args, status, error, startedAt, resultBytes = null) {
    try {
      q.insertCall.run(server?.id ?? null, server?.slug ?? slug ?? null, String(tool).slice(0, 200), ident.actorId, ident.subAgentId, ident.roomId, ident.threadId,
        argsPreview(args), status, error ? String(error).slice(0, 1000) : null, Date.now() - startedAt, resultBytes);
    } catch (e) { log.error(`[mcp] failed to record call: ${e.message}`); }
  }

  async function callTool(ident, name, args, { signal } = {}) {
    const startedAt = Date.now();
    const full = String(name || '');
    const sep = full.indexOf(NAME_SEP);
    const slug = sep > 0 ? full.slice(0, sep) : null;
    const tool = sep > 0 ? full.slice(sep + NAME_SEP.length) : full;
    const server = slug ? q.serverBySlug.get(slug) : null;
    const deny = (reason) => { record(ident, server, slug, tool || full, args, 'denied', reason, startedAt); return toolError(`Denied by Stoa: ${reason}`); };
    if (!server || !tool) return deny('unknown tool');
    if (!server.enabled) return deny('MCP server is disabled');
    if (!decideAccess(server, grantsBy(ident).get(server.id) || [])) return deny('this agent has no access to this MCP server');
    const ov = q.overridesFor.get(server.id, tool);
    if (ov && ov.enabled !== 1) return deny('tool is disabled');
    if (ov?.rate_limit_per_min) {
      const wait = rateLimitWait(ident, server, tool, ov.rate_limit_per_min);
      if (wait) {
        const msg = `rate limited (${ov.rate_limit_per_min} calls per minute for this tool), try again in ${wait}s`;
        record(ident, server, slug, tool, args, 'rate_limited', msg, startedAt);
        return toolError(`Stoa: ${msg}`);
      }
    }
    if (ov && ov.requires_approval === 1) {
      const outcome = await awaitApproval(ident, server, tool, args, signal);
      if (outcome === 'too_many') return deny(`this agent already has ${APPROVAL_MAX_PENDING_PER_AGENT} calls waiting for owner approval`);
      if (outcome === 'denied') return deny('the owner denied this call');
      if (outcome !== 'approved') return deny(`owner approval expired after ${Math.round(approvalTimeoutMs / 1000)}s; the call was not made`);
    }
    try {
      const raw = await upstreams.callTool(server, tool, args, { timeoutMs: callTimeoutMs });
      const { result, bytes } = capResult(raw, resultCapBytes);
      record(ident, server, slug, tool, args, raw?.isError ? 'error' : 'ok', raw?.isError ? firstText(raw) : null, startedAt, bytes);
      return result;
    } catch (err) {
      const timedOut = err?.code === -32001;
      const msg = String(err?.message || err).slice(0, 500);
      record(ident, server, slug, tool, args, timedOut ? 'timeout' : 'error', msg, startedAt);
      return toolError(timedOut ? `Tool timed out after ${Math.round(callTimeoutMs / 1000)}s` : `Tool failed: ${msg}`);
    }
  }

  function firstText(result) {
    const t = Array.isArray(result?.content) ? result.content.find(p => p?.type === 'text') : null;
    return t ? String(t.text ?? '').slice(0, 1000) : 'tool returned an error';
  }

  function newServer(ident, session = null) {
    const server = new S.Server({ name: 'stoa', version }, { capabilities: { tools: { listChanged: true } } });
    server.setRequestHandler(S.ListToolsRequestSchema, async () => {
      const tools = await visibleTools(ident);
      if (session) session.fp = toolsFingerprint(ident, disabledTools());
      return { tools };
    });
    server.setRequestHandler(S.CallToolRequestSchema, async (r, extra) => callTool(ident, r.params.name, r.params.arguments, { signal: extra?.signal }));
    return server;
  }

  // mcp-session-id → { id, ident, tokenHash, server, transport, lastSeen, streams, fp }
  const sessions = new Map();

  function closeSession(s) {
    if (sessions.get(s.id) === s) sessions.delete(s.id);
    s.transport.close().catch(() => {});
    s.server.close().catch(() => {});
  }
  function closeSessionsWhere(pred) {
    for (const s of [...sessions.values()]) if (pred(s.ident)) closeSession(s);
  }
  function oldest(list) {
    return list.reduce((a, b) => (b.lastSeen < a.lastSeen ? b : a));
  }
  function makeRoom(tokenHash) {
    const mine = [...sessions.values()].filter(s => s.tokenHash === tokenHash);
    if (mine.length >= SESSION_MAX_PER_TOKEN) closeSession(oldest(mine));
    if (sessions.size >= SESSION_MAX) closeSession(oldest([...sessions.values()]));
  }

  // Runs only while sessions exist. Must never throw: it is a timer callback in the server process.
  let sweepTimer = null;
  function sweep() {
    const now = Date.now();
    for (const s of [...sessions.values()]) {
      try {
        if ((!s.streams && now - s.lastSeen > sessionIdleMs) || !identByHash(s.tokenHash)) closeSession(s);
      } catch (e) { log.error(`[mcp] session sweep failed: ${e.message}`); }
    }
    if (!sessions.size) { clearInterval(sweepTimer); sweepTimer = null; }
  }
  function ensureSweep() {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweep, Math.min(SESSION_SWEEP_MS, sessionIdleMs));
    sweepTimer.unref?.();
  }

  function close() {
    clearInterval(sweepTimer); sweepTimer = null;
    clearTimeout(notifyTimer); notifyTimer = null;
    for (const s of [...sessions.values()]) closeSession(s);
  }

  // What a session's tools/list would contain, from the DB and the upstreams' cached tool lists (no
  // upstream is started for this). '?' = not listed yet; a later start changes the fingerprint.
  function disabledTools() {
    return new Set(q.overrides.all().filter(o => o.enabled !== 1).map(o => `${o.server_id}\n${o.tool}`));
  }
  function toolsFingerprint(ident, disabled) {
    return allowedServers(ident).map((s) => {
      const tools = upstreams.info?.(s)?.tools;
      if (!tools) return `${s.id}:?`;
      return `${s.id}:` + tools.map(t => t.name).filter(n => !disabled.has(`${s.id}\n${n}`)).sort().join(',');
    }).join('|');
  }

  // Called after anything that can change what agents see. Debounced: one access-matrix save touches
  // many rows. Only sessions whose visible tools actually changed are notified.
  let notifyTimer = null;
  function toolsChanged() {
    if (notifyTimer || !sessions.size) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      let disabled;
      try { disabled = disabledTools(); } catch (e) { log.error(`[mcp] tools change check failed: ${e.message}`); return; }
      for (const s of [...sessions.values()]) {
        let fp;
        try { fp = toolsFingerprint(s.ident, disabled); } catch (e) { log.error(`[mcp] tools change check failed: ${e.message}`); continue; }
        if (fp === s.fp) continue;
        s.fp = fp;
        s.server.sendToolListChanged().catch(e => log.warn(`[mcp] tools/list_changed not delivered: ${e.message}`));
      }
    }, notifyDebounceMs);
    notifyTimer.unref?.();
  }

  function sessionNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
  }

  async function openSession(req, res, body, ident, tokenHash) {
    makeRoom(tokenHash);
    const s = { id: null, ident, tokenHash, lastSeen: Date.now(), streams: 0, fp: null };
    s.server = newServer(ident, s);
    s.transport = new S.StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { s.id = id; sessions.set(id, s); ensureSweep(); },
    });
    s.server.onclose = () => { if (sessions.get(s.id) === s) sessions.delete(s.id); };
    // A failed initialize never gets an id; nothing else references it.
    res.on('close', () => { if (!s.id) closeSession(s); });
    try { s.fp = toolsFingerprint(ident, disabledTools()); } catch { s.fp = null; }
    await s.server.connect(s.transport);
    await s.transport.handleRequest(req, res, body);
  }

  // POST/GET/DELETE /mcp. body = parsed JSON (POST) or undefined.
  async function handle(req, res, body) {
    const token = bearerToken(req.headers.authorization);
    const tokenHash = token && hashToken(token);
    const ident = tokenHash && identByHash(tokenHash);
    if (!ident) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="stoa-mcp"' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    const sid = req.headers['mcp-session-id'];
    if (typeof sid === 'string' && sid) {
      const s = sessions.get(sid);
      // A session is only usable with the token that opened it.
      if (!s || s.tokenHash !== tokenHash) return sessionNotFound(res);
      s.lastSeen = Date.now();
      if (req.method === 'GET') {
        s.streams++;
        res.on('close', () => { s.streams--; s.lastSeen = Date.now(); });
      }
      return s.transport.handleRequest(req, res, body);
    }
    if (req.method === 'POST' && body && !Array.isArray(body) && body.method === 'initialize') return openSession(req, res, body, ident, tokenHash);
    const server = newServer(ident);
    const transport = new S.StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // Polymorphic mcp_access rows and tokens are not covered by FKs; callers run these before deleting.
  function forgetSubAgent(id) {
    q.deleteAccess.run('sub_agent', id);
    q.revokeSubAgent.run(id);
    expirePending('sub_agent', id);
    closeSessionsWhere(i => i.subAgentId === id);
  }
  function forgetActor(id) {
    for (const sa of q.subAgentsOf.all(id)) q.deleteAccess.run('sub_agent', sa.id);
    q.deleteAccess.run('agent', id);
    q.revokeActor.run(id);
    expirePending('actor', id);
    closeSessionsWhere(i => i.actorId === id);
  }
  function forgetRoom(id) {
    q.deleteAccess.run('room', id);
    q.revokeRoom.run(id);
    expirePending('room', id);
    closeSessionsWhere(i => i.roomId === id);
  }

  // Activity log + decided approvals retention. → rows deleted.
  function pruneCalls(days) {
    const cutoff = `-${Math.max(1, Math.floor(days))} days`;
    const calls = db.prepare("DELETE FROM mcp_calls WHERE created_at < datetime('now', ?)").run(cutoff).changes;
    const approvals = db.prepare("DELETE FROM mcp_approvals WHERE created_at < datetime('now', ?) AND status != 'pending'").run(cutoff).changes;
    return calls + approvals;
  }

  return {
    issueToken, authenticate, visibleTools, callTool, handle, forgetSubAgent, forgetActor, forgetRoom, allowedServers, pruneCalls,
    decideApproval, listApprovals, toolsChanged, sessionCount: () => sessions.size, close,
  };
}

module.exports = {
  createMcpGateway, decideAccess, writeHint, argsPreview, capResult, hashToken, approvalView,
  TOKEN_PREFIX, NAME_SEP, APPROVAL_TIMEOUT_MAX_MS,
};
