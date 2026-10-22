'use strict';
// Upstream MCP servers run by the Stoa server: lazy start, idle stop, restart backoff, tool cache.
// One MCP Client per server row. Callers pass the current DB row each time, so a config change only
// needs reconfigure(id) to drop the running process; the next use starts it with the new config.

const fs = require('fs');
const path = require('path');

const STATUS = Object.freeze({ RUNNING: 'running', IDLE: 'idle', ERROR: 'error', DISABLED: 'disabled' });
const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'docker']);
// The upstream env is minimal; these keys are never taken from a server's own env because they would
// change which binary runs (PATH) or inject code into it (loader / runtime hooks).
const RESERVED_ENV_RE = /^(PATH|HOME|NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|PYTHONPATH|PYTHONSTARTUP|BASH_ENV|ENV)$/i;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_KEY_RE = /^[A-Za-z0-9-]{1,128}$/;
const MAX_ENV_VALUE = 8192;
const MAX_ARGS = 64;
const MAX_ARG_LEN = 2048;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

// → null when valid, else an error string. Absolute paths must point to an executable file.
function validateCommand(command, { stat = fs.statSync, access = fs.accessSync } = {}) {
  if (typeof command !== 'string' || !command || command.length > 1024 || command.includes('\0')) return 'command is required';
  if (ALLOWED_COMMANDS.has(command)) return null;
  if (!path.isAbsolute(command)) return `command must be one of ${[...ALLOWED_COMMANDS].join(', ')} or an absolute path`;
  try {
    if (!stat(command).isFile()) return 'command is not a file';
    access(command, fs.constants.X_OK);
  } catch { return 'command not found or not executable'; }
  return null;
}

function validateArgs(args) {
  if (args == null) return null;
  if (!Array.isArray(args) || args.length > MAX_ARGS) return `args must be an array of at most ${MAX_ARGS} strings`;
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG_LEN || a.includes('\0')) return `each arg must be a string of at most ${MAX_ARG_LEN} chars`;
  }
  return null;
}

// transport 'stdio' → env vars, 'http' → request headers.
function validateEnv(env, transport) {
  if (env == null) return null;
  if (typeof env !== 'object' || Array.isArray(env)) return 'env must be an object';
  for (const [k, v] of Object.entries(env)) {
    if (transport === 'http' ? !HEADER_KEY_RE.test(k) : !ENV_KEY_RE.test(k)) return `invalid ${transport === 'http' ? 'header' : 'env'} name: ${String(k).slice(0, 64)}`;
    if (transport !== 'http' && RESERVED_ENV_RE.test(k)) return `env ${k} is reserved`;
    if (typeof v !== 'string' || v.length > MAX_ENV_VALUE || /[\0\r\n]/.test(v)) return `value of ${k} must be a single-line string of at most ${MAX_ENV_VALUE} chars`;
  }
  return null;
}

function validateUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return 'url is required';
  let u;
  try { u = new URL(url); } catch { return 'url is invalid'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'url must be http(s)';
  if (u.username || u.password) return 'put credentials in headers, not in the url';
  return null;
}

