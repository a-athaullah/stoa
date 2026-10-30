'use strict';
// Agent side of Harness Accounts & Limits (server: lib/harness-accounts.js). Reads which Claude / Codex
// account this machine is logged into and how much of the plan limits is used, without calling a model.
//
// Tokens: read here for one request to the provider's own usage endpoint, never returned, logged or
// written anywhere. Expired Claude tokens are NOT refreshed: refresh tokens rotate, and a refresh from
// here would invalidate the one the CLI holds (the CLI login breaks). Codex goes through
// `codex app-server`, which owns its token refresh; the direct HTTP fallback only reads.
//
// Every dependency (commands, HTTP, keychain, files, clock) is injectable so the parsing and the
// decisions are testable without the CLIs installed.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const ALLOWED_HOSTS = new Set(['api.anthropic.com', 'chatgpt.com']);
const VERSION_TIMEOUT_MS = 5_000;
const CMD_TIMEOUT_MS = 10_000;
const HTTP_TIMEOUT_MS = 10_000;
const APP_SERVER_TIMEOUT_MS = 12_000;
// The server waits 20 s for an answer to a refresh; one harness hanging must not cost the other.
const HARNESS_CAP_MS = 18_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const EXPIRY_MARGIN_MS = 60_000;

function claudeConfigDir(env) {
  return (env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).normalize('NFC');
}

