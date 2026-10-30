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
//
// Built-in tools (option builtinTools, e.g. lib/room-schedules.js) are Stoa's own, served here without
// an upstream as `stoa__<tool>`. The slug "stoa" is reserved (lib/mcp-api.js refuses it); a row that
// still has it is never exposed or called, so a built-in name can't be shadowed by an upstream.
// A built-in marked requiresApproval waits for the owner on every call, like an upstream tool with
// requires_approval, but with no 'always': its approvals carry server_id NULL + slug "stoa" and no
// exemption is ever created or consulted for it. Its precheck runs first, so a call that is bound to fail
// never reaches the owner as a card.

const crypto = require('crypto');

const TOKEN_PREFIX = 'stoa_mcp_';
const NAME_SEP = '__';
const BUILTIN_SLUG = 'stoa';
const PREVIEW_MAX = 2048;
// Agents hold a tools/call open while the owner decides; their own MCP tool timeout (stoa.js
// MCP_TOOL_TIMEOUT_MS) must outlast this cap plus the call timeout.
const APPROVAL_TIMEOUT_MAX_MS = 10 * 60_000;
const APPROVAL_MAX_PENDING_PER_AGENT = 20;
// 'always' approves like 'approve' and also exempts the requester from approval for that tool.
const APPROVAL_DECISIONS = Object.freeze({ approve: 'approved', deny: 'denied', always: 'approved' });
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

// cut.hit is set when anything had to be shortened to fit (masking a sensitive key is not a cut).
function redact(value, depth = 0, cut = {}) {
  if (depth > 6) { cut.hit = true; return '…'; }
  if (Array.isArray(value)) {
    if (value.length > 50) cut.hit = true;
    return value.slice(0, 50).map(v => redact(v, depth + 1, cut));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY_RE.test(k) ? '***' : redact(v, depth + 1, cut);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) { cut.hit = true; return value.slice(0, 500) + '…'; }
  return value;
}

// → { text, complete }. complete = false when the preview leaves part of the arguments out.
function previewOf(args) {
  const cut = { hit: false };
  let s;
  try { s = JSON.stringify(redact(args ?? {}, 0, cut)); } catch { s = '"[unserializable]"'; cut.hit = true; }
  if (s.length > PREVIEW_MAX) { s = s.slice(0, PREVIEW_MAX - 1) + '…'; cut.hit = true; }
  return { text: s, complete: !cut.hit };
}