// mcp_servers.env_enc → plain object. An unreadable blob (credentials key changed) yields {} and a log
// line, so the upstream starts without its secrets and reports its own auth error.
function decodeServerEnv(row, decrypt, log = console) {
  if (!row?.env_enc) return {};
  try {
    const v = JSON.parse(decrypt(row.env_enc));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { log.error(`[mcp:${row.slug}] stored env unreadable: ${e.message}`); return {}; }
}

function baseEnv(src = process.env) {
  const out = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG']) if (src[k]) out[k] = src[k];
  return out;
}

function createUpstreamManager({
  readEnv,                         // (row) → plain object (decrypted env / headers)
  onStatus = () => {},             // (serverId, status, lastError) on every change
  log = console,
  idleMs = 10 * 60_000,
  maxRunning = 16,
  startTimeoutMs = 120_000,       // npx / docker may download on first start
  sdk = null,
} = {}) {
  const S = sdk || {
    Client: require('@modelcontextprotocol/sdk/client/index.js').Client,
    StdioClientTransport: require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport,
    StreamableHTTPClientTransport: require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport,
    ToolListChangedNotificationSchema: require('@modelcontextprotocol/sdk/types.js').ToolListChangedNotificationSchema,
  };
  // id → { client, starting, tools, lastUsed, idleTimer, status, lastError, failures, retryAt, generation }
  const entries = new Map();

  function entry(id) {
    let e = entries.get(id);
    if (!e) {
      e = { client: null, starting: null, tools: null, lastUsed: 0, idleTimer: null, status: STATUS.IDLE, lastError: null, failures: 0, retryAt: 0, generation: 0 };
      entries.set(id, e);
    }
    return e;
  }

  function setStatus(id, e, status, lastError = null) {
    if (e.status === status && e.lastError === lastError) return;
    e.status = status;
    e.lastError = lastError;
    try { onStatus(id, status, lastError); } catch (err) { log.error(`[mcp] status listener failed: ${err.message}`); }
  }

  function armIdle(id, e) {
    clearTimeout(e.idleTimer);
    e.idleTimer = setTimeout(() => {
      if (Date.now() - e.lastUsed >= idleMs) stop(id, STATUS.IDLE);
      else armIdle(id, e);
    }, idleMs);
    e.idleTimer.unref?.();
  }

  function evictIfFull(exceptId) {
    const running = [...entries.entries()].filter(([id, e]) => id !== exceptId && e.client);
    if (running.length < maxRunning) return;
    running.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    stop(running[0][0], STATUS.IDLE);
  }

  function makeTransport(row, env) {
    if (row.transport === 'http') {
      return new S.StreamableHTTPClientTransport(new URL(row.url), { requestInit: { headers: env } });
    }
    let args = [];
    try { args = row.args_json ? JSON.parse(row.args_json) : []; } catch { throw new Error('stored args are corrupt'); }
    const t = new S.StdioClientTransport({ command: row.command, args, env: { ...baseEnv(), ...env }, stderr: 'pipe' });
    const tag = `[mcp:${row.slug}]`;
    let buf = '';
    t.stderr?.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop().slice(-4096);
      for (const line of lines) if (line.trim()) log.warn(`${tag} ${line.slice(0, 1000)}`);
    });
    return t;
  }

  async function start(row, e) {
    const generation = ++e.generation;
    const commandErr = row.transport === 'stdio' ? validateCommand(row.command) : validateUrl(row.url);
    if (commandErr) throw new Error(commandErr);
    evictIfFull(row.id);
    const client = new S.Client({ name: 'stoa-gateway', version: '1.0.0' });
    const transport = makeTransport(row, readEnv(row) || {});
    let timer;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`start timed out after ${Math.round(startTimeoutMs / 1000)}s`)), startTimeoutMs); }),
      ]);
      const { tools } = await client.listTools(undefined, { timeout: 30_000 });
      if (generation !== e.generation) { await client.close().catch(() => {}); throw new Error('reconfigured while starting'); }
      e.tools = tools || [];
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    } finally { clearTimeout(timer); }
    client.onclose = () => {
      if (e.client !== client) return;
      e.client = null;
      clearTimeout(e.idleTimer);
      // An exit we did not ask for: count it toward the backoff so a crash loop is not hammered.
      e.failures++;
      e.retryAt = Date.now() + backoffMs(e.failures);
      setStatus(row.id, e, STATUS.ERROR, 'upstream exited');
      log.warn(`[mcp:${row.slug}] upstream exited`);
    };
    client.setNotificationHandler(S.ToolListChangedNotificationSchema, async () => {
      try { e.tools = (await client.listTools(undefined, { timeout: 30_000 })).tools || []; }
      catch (err) { log.warn(`[mcp:${row.slug}] tools refresh failed: ${err.message}`); }
    });
    e.client = client;
    e.failures = 0;
    e.retryAt = 0;
    setStatus(row.id, e, STATUS.RUNNING);
    return client;
  }

  function backoffMs(failures) {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  }

  // → connected Client. Throws when the server is disabled, backing off, or fails to start.
  async function ensure(row, { force = false } = {}) {
    const e = entry(row.id);
    if (!row.enabled) { setStatus(row.id, e, STATUS.DISABLED); throw new Error('server is disabled'); }
    e.lastUsed = Date.now();
    if (e.client) { armIdle(row.id, e); return e.client; }
    if (!e.starting) {
      if (!force && e.retryAt > Date.now()) {
        throw new Error(`upstream failed recently (${e.lastError || 'error'}); retrying in ${Math.ceil((e.retryAt - Date.now()) / 1000)}s`);
      }
      e.starting = start(row, e).catch((err) => {
        e.failures++;
        e.retryAt = Date.now() + backoffMs(e.failures);
        const msg = String(err?.message || err).slice(0, 500);
        setStatus(row.id, e, STATUS.ERROR, msg);
        log.warn(`[mcp:${row.slug}] start failed: ${msg}`);
        throw new Error(msg);
      }).finally(() => { e.starting = null; });
    }
    const client = await e.starting;
    armIdle(row.id, e);
    return client;
  }

  // The last known list survives an idle stop, so tools/list from every new agent session does not
  // spawn every upstream; it is dropped only by reconfigure(). fresh=true always asks the upstream.
  async function listTools(row, { fresh = false } = {}) {
    const e = entry(row.id);
    if (!fresh && e.tools && row.enabled) return e.tools;
    await ensure(row, { force: fresh });
    return e.tools || [];
  }

  async function callTool(row, name, args, { timeoutMs = 60_000 } = {}) {
    const client = await ensure(row);
    try {
      return await client.callTool({ name, arguments: args || {} }, undefined, { timeout: timeoutMs });
    } finally {
      entry(row.id).lastUsed = Date.now();
    }
  }

  function stop(id, status = STATUS.IDLE) {
    const e = entries.get(id);
    if (!e) return;
    clearTimeout(e.idleTimer);
    e.generation++;
    const client = e.client;
    e.client = null;
    if (client) { client.onclose = null; client.close().catch(() => {}); }
    setStatus(id, e, status);
  }

  // Config changed: drop the process and the backoff so the next use starts fresh.
  function reconfigure(id, enabled = true) {
    const e = entries.get(id);
    if (e) { e.failures = 0; e.retryAt = 0; e.tools = null; }
    stop(id, enabled ? STATUS.IDLE : STATUS.DISABLED);
  }

  function remove(id) {
    stop(id);
    entries.delete(id);
  }

  // → { status, last_error, tool_count|null } for the servers API. tool_count is null until the
  // upstream has been started once in this server process.
  function info(row) {
    const e = entries.get(row.id);
    if (!row.enabled) return { status: STATUS.DISABLED, last_error: null, tools: e?.tools || null };
    if (!e) return { status: STATUS.IDLE, last_error: null, tools: null };
    return { status: e.status === STATUS.DISABLED ? STATUS.IDLE : e.status, last_error: e.lastError, tools: e.tools };
  }

  function stopAll() { for (const id of [...entries.keys()]) stop(id); }

  return { ensure, listTools, callTool, stop, reconfigure, remove, info, stopAll };
}

module.exports = { createUpstreamManager, decodeServerEnv, validateCommand, validateArgs, validateEnv, validateUrl, baseEnv, STATUS, ALLOWED_COMMANDS };
