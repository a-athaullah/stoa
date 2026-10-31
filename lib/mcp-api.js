'use strict';
// Owner-only admin API for the MCP gateway (/api/mcp/*). Session auth only: lib/agent-scope.js does not
// list these routes, so an agent secret is refused before reaching here; the handler checks again.
// addServerForAgent / checkServerForAgent / listServersForAgent serve stoa__mcp_server_add / _list (lib/stoa-mcp-tools.js) on the same
// core; the gateway has the owner approve every add before it reaches here.
// Env / header values are write-only — responses carry key names and a masked tail, never the value.

const { publicCatalog, getPreset, validatePresetValues, presetToolDefaults } = require('./mcp-catalog');
const { validateCommand, validateArgs, validateEnv, validateUrl, decodeServerEnv } = require('./mcp-upstreams');
const { writeHint, BUILTIN_SLUG } = require('./mcp-gateway');
const { OAuthFlowError, CALLBACK_PATH } = require('./mcp-oauth');

const SLUG_RE = /^[a-z][a-z0-9_]{0,31}$/;
const HTTP_AUTH = new Set(['none', 'headers', 'oauth']);
const SUBJECT_TYPES = new Set(['agent', 'sub_agent', 'room']);
const MAX_TOOL_NAME = 200;
// What stoa__mcp_server_update may send. Access (default_access, grants) stays with the owner; slug,
// preset and transport are fixed. Anything else is refused, never dropped.
const AGENT_UPDATE_FIELDS = new Set(['slug', 'name', 'command', 'args', 'url', 'env', 'env_remove', 'keep_alive', 'auth', 'enabled']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function mask(value) {
  const v = String(value ?? '');
  return v.length >= 12 ? '••••' + v.slice(-4) : '••••';
}

const parseArgsJson = (row) => { try { return row.args_json ? JSON.parse(row.args_json) : []; } catch { return []; } };
const isoUtc = (s) => (typeof s === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'denied', 'expired']);

function intParam(params, name) {
  const v = params.get(name);
  if (v == null || v === '') return null;
  if (!/^\d{1,15}$/.test(v)) throw bad(`${name} must be a positive integer`);
  return Number(v);
}