function codexHome(env) {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function osUser(env) {
  try { return env.USER || os.userInfo().username; } catch { return env.USERNAME || ''; }
}

// Agents of one machine + OS user + harness config dirs share a login, so they share this id.
// Only the hash leaves the machine, never the paths.
function machineIdentity(env = process.env) {
  const hostname = os.hostname();
  const id = crypto.createHash('sha256')
    .update([hostname, osUser(env), claudeConfigDir(env), codexHome(env)].join('|'))
    .digest('hex').slice(0, 16);
  return { id, hostname, platform: process.platform };
}

// Mirrors Claude Code's own naming: a CLAUDE_CONFIG_DIR login lives under a service suffixed with the
// dir's hash, so the default entry (another login) is never read in its place.
function claudeKeychainService(env) {
  const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const plain = storageDir !== undefined ? !storageDir : !env.CLAUDE_CONFIG_DIR;
  const dir = storageDir !== undefined ? storageDir.normalize('NFC') : claudeConfigDir(env);
  const suffix = plain ? '' : `-${crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8)}`;
  return `Claude Code-credentials${suffix}`;
}

function claudeKeychainAccount(env) {
  const user = osUser(env);
  return /^[a-zA-Z0-9._-]+$/.test(user) ? user : 'claude-code-user';
}

function parseVersion(stdout) {
  const m = String(stdout || '').match(/\d+\.\d+\.\d+[\w.+-]*/);
  return m ? m[0].slice(0, 64) : null;
}

function toIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

function titleCase(s) {
  return String(s).split(/[_\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function limitKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48);
}

function windowLabel(mins) {
  if (mins === 300) return '5-hour session';
  if (mins === 10080) return 'Weekly';
  if (mins % 1440 === 0) return `${mins / 1440}-day window`;
  if (mins % 60 === 0) return `${mins / 60}-hour window`;
  return `${mins}-minute window`;
}

function windowKey(mins, fallback) {
  if (mins === 300) return 'five_hour';
  if (mins === 10080) return 'seven_day';
  return Number.isInteger(mins) && mins > 0 ? `window_${mins}` : fallback;
}

const LIMIT_ORDER = (k) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2);

// oauth/usage: every top-level object with a numeric utilization is a window (five_hour, seven_day,
// seven_day_<model>, …); an unknown shape yields no limits rather than a guess.
function parseClaudeUsage(body) {
  const limits = [];
  let credits = null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { limits, credits };
  for (const [k, v] of Object.entries(body)) {
    if (!v || typeof v !== 'object') continue;
    if (k === 'extra_usage') {
      credits = { enabled: v.is_enabled === true, balance: null };
      continue;
    }
    if (typeof v.utilization !== 'number' || !Number.isFinite(v.utilization)) continue;
    const key = limitKey(k);
    let label = titleCase(k);
    let window = null;
    if (key === 'five_hour') { label = '5-hour session'; window = 300; }
    else if (key === 'seven_day') { label = 'Weekly'; window = 10080; }
    else if (key.startsWith('seven_day_')) { label = `Weekly · ${titleCase(key.slice(10))}`; window = 10080; }
    limits.push({ key, label, used_pct: v.utilization, resets_at: toIso(v.resets_at), window_mins: window });
  }
  limits.sort((a, b) => LIMIT_ORDER(a.key) - LIMIT_ORDER(b.key));
  return { limits, credits };
}

function codexWindow(w, fallbackKey, prefix, suffixLabel) {
  if (!w || typeof w !== 'object' || typeof w.usedPercent !== 'number') return null;
  const mins = Number.isInteger(w.windowDurationMins) ? w.windowDurationMins : null;
  const base = windowKey(mins, fallbackKey);
  return {
    key: prefix ? limitKey(`${prefix}_${base}`) : base,
    label: (mins ? windowLabel(mins) : titleCase(fallbackKey)) + (suffixLabel ? ` · ${suffixLabel}` : ''),
    used_pct: w.usedPercent,
    resets_at: toIso(w.resetsAt),
    window_mins: mins,
  };
}

// account/rateLimits/read: the main bucket (rateLimits) plus any other metered bucket by limit id.
function parseCodexRateLimits(result) {
  const limits = [];
  let credits = null;
  if (!result || typeof result !== 'object') return { limits, credits };
  const main = result.rateLimits && typeof result.rateLimits === 'object' ? result.rateLimits : null;
  const push = (snap, prefix, suffixLabel) => {
    for (const [w, fb] of [[snap.primary, 'primary'], [snap.secondary, 'secondary']]) {
      const l = codexWindow(w, fb, prefix, suffixLabel);
      if (l && !limits.some(x => x.key === l.key)) limits.push(l);
    }
  };
  if (main) {
    push(main, null, null);
    const c = main.credits;
    if (c && typeof c === 'object') credits = { enabled: c.hasCredits === true || c.unlimited === true, balance: c.unlimited ? 'unlimited' : (c.balance ?? null) };
  }
  const byId = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object' ? result.rateLimitsByLimitId : {};
  for (const [id, snap] of Object.entries(byId)) {
    if (!snap || typeof snap !== 'object' || id === (main?.limitId || 'codex')) continue;
    push(snap, id, snap.limitName || titleCase(id));
  }
  limits.sort((a, b) => LIMIT_ORDER(a.key) - LIMIT_ORDER(b.key));
  return { limits, credits };
}

// wham/usage (fallback): snake_case, windows in seconds, reset as epoch seconds.
function parseWhamUsage(body) {
  const limits = [];
  if (!body || typeof body !== 'object') return { limits, credits: null, email: null, plan: null };
  const rl = body.rate_limit && typeof body.rate_limit === 'object' ? body.rate_limit : {};
  for (const [w, fb] of [[rl.primary_window, 'primary'], [rl.secondary_window, 'secondary']]) {
    if (!w || typeof w !== 'object' || typeof w.used_percent !== 'number') continue;
    const mins = Number.isFinite(w.limit_window_seconds) ? Math.round(w.limit_window_seconds / 60) : null;
    const reset = Number.isFinite(w.reset_at) ? w.reset_at
      : Number.isFinite(w.reset_after_seconds) ? Date.now() / 1000 + w.reset_after_seconds : null;
    limits.push({ key: windowKey(mins, fb), label: mins ? windowLabel(mins) : titleCase(fb), used_pct: w.used_percent, resets_at: toIso(reset), window_mins: mins });
  }
  limits.sort((a, b) => LIMIT_ORDER(a.key) - LIMIT_ORDER(b.key));
  const c = body.credits && typeof body.credits === 'object' ? body.credits : null;
  return {
    limits,
    credits: c ? { enabled: c.has_credits === true || c.unlimited === true, balance: c.unlimited ? 'unlimited' : (c.balance ?? null) } : null,
    email: typeof body.email === 'string' ? body.email : null,
    plan: typeof body.plan_type === 'string' ? body.plan_type : null,
  };
}

function entry(fields) {
  return { installed: true, version: null, logged_in: null, account: null, limits_status: 'unavailable', limits: [], credits: null, error: null, retry_at: null, ...fields };
}

// The usage endpoints answer 429 with a Retry-After of up to an hour. The server remembers it and
// passes it back (skip_limits) so no probe calls the endpoint again before then.
function rateLimited(base, provider, retryAt) {
  return entry({ ...base, limits_status: 'error', error: `Rate limited by ${provider}; next check after the wait`, retry_at: retryAt });
}

function retryAtFrom(d, res) {
  return new Date(d.now() + Math.min(res.retryAfter || 900, 86400) * 1000).toISOString();
}

// ── Default I/O ────────────────────────────────────────────────────────────────────────────────

function run(cmd, args, timeout, env) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    try {
      const child = execFile(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: MAX_RESPONSE_BYTES, env }, (err, stdout) => {
        resolve({ code: err ? (err.code === 'ENOENT' ? -1 : err.killed ? -2 : typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '' });
      });
      child.on('error', () => resolve({ code: -1, stdout: '' }));
    } catch {
      resolve({ code: -1, stdout: '' });
    }
  });
}