function argsPreview(args) {
  return previewOf(args).text;
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

function exemptionView(r) {
  return {
    id: r.id, server_id: r.server_id, server_slug: r.server_slug, tool: r.tool,
    actor_id: r.actor_id, actor_name: r.actor_name ?? null, sub_agent_id: r.sub_agent_id, sub_agent_label: r.sub_agent_label ?? null,
    created_at: isoUtc(r.created_at),
  };
}

const isBuiltinApproval = (r) => r.server_id == null && r.server_slug === BUILTIN_SLUG;

// mcp_approvals row (+ actor_name, sub_agent_label) → the shape the WS events and the API share.
// allow_always: false for a built-in, whose every call needs its own decision.
function approvalView(r) {
  return {
    id: r.id, server_slug: r.server_slug, tool: r.tool, args_preview: r.args_preview, allow_always: !isBuiltinApproval(r),
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
  // [{ name, description, inputSchema, annotations, call(ident, args) → result, availableTo?(ident) → bool,
  //    resultCapBytes? (overrides the cap below for a tool whose result is a whole file),
  //    requiresApproval?: true, previewArgs?(args) → what the approval card and mcp_calls show instead of args,
  //    precheck?(ident, args) → error message or null, checked before the owner is asked }]
  // availableTo hides a built-in from sessions it can never succeed in (e.g. sub-agent sessions) and
  // refuses the call there; the tool still enforces its own scope.
  builtinTools = [],
}) {
  const builtins = new Map(builtinTools.map(t => [t.name, t]));
  const builtinList = builtinTools.map(({ name, description, inputSchema, annotations, availableTo }) => ({
    availableTo,
    tool: { name: BUILTIN_SLUG + NAME_SEP + name, description, inputSchema, ...(annotations ? { annotations } : {}) },
  }));
  const builtinAvailable = (b, ident) => !b.availableTo || b.availableTo(ident);
  const BUILTIN_SERVER = Object.freeze({ id: null, slug: BUILTIN_SLUG });
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
    insertCall: db.prepare(`INSERT INTO mcp_calls (server_id, server_slug, tool, actor_id, sub_agent_id, room_id, thread_id, args_preview, status, error, duration_ms, result_bytes, approval)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    exempted: db.prepare('SELECT 1 FROM mcp_approval_exemptions WHERE server_id=? AND tool=? AND actor_id=? AND sub_agent_id IS ?'),
    insertExemption: db.prepare('INSERT INTO mcp_approval_exemptions (server_id, tool, actor_id, sub_agent_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING'),
    exemptionId: db.prepare('SELECT id FROM mcp_approval_exemptions WHERE server_id=? AND tool=? AND actor_id=? AND sub_agent_id IS ?'),
    exemption: db.prepare(`SELECT e.*, s.slug AS server_slug, a.name AS actor_name, sa.label AS sub_agent_label FROM mcp_approval_exemptions e
      JOIN mcp_servers s ON s.id=e.server_id LEFT JOIN actors a ON a.id=e.actor_id LEFT JOIN sub_agents sa ON sa.id=e.sub_agent_id WHERE e.id=?`),
    deleteExemption: db.prepare('DELETE FROM mcp_approval_exemptions WHERE id=?'),
    deleteExemptionsOfActor: db.prepare('DELETE FROM mcp_approval_exemptions WHERE actor_id=?'),
    deleteExemptionsOfSubAgent: db.prepare('DELETE FROM mcp_approval_exemptions WHERE sub_agent_id=?'),
    pendingIdsByKey: db.prepare(`SELECT id FROM mcp_approvals WHERE status='pending' AND server_id=? AND tool=? AND actor_id=? AND sub_agent_id IS ?
      ORDER BY id`),
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
    release(id, status);
    return true;
  }
  function release(id, status) {
    const done = waiters.get(id);
    waiters.delete(id);
    done?.(status);
    emitApproval('mcp_approval_resolved', id);
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

  // Owner decision. → { status: 200, approval, exemption? } | { status: 400 | 404 | 409, error }.
  // 'always' creates the exemption only once the approval itself is known to be live, then approves the
  // other calls of the same agent/sub-agent already waiting on that tool (each emits its resolved event).
  function decideApproval(id, decision) {
    const status = Object.hasOwn(APPROVAL_DECISIONS, decision) ? APPROVAL_DECISIONS[decision] : null;
    if (!status) return { status: 400, error: 'decision must be approve, deny or always' };
    const row = q.approval.get(id);
    if (!row) return { status: 404, error: 'approval not found' };
    const conflict = () => ({ status: 409, error: 'approval was already decided or has expired', approval: approvalView(q.approval.get(id)) });
    if (row.status !== 'pending') return conflict();
    // Pending in the DB with nobody waiting (request already gone) is closed as expired, not approved.
    if (!waiters.has(id)) { settle(id, 'expired'); return conflict(); }
    if (decision !== 'always') {
      settle(id, status);
      return { status: 200, approval: approvalView(q.approval.get(id)) };
    }
    // A built-in approval stays pending: the owner can still approve or deny it once.
    if (isBuiltinApproval(row)) return { status: 400, error: 'always is not available for this tool' };
    // server_id goes NULL when the server is deleted; such a call can never run, so nothing to exempt.
    if (row.server_id == null) { settle(id, 'expired'); return conflict(); }
    const key = [row.server_id, row.tool, row.actor_id, row.sub_agent_id];
    q.insertExemption.run(...key);
    const exemptionId = q.exemptionId.get(...key).id;
    settle(id, 'approved');
    for (const r of q.pendingIdsByKey.all(...key)) settle(r.id, waiters.has(r.id) ? 'approved' : 'expired');
    return { status: 200, approval: approvalView(q.approval.get(id)), exemption: exemptionView(q.exemption.get(exemptionId)) };
  }

  function listExemptions({ serverId = null } = {}) {
    const rows = db.prepare(`SELECT e.*, s.slug AS server_slug, a.name AS actor_name, sa.label AS sub_agent_label FROM mcp_approval_exemptions e
      JOIN mcp_servers s ON s.id=e.server_id LEFT JOIN actors a ON a.id=e.actor_id LEFT JOIN sub_agents sa ON sa.id=e.sub_agent_id
      ${serverId != null ? 'WHERE e.server_id=?' : ''} ORDER BY e.server_id, e.tool, e.id`).all(...(serverId != null ? [serverId] : []));
    return { exemptions: rows.map(exemptionView) };
  }

  // → true when a row was deleted.
  function deleteExemption(id) {
    return q.deleteExemption.run(id).changes === 1;
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
  // sub-agent or room is deleted (forgetSubAgent/dropActor/forgetRoom), and authenticate() re-checks all three on every request.
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
    return q.enabledServers.all().filter(s => s.slug !== BUILTIN_SLUG && decideAccess(s, by.get(s.id) || []));
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
    return builtinList.filter(b => builtinAvailable(b, ident)).map(b => b.tool).concat(lists.flat()
      .filter(({ server, tool }) => toolUsable(ovs.get(`${server.id}\n${tool.name}`)))
      .map(({ server, tool }) => ({ ...tool, name: server.slug + NAME_SEP + tool.name })));
  }

  // → why the call may not run, or null when the owner approved it.
  function approvalRefusal(outcome) {
    if (outcome === 'approved') return null;
    if (outcome === 'too_many') return `this agent already has ${APPROVAL_MAX_PENDING_PER_AGENT} calls waiting for owner approval`;
    if (outcome === 'denied') return 'the owner denied this call';
    return `owner approval expired after ${Math.round(approvalTimeoutMs / 1000)}s; the call was not made`;
  }

  // Not subject to grants or overrides: each built-in enforces its own room scope. Approval only when the
  // built-in asks for it (requiresApproval), and then on every call: exemptions never apply.
  async function callBuiltin(ident, tool, args, startedAt, signal) {
    const b = builtins.get(tool);
    if (!b) {
      record(ident, null, BUILTIN_SLUG, tool, args, 'denied', 'unknown tool', startedAt);
      return toolError('Denied by Stoa: unknown tool');
    }
    const shown = b.previewArgs ? b.previewArgs(args ?? {}) : args;
    const deny = (reason) => {
      record(ident, null, BUILTIN_SLUG, tool, shown, 'denied', reason, startedAt);
      return toolError(`Denied by Stoa: ${reason}`);
    };
    if (!builtinAvailable(b, ident)) return deny('this tool is not available in this session');
    if (b.precheck) {
      let problem;
      try { problem = await b.precheck(ident, args ?? {}); }
      catch (err) {
        problem = `Tool failed: ${String(err?.message || err).slice(0, 500)}`;
        log.error(`[mcp:${BUILTIN_SLUG}] ${tool} precheck failed: ${problem}`);
      }
      if (problem) {
        record(ident, null, BUILTIN_SLUG, tool, shown, 'error', problem, startedAt);
        return toolError(problem);
      }
    }
    let approval = null;
    if (b.requiresApproval) {
      // The owner must see everything they approve; a preview cut to fit could hide part of the call.
      if (!previewOf(shown).complete) return deny('the arguments are too long to show in full for owner approval');
      approval = 'owner';
      const refusal = approvalRefusal(await awaitApproval(ident, BUILTIN_SERVER, tool, shown, signal));
      if (refusal) return deny(refusal);
    }
    try {
      const { result, bytes } = capResult(await b.call(ident, args ?? {}), b.resultCapBytes ?? resultCapBytes);
      record(ident, null, BUILTIN_SLUG, tool, shown, result?.isError ? 'error' : 'ok', result?.isError ? firstText(result) : null, startedAt, bytes, approval);
      return result;
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 500);
      log.error(`[mcp:${BUILTIN_SLUG}] ${tool} failed: ${msg}`);
      record(ident, null, BUILTIN_SLUG, tool, shown, 'error', msg, startedAt, null, approval);
      return toolError(`Tool failed: ${msg}`);
    }
  }

  function record(ident, server, slug, tool, args, status, error, startedAt, resultBytes = null, approval = null) {
    try {
      q.insertCall.run(server?.id ?? null, server?.slug ?? slug ?? null, String(tool).slice(0, 200), ident.actorId, ident.subAgentId, ident.roomId, ident.threadId,
        argsPreview(args), status, error ? String(error).slice(0, 1000) : null, Date.now() - startedAt, resultBytes, approval);
    } catch (e) { log.error(`[mcp] failed to record call: ${e.message}`); }
  }

  async function callTool(ident, name, args, { signal } = {}) {
    const startedAt = Date.now();
    const full = String(name || '');
    const sep = full.indexOf(NAME_SEP);
    const slug = sep > 0 ? full.slice(0, sep) : null;
    const tool = sep > 0 ? full.slice(sep + NAME_SEP.length) : full;
    if (slug === BUILTIN_SLUG) return callBuiltin(ident, tool, args, startedAt, signal);
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
    let approval = null;
    if (ov && ov.requires_approval === 1 && q.exempted.get(server.id, String(tool).slice(0, 200), ident.actorId, ident.subAgentId)) {
      approval = 'exemption';
    } else if (ov && ov.requires_approval === 1) {
      approval = 'owner';
      const refusal = approvalRefusal(await awaitApproval(ident, server, tool, args, signal));
      if (refusal) return deny(refusal);
    }
    try {
      const raw = await upstreams.callTool(server, tool, args, { timeoutMs: callTimeoutMs });
      const { result, bytes } = capResult(raw, resultCapBytes);
      record(ident, server, slug, tool, args, raw?.isError ? 'error' : 'ok', raw?.isError ? firstText(raw) : null, startedAt, bytes, approval);
      return result;
    } catch (err) {
      const timedOut = err?.code === -32001;
      const msg = String(err?.message || err).slice(0, 500);
      record(ident, server, slug, tool, args, timedOut ? 'timeout' : 'error', msg, startedAt, null, approval);
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

  // mcp-session-id → { id, ident, tokenHash, server, transport, lastSeen, streams, fp, recheck }
  // streams = responses of the session's GET requests still open; fp = the tool set the client last
  // saw or was told changed.
  const sessions = new Map();

  function closeSession(s) {
    if (sessions.get(s.id) === s) sessions.delete(s.id);
    clearTimeout(s.recheck);
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
        if ((!s.streams.size && now - s.lastSeen > sessionIdleMs) || !identByHash(s.tokenHash)) closeSession(s);
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
  // Without an eventStore the SDK drops a notification silently (send() still resolves) when the
  // session's GET stream is not open, so fp only advances once the notification went out on an open
  // stream; a session that missed it is caught up when its stream reopens (watchStream).
  function streamOpen(s) {
    return [...s.streams].some(r => r.headersSent && r.statusCode === 200 && !r.writableEnded && !r.destroyed);
  }
  function notifyIfChanged(s, disabled) {
    if (!streamOpen(s)) return;
    const fp = toolsFingerprint(s.ident, disabled);
    if (fp === s.fp) return;
    s.fp = fp;
    s.server.sendToolListChanged().catch(e => log.warn(`[mcp] tools/list_changed not delivered: ${e.message}`));
  }

  let notifyTimer = null;
  function toolsChanged() {
    if (notifyTimer || !sessions.size) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      let disabled;
      try { disabled = disabledTools(); } catch (e) { log.error(`[mcp] tools change check failed: ${e.message}`); return; }
      for (const s of [...sessions.values()]) {
        try { notifyIfChanged(s, disabled); } catch (e) { log.error(`[mcp] tools change check failed: ${e.message}`); }
      }
    }, notifyDebounceMs);
    notifyTimer.unref?.();
  }

  // A (re)opened GET stream: once the SDK has answered it, tell the client about anything it missed
  // while no stream was open. Retries while the response is still pending; stops when it closes.
  function watchStream(s, res) {
    s.streams.add(res);
    res.on('close', () => { s.streams.delete(res); s.lastSeen = Date.now(); });
    clearTimeout(s.recheck);
    const check = () => {
      s.recheck = null;
      if (sessions.get(s.id) !== s || res.destroyed || res.writableEnded) return;
      if (!res.headersSent) { s.recheck = setTimeout(check, notifyDebounceMs); s.recheck.unref?.(); return; }
      try { notifyIfChanged(s, disabledTools()); } catch (e) { log.error(`[mcp] tools change check failed: ${e.message}`); }
    };
    s.recheck = setTimeout(check, notifyDebounceMs);
    s.recheck.unref?.();
  }

  function sessionNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
  }

  async function openSession(req, res, body, ident, tokenHash) {
    makeRoom(tokenHash);
    const s = { id: null, ident, tokenHash, lastSeen: Date.now(), streams: new Set(), fp: null, recheck: null };
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
      if (req.method === 'GET') watchStream(s, res);
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
  // Exemptions do have FKs (CASCADE); clearing them here keeps a delete path with foreign_keys off clean too.
  function forgetSubAgent(id) {
    q.deleteAccess.run('sub_agent', id);
    q.deleteExemptionsOfSubAgent.run(id);
    q.revokeSubAgent.run(id);
    expirePending('sub_agent', id);
    closeSessionsWhere(i => i.subAgentId === id);
  }
  // DB writes only, so it can run inside the caller's transaction. A waiter resolved before a rollback
  // would leave a pending row whose agent already got 'expired'; hence the returned step, run after commit.
  function dropActor(id) {
    for (const sa of q.subAgentsOf.all(id)) q.deleteAccess.run('sub_agent', sa.id);
    q.deleteAccess.run('agent', id);
    q.deleteExemptionsOfActor.run(id);
    q.revokeActor.run(id);
    const expired = q.pendingIdsBy.actor.all(id).map(r => r.id).filter(aid => q.settleApproval.run('expired', aid).changes === 1);
    return () => {
      for (const aid of expired) release(aid, 'expired');
      closeSessionsWhere(i => i.actorId === id);
    };
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
    issueToken, authenticate, visibleTools, callTool, handle, forgetSubAgent, dropActor, forgetRoom, allowedServers, pruneCalls,
    decideApproval, listApprovals, listExemptions, deleteExemption, toolsChanged, sessionCount: () => sessions.size, close,
  };
}

module.exports = {
  createMcpGateway, decideAccess, writeHint, argsPreview, capResult, hashToken, approvalView,
  TOKEN_PREFIX, NAME_SEP, BUILTIN_SLUG, APPROVAL_TIMEOUT_MAX_MS,
};