function createMcpApi({ db, upstreams, gateway, oauth, encrypt, decrypt, log = console }) {
  const q = {
    servers: db.prepare('SELECT * FROM mcp_servers ORDER BY id'),
    server: db.prepare('SELECT * FROM mcp_servers WHERE id=?'),
    slugUsed: db.prepare('SELECT 1 FROM mcp_servers WHERE slug=?'),
    overridesOf: db.prepare('SELECT tool, enabled, requires_approval, rate_limit_per_min FROM mcp_tool_overrides WHERE server_id=?'),
    upsertOverride: db.prepare(`INSERT INTO mcp_tool_overrides (server_id, tool, enabled, requires_approval, rate_limit_per_min) VALUES (?,?,?,?,?)
      ON CONFLICT(server_id, tool) DO UPDATE SET enabled=excluded.enabled, requires_approval=excluded.requires_approval,
        rate_limit_per_min=excluded.rate_limit_per_min`),
    deleteOverride: db.prepare('DELETE FROM mcp_tool_overrides WHERE server_id=? AND tool=?'),
    upsertGrant: db.prepare(`INSERT INTO mcp_access (server_id, subject_type, subject_id, allow) VALUES (?,?,?,?)
      ON CONFLICT(server_id, subject_type, subject_id) DO UPDATE SET allow=excluded.allow`),
    deleteGrant: db.prepare('DELETE FROM mcp_access WHERE server_id=? AND subject_type=? AND subject_id=?'),
    grants: db.prepare('SELECT server_id, subject_type, subject_id, allow FROM mcp_access ORDER BY server_id, subject_type, subject_id'),
    agents: db.prepare("SELECT id, name FROM actors WHERE type='ai' ORDER BY name COLLATE NOCASE, id"),
    subAgents: db.prepare('SELECT id, label AS name, parent_actor_id FROM sub_agents ORDER BY parent_actor_id, label COLLATE NOCASE'),
    rooms: db.prepare('SELECT id, title AS name FROM rooms WHERE archived_at IS NULL ORDER BY title COLLATE NOCASE, id'),
    agentExists: db.prepare("SELECT 1 FROM actors WHERE id=? AND type='ai'"),
    subAgentExists: db.prepare('SELECT 1 FROM sub_agents WHERE id=?'),
    roomExists: db.prepare('SELECT 1 FROM rooms WHERE id=?'),
  };

  const readEnv = (row) => decodeServerEnv(row, decrypt, log);

  function overrideMap(serverId) {
    return new Map(q.overridesOf.all(serverId).map(o => [o.tool, o]));
  }

  function serialize(row) {
    const info = upstreams.info(row);
    const ovs = info.tools ? overrideMap(row.id) : null;
    const args = parseArgsJson(row);
    // A preset field marked secret:false (e.g. Filesystem folders) is shown as is; everything else stays masked.
    const plainFields = new Set((getPreset(row.preset)?.env_fields || []).filter(f => f.secret === false).map(f => f.key));
    return {
      id: row.id, slug: row.slug, name: row.name, transport: row.transport,
      command: row.command || null, args, url: row.url || null, preset: row.preset || null, auth: row.auth,
      enabled: !!row.enabled, default_access: row.default_access, keep_alive: !!row.keep_alive,
      status: info.status, last_error: info.last_error,
      tool_count: info.tools ? info.tools.filter(t => (ovs.get(t.name)?.enabled ?? 1) === 1).length : null,
      env_keys: Object.entries(readEnv(row)).map(([key, v]) => (plainFields.has(key) ? { key, masked: mask(v), value: v } : { key, masked: mask(v) })),
      created_at: isoUtc(row.created_at), updated_at: isoUtc(row.updated_at),
    };
  }

  function loadServer(id) {
    const row = q.server.get(id);
    if (!row) throw new HttpError(404, 'MCP server not found');
    return row;
  }

  // A preset with a header template stores field values (env-style names), not header names.
  function cleanEnv(env, transport, preset = null) {
    const err = validateEnv(env, preset?.headers ? 'stdio' : transport);
    if (err) throw bad(err);
    const out = {};
    for (const [k, v] of Object.entries(env || {})) if (v !== '') out[k] = v;
    return out;
  }

  function checkPresetEnv(preset, env) {
    const allowed = new Set(preset.env_fields.map(f => f.key));
    for (const k of Object.keys(env)) if (!allowed.has(k)) throw bad(`env ${k} is not a field of preset ${preset.id}`);
    for (const f of preset.env_fields) if (f.required && !env[f.key]) throw bad(`${f.label} is required`);
    const err = validatePresetValues(preset, env);
    if (err) throw bad(err);
  }

  // Only a stdio server can be kept running: an http server is not a process Stoa runs.
  function parseKeepAlive(v, transport) {
    if (typeof v !== 'boolean') throw bad('keep_alive must be a boolean');
    if (v && transport !== 'stdio') throw bad('keep_alive is only for stdio servers');
    return v ? 1 : 0;
  }

  function parseName(v) {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > 100) throw bad('name must be 1-100 characters');
    return v.trim();
  }

  // → the row to insert; throws HttpError 400. Shared by createServer and the agent precheck.
  function newServerFields(body, { grantAgentId = null } = {}) {
    if (!body || typeof body !== 'object') throw bad('invalid JSON body');
    const preset = body.preset != null ? getPreset(body.preset) : null;
    if (body.preset != null && !preset) throw bad('unknown preset');
    const slug = body.slug ?? preset?.id;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.includes('__')) {
      throw bad('slug must start with a letter, use a-z 0-9 _ (max 32), and not contain "__"');
    }
    if (slug === BUILTIN_SLUG) throw bad(`slug "${BUILTIN_SLUG}" is reserved for Stoa's built-in tools`);
    const name = parseName(body.name ?? preset?.name);
    const transport = preset ? preset.transport : body.transport;
    if (transport !== 'stdio' && transport !== 'http') throw bad('transport must be stdio or http');
    let command = null, args = null, url = null;
    if (preset) {
      if (transport === 'http') url = preset.url;
      else { command = preset.command; args = preset.args; }
    } else if (transport === 'stdio') {
      const cmdErr = validateCommand(body.command) || validateArgs(body.args);
      if (cmdErr) throw bad(cmdErr);
      command = body.command; args = body.args || [];
    } else {
      const urlErr = validateUrl(body.url);
      if (urlErr) throw bad(urlErr);
      url = body.url;
    }
    const env = cleanEnv(body.env, transport, preset);
    if (preset) checkPresetEnv(preset, env);
    if (grantAgentId == null && body.allow_all != null && typeof body.allow_all !== 'boolean') throw bad('allow_all must be a boolean');
    const defaultAccess = grantAgentId == null && body.allow_all ? 'all' : 'none';
    const keepAlive = body.keep_alive != null ? parseKeepAlive(body.keep_alive, transport) : 0;
    let auth = preset?.auth || 'none';
    if (!preset && body.auth != null) {
      if (transport !== 'http' && body.auth !== 'none') throw bad('only http servers take auth');
      if (!HTTP_AUTH.has(body.auth)) throw bad('auth must be none, headers or oauth');
      auth = body.auth;
    } else if (!preset && transport === 'http' && Object.keys(env).length) auth = 'headers';
    return { slug, name, transport, command, args, url, env, preset, defaultAccess, auth, keepAlive };
  }

  // grantAgentId: install for that agent only — default_access none and an allow grant for it, written
  // with the row, so no other agent sees the server for a moment. allow_all is ignored then.
  function createServer(body, opts = {}) {
    const { slug, name, transport, command, args, url, env, preset, defaultAccess, auth, keepAlive } = newServerFields(body, opts);
    const { grantAgentId = null } = opts;
    try {
      // The server row and its preset's starting overrides land together, so an RCE-grade tool is never
      // briefly enabled on a fresh install.
      const id = db.transaction(() => {
        const r = db.prepare(`INSERT INTO mcp_servers (slug, name, transport, command, args_json, url, env_enc, preset, default_access, auth, keep_alive)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(slug, name, transport, command, args ? JSON.stringify(args) : null, url,
          Object.keys(env).length ? encrypt(JSON.stringify(env)) : null, preset?.id || null, defaultAccess, auth, keepAlive);
        for (const d of presetToolDefaults(preset)) q.upsertOverride.run(r.lastInsertRowid, d.tool, d.enabled, d.requires_approval, null);
        if (grantAgentId != null) q.upsertGrant.run(r.lastInsertRowid, 'agent', grantAgentId, 1);
        return r.lastInsertRowid;
      })();
      return q.server.get(id);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new HttpError(409, `slug "${slug}" is already used`);
      throw e;
    }
  }

  // → the changes body asks for, as { name, enabled, default_access, keep_alive, auth, command, args, url, env }
  // values (env: the full merged object), without writing; throws HttpError 400. Shared by patchServer
  // and the agent's update precheck.
  function planPatch(row, body) {
    if (!body || typeof body !== 'object') throw bad('invalid JSON body');
    if (body.slug !== undefined && body.slug !== row.slug) throw bad('slug cannot be changed (it prefixes every tool name)');
    if (body.preset !== undefined && (body.preset || null) !== (row.preset || null)) throw bad('preset cannot be changed');
    const preset = row.preset ? getPreset(row.preset) : null;
    const plan = {};
    if (body.name !== undefined) plan.name = parseName(body.name);
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw bad('enabled must be a boolean');
      plan.enabled = body.enabled ? 1 : 0;
    }
    if (body.default_access !== undefined) {
      if (body.default_access !== 'all' && body.default_access !== 'none') throw bad('default_access must be all or none');
      plan.default_access = body.default_access;
    }
    if (body.keep_alive !== undefined) plan.keep_alive = parseKeepAlive(body.keep_alive, row.transport);
    const touchesCommand = body.command !== undefined || body.args !== undefined || body.url !== undefined;
    if (touchesCommand && row.preset) throw bad('command, args and url of a preset server cannot be changed');
    if (body.transport !== undefined && body.transport !== row.transport) throw bad('transport cannot be changed');
    if (body.auth !== undefined && body.auth !== row.auth) {
      if (row.preset || row.transport !== 'http') throw bad('auth can only be changed on a custom http server');
      if (!HTTP_AUTH.has(body.auth)) throw bad('auth must be none, headers or oauth');
      plan.auth = body.auth;
    }
    if (row.transport === 'stdio' && (body.command !== undefined || body.args !== undefined)) {
      const cmdErr = (body.command !== undefined ? validateCommand(body.command) : null) || validateArgs(body.args);
      if (cmdErr) throw bad(cmdErr);
      if (body.command !== undefined) plan.command = body.command;
      if (body.args !== undefined) plan.args = body.args || [];
    } else if (row.transport === 'http' && body.url !== undefined) {
      const urlErr = validateUrl(body.url);
      if (urlErr) throw bad(urlErr);
      plan.url = body.url;
    } else if (touchesCommand) {
      throw bad(`${row.transport} servers do not take ${row.transport === 'http' ? 'command/args' : 'url'}`);
    }
    if (body.env !== undefined || body.env_remove !== undefined) {
      const incoming = cleanEnv(body.env, row.transport, preset);
      if (body.env_remove !== undefined && (!Array.isArray(body.env_remove) || body.env_remove.some(k => typeof k !== 'string'))) {
        throw bad('env_remove must be an array of names');
      }
      const merged = { ...readEnv(row), ...incoming };
      for (const k of body.env_remove || []) delete merged[k];
      if (preset) checkPresetEnv(preset, merged);
      plan.env = merged;
    }
    return plan;
  }

  function applyPatch(row, plan) {
    const keys = Object.keys(plan);
    if (!keys.length) return row;
    const sets = [];
    const params = [];
    for (const k of keys) {
      if (k === 'args') { sets.push('args_json=?'); params.push(JSON.stringify(plan.args)); }
      else if (k === 'env') { sets.push('env_enc=?'); params.push(Object.keys(plan.env).length ? encrypt(JSON.stringify(plan.env)) : null); }
      else { sets.push(`${k}=?`); params.push(plan[k]); }
    }
    // Switching keep_alive alone does not touch the process: turning it on must not restart a running
    // event source, turning it off only hands it back to the idle timer.
    const keepAliveOnly = keys.length === 1 && keys[0] === 'keep_alive';
    // OAuth registration + tokens belong to one server URL and auth mode; either changing means connecting again.
    if (row.oauth_enc && ((plan.auth !== undefined && plan.auth !== row.auth) || (plan.url !== undefined && plan.url !== row.url))) sets.push('oauth_enc=NULL');
    sets.push("updated_at=datetime('now')");
    db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id=?`).run(...params, row.id);
    const updated = q.server.get(row.id);
    if (!keepAliveOnly) upstreams.reconfigure(row.id, !!updated.enabled);
    upstreams.keepAlive(updated);
    return updated;
  }

  function patchServer(row, body) {
    return applyPatch(row, planPatch(row, body));
  }

  async function testServer(row) {
    if (!row.enabled) return { ok: false, tool_count: 0, tools: [], error: 'server is disabled' };
    upstreams.reconfigure(row.id);
    try {
      const tools = await upstreams.listTools(row, { fresh: true });
      return { ok: true, tool_count: tools.length, tools: tools.map(t => t.name) };
    } catch (e) {
      return { ok: false, tool_count: 0, tools: [], error: String(e.message || e).slice(0, 500) };
    }
  }

  async function listServerTools(row) {
    const tools = await upstreams.listTools(row);
    const ovs = overrideMap(row.id);
    return tools.map(t => {
      const o = ovs.get(t.name);
      return {
        name: t.name, description: t.description || '', enabled: (o?.enabled ?? 1) === 1, requires_approval: (o?.requires_approval ?? 0) === 1,
        rate_limit_per_min: o?.rate_limit_per_min ?? null, write_hint: writeHint(t),
      };
    });
  }

  function putTool(row, tool, body) {
    if (!tool || tool.length > MAX_TOOL_NAME || /[\0-\x1f]/.test(tool)) throw bad('invalid tool name');
    if (!body || typeof body !== 'object') throw bad('invalid JSON body');
    for (const k of ['enabled', 'requires_approval']) {
      if (body[k] !== undefined && typeof body[k] !== 'boolean') throw bad(`${k} must be a boolean`);
    }
    const rl = body.rate_limit_per_min;
    if (rl !== undefined && rl !== null && !(Number.isInteger(rl) && rl >= 1 && rl <= 10000)) throw bad('rate_limit_per_min must be an integer 1-10000 or null');
    const cur = overrideMap(row.id).get(tool);
    const enabled = body.enabled ?? ((cur?.enabled ?? 1) === 1);
    const requiresApproval = body.requires_approval ?? ((cur?.requires_approval ?? 0) === 1);
    const rateLimit = rl !== undefined ? rl : (cur?.rate_limit_per_min ?? null);
    if (enabled && !requiresApproval && rateLimit == null) q.deleteOverride.run(row.id, tool);
    else q.upsertOverride.run(row.id, tool, enabled ? 1 : 0, requiresApproval ? 1 : 0, rateLimit);
    return { name: tool, enabled, requires_approval: requiresApproval, rate_limit_per_min: rateLimit };
  }

  function accessMatrix() {
    return {
      servers: q.servers.all().map(s => ({ id: s.id, slug: s.slug, name: s.name })),
      subjects: [
        ...q.agents.all().map(a => ({ type: 'agent', id: a.id, name: a.name })),
        ...q.subAgents.all().map(s => ({ type: 'sub_agent', id: s.id, name: s.name, parent_agent_id: s.parent_actor_id })),
        ...q.rooms.all().map(r => ({ type: 'room', id: r.id, name: r.name })),
      ],
      grants: q.grants.all().map(g => ({ server_id: g.server_id, subject_type: g.subject_type, subject_id: g.subject_id, allow: g.allow === 1 })),
    };
  }

  function putAccess(body) {
    if (!body || typeof body !== 'object') throw bad('invalid JSON body');
    const serverId = Number(body.server_id);
    const subjectId = Number(body.subject_id);
    if (!Number.isInteger(serverId) || !Number.isInteger(subjectId)) throw bad('server_id and subject_id must be integers');
    if (!SUBJECT_TYPES.has(body.subject_type)) throw bad('subject_type must be agent, sub_agent or room');
    if (body.allow !== null && typeof body.allow !== 'boolean') throw bad('allow must be true, false or null');
    loadServer(serverId);
    const exists = { agent: q.agentExists, sub_agent: q.subAgentExists, room: q.roomExists }[body.subject_type].get(subjectId);
    if (!exists) throw new HttpError(404, `${body.subject_type} not found`);
    if (body.allow === null) q.deleteGrant.run(serverId, body.subject_type, subjectId);
    else q.upsertGrant.run(serverId, body.subject_type, subjectId, body.allow ? 1 : 0);
    return { grant: body.allow === null ? null : { server_id: serverId, subject_type: body.subject_type, subject_id: subjectId, allow: body.allow } };
  }

  function listCalls(params) {
    const where = [];
    const args = [];
    const serverId = intParam(params, 'server_id');
    const actorId = intParam(params, 'actor_id');
    const beforeId = intParam(params, 'before_id');
    const limit = Math.min(200, Math.max(1, intParam(params, 'limit') ?? 50));
    if (serverId != null) { where.push('c.server_id=?'); args.push(serverId); }
    if (actorId != null) { where.push('c.actor_id=?'); args.push(actorId); }
    if (beforeId != null) { where.push('c.id<?'); args.push(beforeId); }
    const rows = db.prepare(`SELECT c.id, c.server_slug, c.tool, c.actor_id, a.name AS actor_name, c.sub_agent_id, sa.label AS sub_agent_label,
        c.room_id, c.thread_id, c.status, c.error, c.duration_ms, c.result_bytes, c.args_preview, c.approval, c.created_at
      FROM mcp_calls c LEFT JOIN actors a ON a.id=c.actor_id LEFT JOIN sub_agents sa ON sa.id=c.sub_agent_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT ?`).all(...args, limit);
    return {
      calls: rows.map(r => ({ ...r, created_at: isoUtc(r.created_at) })),
      next_before_id: rows.length === limit ? rows[rows.length - 1].id : null,
    };
  }

  function listApprovals(params) {
    const status = params.get('status') || null;
    if (status != null && !APPROVAL_STATUSES.has(status)) throw bad('status must be pending, approved, denied or expired');
    return gateway.listApprovals({
      roomId: intParam(params, 'room_id'), threadId: intParam(params, 'thread_id'), status,
      beforeId: intParam(params, 'before_id'), limit: Math.min(200, Math.max(1, intParam(params, 'limit') ?? 50)),
    });
  }

  // POST …/oauth/start. The redirect URI comes from the owner's browser Origin, which requireAuth has
  // already checked (originAllowed) — never from a raw Host header.
  async function oauthStart(req, row) {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/i.test(origin)) throw bad('Origin header required');
    if (!row.enabled) throw bad('server is disabled');
    try { return { authorize_url: await oauth.start(row, origin) }; }
    catch (e) { throw e instanceof OAuthFlowError ? new HttpError(e.status, e.message) : e; }
  }

  // GET /api/mcp/oauth/callback — the provider redirects the owner's browser here.
  async function oauthCallback(res, params) {
    const back = (q) => { res.writeHead(302, { Location: `/?${new URLSearchParams(q)}`, 'Cache-Control': 'no-store' }); res.end(); return true; };
    try {
      const serverId = await oauth.finish({ state: params.get('state'), code: params.get('code'), error: params.get('error') });
      const row = q.server.get(serverId);
      upstreams.reconfigure(serverId, !!row.enabled);
      upstreams.announce(row);
      return back({ mcp_oauth: 'connected', server_id: String(serverId) });
    } catch (e) {
      if (!(e instanceof OAuthFlowError)) throw e;
      log.warn(`[mcp] oauth callback rejected: ${e.message}`);
      // Without a valid state there is no server to send the owner back to.
      if (!e.serverId) throw new HttpError(e.status, e.message);
      return back({ mcp_oauth: 'error', server_id: String(e.serverId), reason: e.message.slice(0, 200) });
    }
  }

  // What an agent may see of every server: enough to pick a free slug and know what it can use. Env is
  // names only (no masked tail, no plain preset value); has_access is the gateway's own access decision.
  function agentView(row, hasAccess) {
    const s = serialize(row);
    return {
      slug: s.slug, name: s.name, transport: s.transport, command: s.command, args: s.args, url: s.url, preset: s.preset,
      enabled: s.enabled, status: s.status, tool_count: s.tool_count, env_keys: s.env_keys.map(e => e.key), has_access: hasAccess,
    };
  }

  function listServersForAgent(ident) {
    const usable = new Set(gateway.allowedServers(ident).map(s => s.id));
    return q.servers.all().map(row => agentView(row, usable.has(row.id)));
  }

  // → why addServerForAgent would refuse body, or null. Run before the owner is asked; the insert checks again.
  function checkServerForAgent(body, actorId) {
    try {
      const { slug } = newServerFields(body, { grantAgentId: actorId });
      return q.slugUsed.get(slug) ? `slug "${slug}" is already used` : null;
    } catch (e) {
      if (e instanceof HttpError) return e.message;
      throw e;
    }
  }

  // → { status, body }. A failed connection test does not undo the install: the server stays, and its
  // test result says what went wrong.
  async function addServerForAgent(body, actorId) {
    let row;
    try { row = createServer(body, { grantAgentId: actorId }); }
    catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      throw e;
    }
    const test = await testServer(row);
    upstreams.keepAlive(row);
    gateway.toolsChanged();
    return { status: 201, body: { server: agentView(row, true), test: { ok: test.ok, tool_count: test.tool_count, ...(test.error ? { error: test.error } : {}) } } };
  }

  const sameEnv = (a, b) => {
    const ka = Object.keys(a).sort();
    return ka.length === Object.keys(b).length && ka.every(k => Object.hasOwn(b, k) && a[k] === b[k]);
  };
  function unchanged(row, key, value) {
    if (key === 'args') return JSON.stringify(value) === JSON.stringify(parseArgsJson(row));
    if (key === 'env') return sameEnv(value, readEnv(row));
    return row[key] === value;
  }

  // → { row, plan } for an agent's update; throws HttpError. Only a server the agent may use (the gateway's
  // own access decision) can be found: any other slug is "not found". Fields that already hold the sent
  // value are left out, so the owner approves real changes only and an empty update is refused.
  function planAgentUpdate(body, ident) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid arguments');
    const extra = Object.keys(body).find(k => !AGENT_UPDATE_FIELDS.has(k));
    if (extra !== undefined) throw bad(`${extra.slice(0, 64)} cannot be changed by an agent`);
    if (typeof body.slug !== 'string' || !body.slug) throw bad('slug is required');
    const row = gateway.allowedServers(ident).find(s => s.slug === body.slug);
    if (!row) throw new HttpError(404, 'MCP server not found');
    const plan = planPatch(row, body);
    for (const k of Object.keys(plan)) if (unchanged(row, k, plan[k])) delete plan[k];
    if (!Object.keys(plan).length) throw bad('nothing to change: every field sent already has that value');
    return { row, plan };
  }

  // → why updateServerForAgent would refuse body, or null. Run before the owner is asked; the update plans again.
  function checkUpdateForAgent(body, ident) {
    try { planAgentUpdate(body, ident); return null; }
    catch (e) {
      if (e instanceof HttpError) return e.message;
      throw e;
    }
  }

  // Approval card of an update: the slug and each change as { from, to }, so the owner sees the command
  // line that will run. Env shows names only (set / removed) — except a preset field marked secret:false,
  // which keeps its value as on the add card. null when the update would be refused (precheck says why).
  function previewUpdateForAgent(body, ident) {
    let r;
    try { r = planAgentUpdate(body, ident); }
    catch (e) {
      if (e instanceof HttpError) return null;
      throw e;
    }
    const { row, plan } = r;
    const bool = (k, v) => (k === 'enabled' || k === 'keep_alive' ? !!v : v);
    const changes = {};
    for (const [k, v] of Object.entries(plan)) {
      if (k === 'env') continue;
      changes[k] = { from: k === 'args' ? parseArgsJson(row) : bool(k, row[k] ?? null), to: bool(k, v) };
    }
    if (plan.env) {
      const old = readEnv(row);
      const plain = new Set((getPreset(row.preset)?.env_fields || []).filter(f => f.secret === false).map(f => f.key));
      const set = Object.keys(plan.env).filter(k => old[k] !== plan.env[k]);
      const removed = Object.keys(old).filter(k => !Object.hasOwn(plan.env, k));
      changes.env = {
        ...(set.length ? { set: Object.fromEntries(set.map(k => [k, plain.has(k) ? plan.env[k] : '***'])) } : {}),
        ...(removed.length ? { removed } : {}),
      };
    }
    return { slug: row.slug, changes };
  }

  // → { status, body }. Applied like a PATCH from Settings (restart / reconnect), then tested; a failed
  // test keeps the change so the owner can see and fix it.
  async function updateServerForAgent(body, ident) {
    let updated;
    try {
      const { row, plan } = planAgentUpdate(body, ident);
      updated = applyPatch(row, plan);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      throw e;
    }
    const test = await testServer(updated);
    gateway.toolsChanged();
    return { status: 200, body: { server: agentView(updated, gateway.allowedServers(ident).some(s => s.id === updated.id)), test: { ok: test.ok, tool_count: test.tool_count, ...(test.error ? { error: test.error } : {}) } } };
  }

  // → true when the request was handled. helpers: { json, readBody, parseJsonBody }.
  async function handle(req, res, url, { json, readBody, parseJsonBody }) {
    const p = url.pathname;
    if (p !== '/api/mcp' && !p.startsWith('/api/mcp/')) return false;
    const reply = (data, status = 200) => { json(res, data, status); return true; };
    if (!req._authUser) return reply({ error: 'human auth required' }, 403);
    // Any write here (servers, tool settings, access, OAuth connect) may change agents' tool lists; the
    // gateway re-checks open sessions and notifies only those whose list changed.
    if (req.method !== 'GET' || p === CALLBACK_PATH) res.once('finish', () => gateway.toolsChanged());
    const body = async () => {
      const raw = await readBody(req, 256 * 1024);
      const data = parseJsonBody(raw || '{}');
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw bad('invalid JSON body');
      return data;
    };
    const m = p.match(/^\/api\/mcp\/servers\/(\d{1,15})(?:\/(test|tools|oauth\/start)(?:\/([^/]+))?)?$/);
    try {
      if (req.method === 'GET' && p === '/api/mcp/catalog') return reply({ presets: publicCatalog() });
      if (p === '/api/mcp/servers') {
        if (req.method === 'GET') return reply({ servers: q.servers.all().map(serialize) });
        if (req.method === 'POST') {
          const row = createServer(await body());
          upstreams.keepAlive(row);
          return reply({ server: serialize(row) }, 201);
        }
      }
      if (m && !m[2]) {
        const row = loadServer(Number(m[1]));
        if (req.method === 'PATCH') return reply({ server: serialize(patchServer(row, await body())) });
        if (req.method === 'DELETE') {
          upstreams.remove(row.id);
          db.prepare('DELETE FROM mcp_servers WHERE id=?').run(row.id);
          res.writeHead(204); res.end(); return true;
        }
      }
      if (m && m[2] === 'test' && !m[3] && req.method === 'POST') return reply(await testServer(loadServer(Number(m[1]))));
      if (m && m[2] === 'oauth/start' && !m[3] && req.method === 'POST') return reply(await oauthStart(req, loadServer(Number(m[1]))));
      if (req.method === 'GET' && p === CALLBACK_PATH) return await oauthCallback(res, url.searchParams);
      if (m && m[2] === 'tools') {
        const row = loadServer(Number(m[1]));
        if (!m[3] && req.method === 'GET') {
          try { return reply({ tools: await listServerTools(row) }); }
          catch (e) { return reply({ tools: [], error: String(e.message || e).slice(0, 500) }, 502); }
        }
        if (m[3] && req.method === 'PUT') {
          let tool;
          try { tool = decodeURIComponent(m[3]); } catch { throw bad('invalid tool name'); }
          return reply({ tool: putTool(row, tool, await body()) });
        }
      }
      if (p === '/api/mcp/access') {
        if (req.method === 'GET') return reply(accessMatrix());
        if (req.method === 'PUT') return reply(putAccess(await body()));
      }
      if (req.method === 'GET' && p === '/api/mcp/calls') return reply(listCalls(url.searchParams));
      if (req.method === 'GET' && p === '/api/mcp/approvals') return reply(listApprovals(url.searchParams));
      const ap = p.match(/^\/api\/mcp\/approvals\/(\d{1,15})$/);
      if (ap && req.method === 'POST') {
        const r = gateway.decideApproval(Number(ap[1]), (await body()).decision);
        if (r.status === 200) return reply(r.exemption ? { approval: r.approval, exemption: r.exemption } : { approval: r.approval });
        return reply({ error: r.error, ...(r.approval ? { approval: r.approval } : {}) }, r.status);
      }
      if (req.method === 'GET' && p === '/api/mcp/approval-exemptions') {
        return reply(gateway.listExemptions({ serverId: intParam(url.searchParams, 'server_id') }));
      }
      const ex = p.match(/^\/api\/mcp\/approval-exemptions\/(\d{1,15})$/);
      if (ex && req.method === 'DELETE') {
        return gateway.deleteExemption(Number(ex[1])) ? reply({ ok: true }) : reply({ error: 'exemption not found' }, 404);
      }
      return reply({ error: 'not found' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status);
      if (/too large/i.test(e.message || '')) return reply({ error: 'request body too large' }, 413);
      throw e;
    }
  }

  return { handle, serialize, listServersForAgent, checkServerForAgent, addServerForAgent, checkUpdateForAgent, previewUpdateForAgent, updateServerForAgent };
}

module.exports = { createMcpApi, mask };
