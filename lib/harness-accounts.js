'use strict';
// Harness accounts & limits: which Claude / Codex account each agent machine is logged into and how
// much of its plan limits is used. The probe runs in stoa.js (lib/harness-probe.js) because logins live
// on the agent's machine; this module validates what agents report, stores the last snapshot per
// machine and decides when to ask for a new one.
//
// Probes are coordinated here instead of each agent polling on its own timer: one online agent per
// machine is asked, at most once per PROBE_PERIOD_MS (on connect and from a periodic tick) and at most
// once per REFRESH_THROTTLE_MS on a manual refresh.
//
// Claude plan limits arrive separately (harness_rate_limits): every agent session turn carries Claude
// Code's rate_limit_event, which stoa.js forwards throttled. They stay on the card until a newer event
// (or a ping) replaces them; a probe only re-reads the account. Only a manual refresh of a machine with
// no event for PING_AFTER_MS asks the agent to ping (one haiku turn) for them.
//
// Everything from an agent is untrusted: unknown keys are dropped (a token field never reaches the DB or
// a browser), strings are stripped of control / bidi characters and capped, numbers clamped.

const crypto = require('crypto');

const MACHINE_ID_RE = /^[0-9a-f]{16}$/;
const HARNESSES = ['claude', 'codex'];
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const LIMITS_STATUSES = new Set(['ok', 'token_expired', 'not_applicable', 'unavailable', 'error']);
const RATE_LIMIT_STATUSES = new Set(['allowed', 'allowed_warning', 'rejected']);
const REASON_RE = /^[a-z0-9_]{1,48}$/;
// Agents send at most one a minute (or on a status change); this only bounds a misbehaving one.
const RATE_LIMITS_MIN_GAP_MS = 10 * 1000;
const PING_AFTER_MS = 10 * 60 * 1000;
// A pinging probe starts a whole Claude Code process (up to 45 s in lib/harness-probe.js).
const PING_EXTRA_MS = 50 * 1000;
const LIMIT_KEY_RE = /^[a-z0-9_]{1,48}$/;
const MAX_LIMITS = 12;
const PROBE_PERIOD_MS = 15 * 60 * 1000;
const REFRESH_THROTTLE_MS = 30 * 1000;
const REFRESH_WAIT_MS = 20 * 1000;
const UNSOLICITED_MIN_GAP_MS = 5 * 1000;
// Last good limits are kept through a transient failure (rate limit, network) for this long; older
// numbers would show a window that has long since reset.
const CARRY_LIMITS_MAX_MS = 6 * 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const FEATURE = 'harness_accounts';