// → { status, body, retryAfter } (body parsed JSON or null, retryAfter seconds or null); status 0 =
// network failure / timeout.
function httpGetJson(url, headers, timeout = HTTP_TIMEOUT_MS) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return Promise.resolve({ status: 0, body: null });
  const https = require('https');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = https.get(u, { headers: { Accept: 'application/json', 'User-Agent': 'stoa-agent', ...headers }, timeout }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(); finish({ status: 0, body: null }); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        const ra = parseInt(res.headers['retry-after'], 10);
        finish({ status: res.statusCode, body, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null });
      });
      res.on('error', () => finish({ status: 0, body: null }));
    });
    req.on('timeout', () => { req.destroy(); finish({ status: 0, body: null }); });
    req.on('error', () => finish({ status: 0, body: null }));
  });
}

async function readKeychain(service, account) {
  const args = ['find-generic-password', '-s', service, ...(account ? ['-a', account] : []), '-w'];
  const r = await run('security', args, VERSION_TIMEOUT_MS, process.env);
  return r.code === 0 ? r.stdout.trim() : null;
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// One JSON-RPC session: initialize, account/read, account/rateLimits/read, then exit.
// → { account: result|null, rateLimits: result|null } or null when the app-server is unusable.
function codexAppServer(env, timeout = APP_SERVER_TIMEOUT_MS) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn('codex', ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch { resolve(null); return; }
    const results = {};
    let buf = '';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(results[2] || results[3] ? { account: results[2] ?? null, rateLimits: results[3] ?? null } : null), timeout);
    proc.on('error', () => finish(null));
    proc.on('exit', () => finish(results[2] || results[3] ? { account: results[2] ?? null, rateLimits: results[3] ?? null } : null));
    proc.stdout.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_RESPONSE_BYTES) { finish(null); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          if (m.error) { finish(null); return; }
          write({ method: 'initialized' });
          write({ id: 2, method: 'account/read', params: { refreshToken: false } });
          write({ id: 3, method: 'account/rateLimits/read' });
        } else if (m.id === 2 || m.id === 3) {
          results[m.id] = m.error ? { error: true } : (m.result ?? null);
          if (2 in results && 3 in results) finish({ account: results[2], rateLimits: results[3] });
        }
      }
    });
    const write = (o) => { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    write({ id: 1, method: 'initialize', params: { clientInfo: { name: 'stoa', title: 'Stoa', version: '1' } } });
  });
}