// C0/C1 controls, zero-width marks, line/paragraph separators, bidi embeddings/overrides/isolates, BOM.
const UNSAFE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const esc = (n) => '\\u' + n.toString(16).padStart(4, '0');
const UNSAFE_CHARS = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => `${esc(a)}-${esc(b)}`).join('')}]`, 'g');

function cleanString(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(UNSAFE_CHARS, '').trim().slice(0, max);
  return s || null;
}

function cleanIso(v) {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? new Date(t).toISOString() : null;
}

function cleanLimit(l) {
  if (!l || typeof l !== 'object') return null;
  if (typeof l.key !== 'string' || !LIMIT_KEY_RE.test(l.key)) return null;
  if (typeof l.used_pct !== 'number' || !Number.isFinite(l.used_pct)) return null;
  const mins = Number.isInteger(l.window_mins) && l.window_mins > 0 && l.window_mins <= 525600 ? l.window_mins : null;
  return {
    key: l.key,
    label: cleanString(l.label, 80) || l.key,
    used_pct: Math.round(Math.min(100, Math.max(0, l.used_pct)) * 10) / 10,
    resets_at: cleanIso(l.resets_at),
    window_mins: mins,
    status: RATE_LIMIT_STATUSES.has(l.status) ? l.status : null,
  };
}

function cleanLimits(raw) {
  const seen = new Set();
  const limits = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_LIMITS * 2) : []) {
    const l = cleanLimit(r);
    if (!l || seen.has(l.key)) continue;
    seen.add(l.key);
    limits.push(l);
    if (limits.length >= MAX_LIMITS) break;
  }
  return limits;
}

function cleanOverage(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  return {
    status: RATE_LIMIT_STATUSES.has(o.status) ? o.status : null,
    is_using: typeof o.is_using === 'boolean' ? o.is_using : null,
    disabled_reason: typeof o.disabled_reason === 'string' && REASON_RE.test(o.disabled_reason) ? o.disabled_reason : null,
  };
}

function cleanHarness(h) {
  if (h === null || h === undefined) return null;
  if (typeof h !== 'object' || Array.isArray(h)) return null;
  const a = h.account && typeof h.account === 'object' && !Array.isArray(h.account) ? {
    email: cleanString(h.account.email, 200),
    org_name: cleanString(h.account.org_name, 200),
    plan: cleanString(h.account.plan, 200),
    auth_method: cleanString(h.account.auth_method, 200),
  } : null;
  const account = a && Object.values(a).some(Boolean) ? a : null;
  const limits = cleanLimits(h.limits);
  let status = LIMITS_STATUSES.has(h.limits_status) ? h.limits_status : 'unavailable';
  if (status === 'ok' && !limits.length) status = 'unavailable';
  const c = h.credits && typeof h.credits === 'object' && !Array.isArray(h.credits) ? h.credits : null;
  return {
    installed: h.installed === true,
    version: cleanString(h.version, 64),
    logged_in: typeof h.logged_in === 'boolean' ? h.logged_in : null,
    account,
    limits_status: status,
    limits: status === 'ok' ? limits : [],
    credits: c ? { enabled: c.enabled === true, balance: cleanString(typeof c.balance === 'number' ? String(c.balance) : c.balance, 32) } : null,
    error: cleanString(h.error, 200),
    retry_at: cleanIso(h.retry_at),
    // 'session' is only ever set here from harness_rate_limits; a probe can only report a ping.
    source: status === 'ok' && h.source === 'ping' ? 'ping' : null,
    rate_limit_status: RATE_LIMIT_STATUSES.has(h.rate_limit_status) ? h.rate_limit_status : null,
    overage: cleanOverage(h.overage),
  };
}

// harness_rate_limits → { machine_id, harness, status, limits, overage } or null.
function sanitizeRateLimits(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (typeof msg.machine_id !== 'string' || !MACHINE_ID_RE.test(msg.machine_id) || msg.harness !== 'claude') return null;
  const r = msg.rate_limits;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const status = RATE_LIMIT_STATUSES.has(r.status) ? r.status : null;
  const limits = cleanLimits(r.limits);
  const overage = cleanOverage(r.overage);
  if (!status && !limits.length && !overage) return null;
  return { machine_id: msg.machine_id, harness: 'claude', status, limits, overage };
}

// Claude limits seen by a session or a ping (stamped observed_at) outlive a probe that only re-read the
// account, as long as nothing says the login changed (an unreadable auth status keeps them too). A row
// from before (oauth/usage) has no observed_at and goes through carryLimits like Codex.
function keepObservedLimits(next, prev) {
  if (!next || next.limits_status === 'ok' || !prev?.observed_at || prev.limits_status !== 'ok' || !prev.limits?.length) return null;
  if (next.logged_in === false || next.limits_status === 'not_applicable') return null;
  if (next.account?.auth_method && next.account.auth_method !== 'claude.ai') return null;
  if (next.account?.email && prev.account?.email && !sameAccount(next, prev)) return null;
  return {
    ...next, account: next.account || prev.account || null,
    limits_status: 'ok', limits: prev.limits, source: prev.source, observed_at: prev.observed_at,
    limits_checked_at: prev.limits_checked_at, rate_limit_status: prev.rate_limit_status, overage: prev.overage,
  };
}

// → { machine: { id, hostname, platform }, harnesses } or null when the message is unusable.
function sanitizeSnapshot(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg.machine;
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !MACHINE_ID_RE.test(m.id)) return null;
  const hs = msg.harnesses && typeof msg.harnesses === 'object' && !Array.isArray(msg.harnesses) ? msg.harnesses : null;
  if (!hs) return null;
  const harnesses = {};
  for (const id of HARNESSES) harnesses[id] = cleanHarness(hs[id]);
  return {
    machine: { id: m.id, hostname: cleanString(m.hostname, 200), platform: PLATFORMS.has(m.platform) ? m.platform : null },
    harnesses,
  };
}

function sanitizeMachine(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !MACHINE_ID_RE.test(m.id)) return null;
  return { id: m.id, hostname: cleanString(m.hostname, 200), platform: PLATFORMS.has(m.platform) ? m.platform : null };
}

function sameAccount(a, b) {
  return !!(a?.account?.email && b?.account?.email && a.account.email.toLowerCase() === b.account.email.toLowerCase());
}

// A failed limits check (rate limited, network) after a good one for the same account keeps the good
// numbers, marked by limits_checked_at, instead of blanking the meters until the next probe.
function carryLimits(next, prev, nowMs) {
  if (!next) return next;
  if (next.limits_status === 'ok') return { ...next, limits_checked_at: new Date(nowMs).toISOString() };
  const checked = prev?.limits_checked_at ? Date.parse(prev.limits_checked_at) : NaN;
  if ((next.limits_status === 'unavailable' || next.limits_status === 'error') && prev?.limits_status === 'ok'
      && prev.limits?.length && sameAccount(next, prev) && Number.isFinite(checked) && nowMs - checked < CARRY_LIMITS_MAX_MS) {
    return { ...next, limits_status: 'ok', limits: prev.limits, limits_checked_at: prev.limits_checked_at,
      error: next.error || 'Limits check failed; showing the last known values.' };
  }
  return { ...next, limits_checked_at: null };
}

// A retry_at in the past means nothing; one further than a day out is not believed (an agent could
// otherwise switch its machine's limit checks off indefinitely).
function clampRetryAt(h, nowMs) {
  if (!h?.retry_at) return h;
  const at = Date.parse(h.retry_at);
  if (!(at > nowMs)) return { ...h, retry_at: null };
  return at > nowMs + MAX_RETRY_AFTER_MS ? { ...h, retry_at: new Date(nowMs + MAX_RETRY_AFTER_MS).toISOString() } : h;
}

function createHarnessAccounts({ db, broadcastGlobal, sendToAgent, isOnline, hasFeature, now = () => Date.now(),
  refreshWaitMs = REFRESH_WAIT_MS, probeTimeoutMs = refreshWaitMs + 10_000 }) {
  const inflight = new Map(); // machine_id → { actorId, requestId, sentAt, waiters: [resolve] }
  const lastRequested = new Map(); // machine_id → ms
  const lastUnsolicited = new Map(); // actor_id → ms
  const announced = new Map(); // actor_id → { id, hostname, platform } from its agent_connect on the live socket
  const lastRateLimits = new Map(); // machine_id → ms

  const q = {
    mapActor: () => db.prepare(`INSERT INTO agent_machines (actor_id, machine_id, seen_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(actor_id) DO UPDATE SET machine_id=excluded.machine_id, seen_at=excluded.seen_at`),
    snapshot: () => db.prepare('SELECT machine_id, hostname, platform, payload, probed_at FROM harness_account_snapshots WHERE machine_id=?'),
    upsert: () => db.prepare(`INSERT INTO harness_account_snapshots (machine_id, hostname, platform, payload, probed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(machine_id) DO UPDATE SET hostname=excluded.hostname, platform=excluded.platform,
        payload=excluded.payload, probed_at=excluded.probed_at, updated_at=excluded.updated_at`),
    insertPayload: () => db.prepare(`INSERT INTO harness_account_snapshots (machine_id, hostname, platform, payload, probed_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, datetime('now'))
      ON CONFLICT(machine_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`),
    machineAgents: () => db.prepare('SELECT actor_id FROM agent_machines WHERE machine_id=? ORDER BY seen_at DESC, actor_id'),
  };

  function parsePayload(row) {
    try { return JSON.parse(row.payload); } catch { return { claude: null, codex: null }; }
  }

  function probeAgentFor(machineId) {
    return q.machineAgents().all(machineId).map(r => r.actor_id).find(id => isOnline(id) && hasFeature(id, FEATURE)) ?? null;
  }

  // Codex usage endpoint answered 429 with a Retry-After still running → { codex: retry_at }. (Claude
  // limits come from rate_limit_event, which calls no endpoint.)
  function skipLimits(machineId, t) {
    const row = q.snapshot().get(machineId);
    if (!row) return null;
    const payload = parsePayload(row);
    const skip = {};
    for (const id of ['codex']) {
      const at = payload[id]?.retry_at ? Date.parse(payload[id].retry_at) : NaN;
      if (Number.isFinite(at) && at > t) skip[id] = payload[id].retry_at;
    }
    return Object.keys(skip).length ? skip : null;
  }

  function lastProbedMs(machineId) {
    const row = q.snapshot().get(machineId);
    const t = row?.probed_at ? Date.parse(row.probed_at) : NaN;
    return Number.isFinite(t) ? t : 0;
  }

  // Claude limits are due for a ping when no session event or ping stamped them within PING_AFTER_MS and
  // the machine is not known to be on a login without plan limits.
  function needsPing(machineId, t) {
    const row = q.snapshot().get(machineId);
    const c = row ? parsePayload(row).claude : null;
    if (c && (c.logged_in === false || c.limits_status === 'not_applicable')) return false;
    const seen = c?.observed_at ? Date.parse(c.observed_at) : NaN;
    return !(Number.isFinite(seen) && t - seen < PING_AFTER_MS);
  }

  // Asks one online agent of the machine for a snapshot unless one is in flight or was asked for within
  // minGapMs. → a promise settled when a snapshot for the machine arrives (true) or the wait ends (false).
  // ping: manual refreshes only — the agent may then run one haiku turn for the Claude limits.
  function request(machineId, minGapMs, { ping = false } = {}) {
    const pending = inflight.get(machineId);
    if (pending) return new Promise(resolve => pending.waiters.push(resolve));
    const t = now();
    if (t - Math.max(lastRequested.get(machineId) || 0, lastProbedMs(machineId)) < minGapMs) return Promise.resolve(false);
    const actorId = probeAgentFor(machineId);
    if (actorId === null) return Promise.resolve(false);
    const requestId = crypto.randomBytes(8).toString('hex');
    const entry = { actorId, requestId, sentAt: t, waiters: [] };
    const skip = skipLimits(machineId, t);
    const pingLimits = ping && needsPing(machineId, t);
    if (!sendToAgent(actorId, { type: 'harness_accounts_request', request_id: requestId, ...(skip ? { skip_limits: skip } : {}), ...(pingLimits ? { ping_limits: true } : {}) })) return Promise.resolve(false);
    inflight.set(machineId, entry);
    lastRequested.set(machineId, t);
    // An open Accounts tab refetches on this and shows the machine as refreshing — also for tick probes.
    broadcastGlobal({ type: 'harness_accounts_updated', machine_id: machineId });
    const done = new Promise(resolve => entry.waiters.push(resolve));
    // The probe itself is capped at ~20 s in stoa.js (~50 s with a ping); past that the agent is not answering.
    const timer = setTimeout(() => settle(machineId, false), probeTimeoutMs + (pingLimits ? PING_EXTRA_MS : 0));
    timer.unref?.();
    entry.timer = timer;
    return done;
  }

  function settle(machineId, ok) {
    const entry = inflight.get(machineId);
    if (!entry) return;
    inflight.delete(machineId);
    clearTimeout(entry.timer);
    for (const w of entry.waiters) w(ok);
    // A snapshot broadcasts from accept(); a probe that ends without one still has to clear "refreshing".
    if (!ok) broadcastGlobal({ type: 'harness_accounts_updated', machine_id: machineId });
  }

  // agent_connect: remember where the agent runs; ask for a snapshot when the machine's is due.
  function agentConnected(actorId, rawMachine) {
    const machine = sanitizeMachine(rawMachine);
    if (!machine) { announced.delete(actorId); return; }
    announced.set(actorId, machine);
    q.mapActor().run(actorId, machine.id);
    if (hasFeature(actorId, FEATURE)) request(machine.id, PROBE_PERIOD_MS);
  }

  function agentDisconnected(actorId) {
    lastUnsolicited.delete(actorId);
    announced.delete(actorId);
    for (const [machineId, entry] of inflight) if (entry.actorId === actorId) settle(machineId, false);
  }

  // WS harness_accounts from an authenticated agent. → true when stored.
  function accept(actorId, msg) {
    const snap = sanitizeSnapshot(msg);
    if (!snap) return false;
    // Only the machine this socket announced: an agent must not overwrite another machine's snapshot.
    if (announced.get(actorId)?.id !== snap.machine.id) {
      console.warn(`[harness-accounts] rejected snapshot from Actor #${actorId}: machine differs from its agent_connect`);
      return false;
    }
    const answering = inflight.get(snap.machine.id);
    const solicited = !!answering && answering.actorId === actorId && msg.request_id === answering.requestId;
    if (!solicited) {
      const last = lastUnsolicited.get(actorId) || 0;
      if (now() - last < UNSOLICITED_MIN_GAP_MS) return false;
      lastUnsolicited.set(actorId, now());
    }
    const t = now();
    const prevRow = q.snapshot().get(snap.machine.id);
    const prev = prevRow ? parsePayload(prevRow) : {};
    const harnesses = {};
    const probedAt = new Date(t).toISOString();
    for (const id of HARNESSES) {
      const next = clampRetryAt(snap.harnesses[id], t);
      if (next?.source === 'ping') harnesses[id] = { ...next, observed_at: probedAt, limits_checked_at: probedAt };
      else harnesses[id] = keepObservedLimits(next, prev[id]) || (next && { ...carryLimits(next, prev[id], t), observed_at: null });
    }
    db.transaction(() => {
      q.mapActor().run(actorId, snap.machine.id);
      q.upsert().run(snap.machine.id, snap.machine.hostname, snap.machine.platform, JSON.stringify(harnesses), probedAt);
    })();
    lastRequested.set(snap.machine.id, Math.max(lastRequested.get(snap.machine.id) || 0, t));
    if (solicited) settle(snap.machine.id, true);
    broadcastGlobal({ type: 'harness_accounts_updated', machine_id: snap.machine.id });
    return true;
  }

  // WS harness_rate_limits: a Claude rate_limit_event from one of the agent's sessions (stoa.js only
  // forwards those of the agent's own login). → true when stored.
  function acceptRateLimits(actorId, msg) {
    const r = sanitizeRateLimits(msg);
    if (!r) return false;
    const machine = announced.get(actorId);
    if (machine?.id !== r.machine_id) {
      console.warn(`[harness-accounts] rejected rate limits from Actor #${actorId}: machine differs from its agent_connect`);
      return false;
    }
    const t = now();
    const row = q.snapshot().get(r.machine_id);
    const payload = row ? parsePayload(row) : { claude: null, codex: null };
    const prev = payload.claude || { installed: true, version: null, logged_in: null, account: null, limits_status: 'unavailable', limits: [], credits: null, error: null, retry_at: null };
    const statusChanged = r.status !== (prev.rate_limit_status ?? null);
    if (!statusChanged && t - (lastRateLimits.get(r.machine_id) || 0) < RATE_LIMITS_MIN_GAP_MS) return false;
    lastRateLimits.set(r.machine_id, t);
    const at = new Date(t).toISOString();
    // An event without unifiedWindows describes one window: the others seen before stay.
    const kept = prev.observed_at && prev.limits_status === 'ok' ? prev.limits.filter(l => !r.limits.some(n => n.key === l.key)) : [];
    const limits = r.limits.length ? [...r.limits, ...kept].slice(0, MAX_LIMITS) : kept;
    payload.claude = {
      ...prev,
      ...(limits.length ? { limits_status: 'ok', limits, error: null, retry_at: null } : {}),
      ...(r.limits.length ? { source: 'session', observed_at: at, limits_checked_at: at } : {}),
      rate_limit_status: r.status,
      overage: r.overage ?? prev.overage ?? null,
    };
    q.insertPayload().run(r.machine_id, machine.hostname, machine.platform, JSON.stringify(payload));
    broadcastGlobal({ type: 'harness_accounts_updated', machine_id: r.machine_id });
    return true;
  }

  function list() {
    const rows = db.prepare('SELECT machine_id, hostname, platform, payload, probed_at FROM harness_account_snapshots').all();
    const agents = db.prepare(`
      SELECT am.machine_id, a.id AS actor_id, a.name, a.avatar_color, a.avatar_symbol, a.avatar_url,
        COALESCE(u.tokens, 0) AS tokens_7d, COALESCE(u.turns, 0) AS turns_7d
      FROM agent_machines am
      JOIN actors a ON a.id = am.actor_id
      LEFT JOIN (
        SELECT actor_id, SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) AS tokens, COUNT(*) AS turns
        FROM usage_log WHERE created_at >= datetime('now', '-7 days') GROUP BY actor_id
      ) u ON u.actor_id = am.actor_id
      ORDER BY a.name COLLATE NOCASE, a.id`).all();
    const byMachine = new Map();
    for (const a of agents) {
      if (!byMachine.has(a.machine_id)) byMachine.set(a.machine_id, []);
      byMachine.get(a.machine_id).push({
        actor_id: a.actor_id, name: a.name, avatar_color: a.avatar_color, avatar_symbol: a.avatar_symbol,
        avatar_url: a.avatar_url, online: isOnline(a.actor_id), tokens_7d: a.tokens_7d, turns_7d: a.turns_7d,
      });
    }
    // A machine none of whose agents still exists has nobody left to refresh it: not shown.
    const machines = rows.filter(r => byMachine.has(r.machine_id)).map(r => {
      const list = byMachine.get(r.machine_id);
      return {
        machine_id: r.machine_id, hostname: r.hostname, platform: r.platform,
        online: list.some(a => a.online), probed_at: r.probed_at,
        refreshing: inflight.has(r.machine_id),
        harnesses: parsePayload(r), agents: list,
      };
    }).sort((a, b) => (b.online - a.online) || String(a.hostname || '').localeCompare(String(b.hostname || '')) || a.machine_id.localeCompare(b.machine_id));
    const accounts = {};
    const mismatch = {};
    for (const id of HARNESSES) {
      const emails = new Map();
      for (const m of machines) {
        const h = m.harnesses[id];
        const email = h?.logged_in !== false ? h?.account?.email : null;
        if (email && !emails.has(email.toLowerCase())) emails.set(email.toLowerCase(), email);
      }
      accounts[id] = [...emails.values()].sort((a, b) => a.localeCompare(b));
      mismatch[id] = accounts[id].length > 1;
    }
    return { machines, accounts, mismatch };
  }

  // POST refresh: one probe per targeted machine (throttled), wait for whatever arrives within the
  // window, answer with the current list. machineId null = every machine.
  async function refresh(machineId) {
    const ids = machineId ? [machineId]
      : db.prepare('SELECT DISTINCT machine_id FROM agent_machines').all().map(r => r.machine_id);
    const waits = ids.map(id => request(id, REFRESH_THROTTLE_MS, { ping: true }));
    let timer;
    await Promise.race([
      Promise.all(waits),
      new Promise(resolve => { timer = setTimeout(resolve, refreshWaitMs); }),
    ]);
    clearTimeout(timer);
    return list();
  }

  function knows(machineId) {
    return !!db.prepare('SELECT 1 FROM agent_machines WHERE machine_id=? LIMIT 1').get(machineId);
  }

  // Periodic: every machine with an online agent gets a probe once its snapshot is PROBE_PERIOD_MS old.
  function tick() {
    for (const { machine_id } of db.prepare('SELECT DISTINCT machine_id FROM agent_machines').all()) {
      request(machine_id, PROBE_PERIOD_MS);
    }
  }

  function start(intervalMs = 60_000) {
    const t = setInterval(() => {
      try { tick(); } catch (e) { console.error('[harness-accounts] tick failed:', e.message); }
    }, intervalMs);
    t.unref?.();
    return t;
  }

  return { accept, acceptRateLimits, agentConnected, agentDisconnected, list, refresh, knows, tick, start };
}

module.exports = {
  createHarnessAccounts, sanitizeSnapshot, sanitizeMachine, sanitizeRateLimits, carryLimits,
  MACHINE_ID_RE, FEATURE, PROBE_PERIOD_MS, REFRESH_THROTTLE_MS,
};