function defaultDeps(env) {
  return {
    env,
    platform: process.platform,
    now: () => Date.now(),
    run: (cmd, args, timeout) => run(cmd, args, timeout, env),
    httpGetJson,
    readKeychain,
    readFile,
    codexAppServer: () => codexAppServer(env),
  };
}

// ── Claude ─────────────────────────────────────────────────────────────────────────────────────

async function readClaudeOauth(d) {
  const candidates = [];
  if (d.platform === 'darwin') {
    const service = claudeKeychainService(d.env);
    for (const account of [claudeKeychainAccount(d.env), null]) candidates.push(await d.readKeychain(service, account));
  }
  candidates.push(d.readFile(path.join(claudeConfigDir(d.env), '.credentials.json')));
  for (const raw of candidates) {
    if (!raw) continue;
    let o;
    try { o = JSON.parse(raw).claudeAiOauth; } catch { continue; }
    if (o && typeof o.accessToken === 'string' && o.accessToken) return { accessToken: o.accessToken, expiresAt: Number(o.expiresAt) || null };
  }
  return null;
}

async function probeClaude(d) {
  const ver = await d.run('claude', ['--version'], VERSION_TIMEOUT_MS);
  if (ver.code === -1) return null;
  if (ver.code !== 0) return entry({ installed: false, error: 'claude --version failed' });
  const version = parseVersion(ver.stdout);
  const auth = await d.run('claude', ['auth', 'status'], CMD_TIMEOUT_MS);
  let st;
  try { st = JSON.parse(auth.stdout); } catch { return entry({ version, limits_status: 'error', error: 'Could not read claude auth status' }); }
  if (st.loggedIn !== true) return entry({ version, logged_in: st.loggedIn === false ? false : null, limits_status: 'not_applicable' });
  const account = { email: st.email ?? null, org_name: st.orgName ?? null, plan: st.subscriptionType ?? null, auth_method: st.authMethod ?? null };
  const base = { version, logged_in: true, account };
  if (st.authMethod !== 'claude.ai' || (st.apiProvider && st.apiProvider !== 'firstParty')) return entry({ ...base, limits_status: 'not_applicable' });
  if (d.skipLimits?.claude) return rateLimited(base, 'Anthropic', d.skipLimits.claude);
  const creds = await readClaudeOauth(d);
  if (!creds) return entry({ ...base, limits_status: 'unavailable', error: 'Login token not found on this machine' });
  if (creds.expiresAt && creds.expiresAt <= d.now() + EXPIRY_MARGIN_MS) return entry({ ...base, limits_status: 'token_expired' });
  const res = await d.httpGetJson(CLAUDE_USAGE_URL, { Authorization: `Bearer ${creds.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' });
  if (res.status === 401 || res.status === 403) return entry({ ...base, limits_status: 'token_expired' });
  if (res.status === 429) return rateLimited(base, 'Anthropic', retryAtFrom(d, res));
  if (res.status !== 200) return entry({ ...base, limits_status: 'error', error: res.status ? `Usage endpoint returned HTTP ${res.status}` : 'Usage endpoint unreachable' });
  const { limits, credits } = parseClaudeUsage(res.body);
  if (!limits.length) return entry({ ...base, credits, limits_status: 'unavailable', error: 'Unrecognized usage response' });
  return entry({ ...base, limits_status: 'ok', limits, credits });
}

// ── Codex ──────────────────────────────────────────────────────────────────────────────────────

async function codexViaHttp(d, base) {
  let auth;
  try { auth = JSON.parse(d.readFile(path.join(codexHome(d.env), 'auth.json')) || ''); } catch { auth = null; }
  const t = auth?.tokens;
  if (!t?.access_token) {
    if (auth?.OPENAI_API_KEY) return entry({ ...base, account: { email: null, org_name: null, plan: null, auth_method: 'api_key' }, limits_status: 'not_applicable' });
    return entry({ ...base, limits_status: 'unavailable', error: 'Login token not found on this machine' });
  }
  if (d.skipLimits?.codex) return rateLimited(base, 'OpenAI', d.skipLimits.codex);
  const headers = { Authorization: `Bearer ${t.access_token}`, ...(t.account_id ? { 'ChatGPT-Account-Id': t.account_id } : {}) };
  const res = await d.httpGetJson(CODEX_USAGE_URL, headers);
  if (res.status === 401 || res.status === 403) return entry({ ...base, limits_status: 'token_expired' });
  if (res.status === 429) return rateLimited(base, 'OpenAI', retryAtFrom(d, res));
  if (res.status !== 200) return entry({ ...base, limits_status: 'error', error: res.status ? `Usage endpoint returned HTTP ${res.status}` : 'Usage endpoint unreachable' });
  const w = parseWhamUsage(res.body);
  const account = { email: w.email, org_name: null, plan: w.plan, auth_method: 'chatgpt' };
  if (!w.limits.length) return entry({ ...base, account, credits: w.credits, limits_status: 'unavailable', error: 'Unrecognized usage response' });
  return entry({ ...base, account, credits: w.credits, limits_status: 'ok', limits: w.limits });
}

async function probeCodex(d) {
  const ver = await d.run('codex', ['--version'], VERSION_TIMEOUT_MS);
  if (ver.code === -1) return null;
  if (ver.code !== 0) return entry({ installed: false, error: 'codex --version failed' });
  const version = parseVersion(ver.stdout);
  const login = await d.run('codex', ['login', 'status'], CMD_TIMEOUT_MS);
  if (login.code === 1) return entry({ version, logged_in: false, limits_status: 'not_applicable' });
  const base = { version, logged_in: login.code === 0 ? true : null };
  const rpc = await d.codexAppServer();
  const acct = rpc?.account && !rpc.account.error ? rpc.account : null;
  if (!acct) return codexViaHttp(d, base);
  const a = acct.account;
  if (!a) return entry({ version, logged_in: false, limits_status: 'not_applicable' });
  if (a.type !== 'chatgpt') {
    return entry({ ...base, logged_in: true, account: { email: null, org_name: null, plan: null, auth_method: a.type === 'apiKey' ? 'api_key' : String(a.type || 'unknown') }, limits_status: 'not_applicable' });
  }
  const account = { email: a.email ?? null, org_name: null, plan: a.planType ?? null, auth_method: 'chatgpt' };
  const withAccount = { ...base, logged_in: true, account };
  if (!rpc.rateLimits || rpc.rateLimits.error) {
    const viaHttp = await codexViaHttp(d, withAccount);
    return viaHttp.account?.email ? viaHttp : { ...viaHttp, account };
  }
  const { limits, credits } = parseCodexRateLimits(rpc.rateLimits);
  if (!limits.length) return entry({ ...withAccount, credits, limits_status: 'unavailable', error: 'Unrecognized usage response' });
  return entry({ ...withAccount, limits_status: 'ok', limits, credits });
}

// ── Entry point ────────────────────────────────────────────────────────────────────────────────

function capped(promise, ms) {
  let timer;
  return Promise.race([
    promise.catch(() => entry({ limits_status: 'error', error: 'Probe failed' })),
    new Promise(resolve => { timer = setTimeout(() => resolve(entry({ limits_status: 'error', error: 'Probe timed out' })), ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}

// → the harness_accounts payload (without type / request_id).
async function probeHarnessAccounts(overrides = {}) {
  const env = overrides.env || process.env;
  const d = { ...defaultDeps(env), ...overrides };
  const [claude, codex] = await Promise.all([capped(probeClaude(d), HARNESS_CAP_MS), capped(probeCodex(d), HARNESS_CAP_MS)]);
  return { machine: machineIdentity(env), probed_at: new Date(d.now()).toISOString(), harnesses: { claude, codex } };
}

module.exports = {
  probeHarnessAccounts, probeClaude, probeCodex, machineIdentity, claudeKeychainService,
  parseClaudeUsage, parseCodexRateLimits, parseWhamUsage, parseVersion,
};
