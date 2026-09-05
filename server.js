const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { ClaudeSession } = require('./claude-session');
const { validateScheduleSpec, computeNextRun, nextRunAfterSkip } = require('./lib/schedule');
const fallbackSessions = new Map();

// R15: unique identifier for this server boot. Sessions tagged with a different
// generation are from a prior process and their in-flight state is unknown.
const PROCESS_GEN = crypto.randomBytes(16).toString('hex');
const FALLBACK_IDLE_MS = 30 * 60 * 1000;
function getFallbackSession(participantId, workDir) {
  const key = `${participantId}:${workDir || ''}`;
  const entry = fallbackSessions.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.session.shutdown(); fallbackSessions.delete(key); }, FALLBACK_IDLE_MS);
    return entry.session;
  }
  const session = new ClaudeSession({ workDir: workDir || __dirname });
  const timer = setTimeout(() => { session.shutdown(); fallbackSessions.delete(key); }, FALLBACK_IDLE_MS);
  fallbackSessions.set(key, { session, timer });
  return session;
}

const connectionManager = require('./connection-manager');
const automationQueue = require('./queue-manager');
automationQueue.on('processing', ({ key, pending, meta }) => {
  if (pending > 0) console.log(`[queue] room ${key}: processing "${meta?.automation || 'unknown'}" (${pending} waiting)`);
});
automationQueue.on('drained', ({ key }) => {
  console.log(`[queue] room ${key}: queue drained`);
});

const EXPECTED_CLIENT_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'stoa.js'), 'utf8');
    const m = src.match(/^const CLIENT_VERSION\s*=\s*'([^']+)'/m);
    return m ? m[1] : null;
  } catch { return null; }
})();

// Build agent bundle: stoa.js + lib/* → dist/stoa.js (single file for agent auto-update).
// esbuild is fast (~50ms); rebuild on every startup ensures bundle is always fresh.
const AGENT_BUNDLE_PATH = path.join(__dirname, 'dist', 'stoa.js');
let agentBundleReady = false;
(() => {
  try {
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
    require('esbuild').buildSync({
      entryPoints: [path.join(__dirname, 'stoa.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      external: ['ws', './claude-session'],
      outfile: AGENT_BUNDLE_PATH,
    });
    agentBundleReady = true;
    console.log('[build] Agent bundle ready');
  } catch (e) {
    console.error('[build] Agent bundle FAILED — agent updates will be blocked until resolved:', e.message);
  }
})();

// Hash of the agent bundle (or source stoa.js fallback) at startup — used as the "safe"
// baseline for the monotonic downgrade guard in the manifest endpoint.
function clientFilePath(name) {
  if (name === 'stoa.js' && fs.existsSync(AGENT_BUNDLE_PATH)) return AGENT_BUNDLE_PATH;
  return path.join(__dirname, name);
}

const SAFE_CLIENT_HASH = (() => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(clientFilePath('stoa.js'))).digest('hex').slice(0, 12);
  } catch { return null; }
})();

// Resolve a participant's workspace directory: their own workdir_id, else the room workdir
// (only if it belongs to this agent), else the agent's default workdir, else null (the agent
// then falls back to its own cwd via `workdir || undefined`). This is the SINGLE source of
// truth for routing workdir — dispatch, session save, and compact all call it, so the saved
// session key can never drift from the lookup key (the bug fixed by migration
// 20260620-rekey-ai-sessions-participant). `prefetchedRoomWd` lets a multi-agent sequence
// reuse one room-workdir query instead of re-running it per turn.
function resolveParticipantWorkdir(participantId, prefetchedRoomWd = null) {
  const part = db.prepare('SELECT actor_id, room_id, workdir_id FROM room_participants WHERE id=?').get(participantId);
  if (!part) return null;
  if (part.workdir_id) {
    const w = db.prepare('SELECT path FROM agent_workdirs WHERE id=?').get(part.workdir_id);
    if (w?.path) return w.path;
  }
  const roomWd = prefetchedRoomWd ?? db.prepare(
    'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
  ).get(part.room_id);
  if (roomWd?.path && roomWd.actor_id === part.actor_id) return roomWd.path;
  const def = db.prepare('SELECT path FROM agent_workdirs WHERE actor_id=? AND is_default=1 LIMIT 1').get(part.actor_id);
  return def?.path || null;
}

// Phase 3 — model tier routing. Server default fallback chain per tier (9Router
// pattern: primary first, the rest tried in order when a model is unavailable).
// A room may override this via rooms.model_tiers; a sub-agent may pin one model.
const SERVER_DEFAULT_TIERS = {
  quick:    ['claude-haiku-4-5'],
  standard: ['claude-sonnet-5', 'claude-haiku-4-5'],
  deep:     ['claude-opus-5', 'claude-sonnet-5'],
};

// Resolve the ordered model fallback chain for a trigger. Precedence:
//   1. sub_agent explicit model override  → [that model]   (user pinned it)
//   2. room.model_tiers[tier] chain       → configured per-room override
//   3. server default chain for the tier  → SERVER_DEFAULT_TIERS
//   4. last resort                        → [roomModel] (unchanged single-model)
// A main-agent trigger (no sub-agent / no tier) always returns [roomModel] so
// existing behaviour is untouched — tier routing applies to sub-agents only.
function resolveModelChain(subAgent, roomModel, roomModelTiersJson) {
  if (!subAgent || !subAgent.tier) return roomModel ? [roomModel] : [];
  if (subAgent.model) return [subAgent.model];
  const tier = subAgent.tier;
  if (roomModelTiersJson) {
    try {
      const chain = JSON.parse(roomModelTiersJson)?.[tier];
      if (Array.isArray(chain)) {
        const clean = chain.filter(m => typeof m === 'string' && m.trim());
        if (clean.length) return clean;
      }
    } catch {}
  }
  const def = SERVER_DEFAULT_TIERS[tier];
  if (def?.length) return def.slice();
  return roomModel ? [roomModel] : [];
}

// Phase 4: whitelist an agent-supplied result_meta into a fixed, storable shape.
// Returns a compact JSON string, or null when nothing meaningful is present.
// Never trusts arbitrary keys/values — only exit_reason (from a fixed set),
// integer token counts, and an integer duration survive.
const RESULT_EXIT_REASONS = new Set(['completed', 'stopped', 'timeout', 'error']);
// R13: explicit failure exit reasons — win over presence of output content.
// 'stopped' (user-cancelled) is intentionally excluded: partial content is still useful.
const FAILURE_EXIT_REASONS = new Set(['error', 'timeout']);

// R13: extract a single clean line from raw error content (≤200 chars).
// Traceback/stack trace → last non-empty line; otherwise → first non-empty line.
function cleanErrorText(raw) {
  if (!raw || typeof raw !== 'string') return 'unknown error';
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return 'unknown error';
  const isTraceback = /Traceback|Error:|  at |  File "/.test(raw);
  return (isTraceback ? lines[lines.length - 1] : lines[0]).slice(0, 200);
}

function sanitizeResultMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (RESULT_EXIT_REASONS.has(raw.exit_reason)) out.exit_reason = raw.exit_reason;
  const t = raw.tokens;
  if (t && typeof t === 'object') {
    const input = Number.isFinite(t.input) ? Math.max(0, Math.trunc(t.input)) : 0;
    const output = Number.isFinite(t.output) ? Math.max(0, Math.trunc(t.output)) : 0;
    if (input || output) out.tokens = { input, output };
  }
  if (Number.isFinite(raw.duration_ms) && raw.duration_ms > 0) {
    out.duration_ms = Math.trunc(raw.duration_ms);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

const DEFAULT_CONTEXT_WINDOW = 200000;
const MODEL_CONTEXT_LIMITS = {
  'claude-opus-5': 200000, 'claude-sonnet-5': 200000, 'claude-fable-5-1': 200000,
  'claude-opus-4-8': 200000, 'claude-opus-4-7': 200000, 'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000, 'claude-sonnet-4-5': 200000, 'claude-haiku-4-5': 200000,
};
function getContextLimit(model) { return MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_WINDOW; }

const { escapeRegExp, safeRegexTest, validateRegexPattern } = require('./lib/regex-safety');

function validateConditions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch { return 'trigger_conditions must be valid JSON'; }
  if (!Array.isArray(parsed)) return 'trigger_conditions must be a JSON array';
  for (const c of parsed) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return 'each condition must be an object';
    if (c.op === 'matches_regex') {
      const err = validateRegexPattern(c.value);
      if (err) return `Condition regex: ${err}`;
    }
  }
  return null;
}

// Main-agent session lookup: explicit sub_agent_id IS NULL to avoid matching sub-agent sessions.
// See migration 20260831-sub-agent-definitions.sql for the partial unique index design.
function getSession(participantId) {
  const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND sub_agent_id IS NULL').get(participantId);
  return row?.claude_session_id ?? null;
}

function getSubAgentSession(participantId, subAgentId) {
  const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND sub_agent_id=?').get(participantId, subAgentId);
  return row?.claude_session_id ?? null;
}

function saveSession(participantId, claudeSessionId, workdir) {
  const rp = db.prepare('SELECT room_id FROM room_participants WHERE id=?').get(participantId);
  db.prepare(
    `INSERT INTO ai_sessions (participant_id, room_id, claude_session_id, workdir, status) VALUES (?,?,?,?,'idle')
     ON CONFLICT(participant_id) WHERE sub_agent_id IS NULL DO UPDATE SET claude_session_id=excluded.claude_session_id, room_id=excluded.room_id, workdir=excluded.workdir, status='idle', last_active_at=datetime('now')`
  ).run(participantId, rp?.room_id ?? null, claudeSessionId, workdir || null);
}

function saveSubAgentSession(participantId, subAgentId, claudeSessionId, workdir) {
  const rp = db.prepare('SELECT room_id FROM room_participants WHERE id=?').get(participantId);
  db.prepare(
    `INSERT INTO ai_sessions (participant_id, room_id, sub_agent_id, claude_session_id, workdir, status) VALUES (?,?,?,?,?,'idle')
     ON CONFLICT(participant_id, sub_agent_id) WHERE sub_agent_id IS NOT NULL DO UPDATE SET claude_session_id=excluded.claude_session_id, room_id=excluded.room_id, workdir=excluded.workdir, status='idle', last_active_at=datetime('now')`
  ).run(participantId, rp?.room_id ?? null, subAgentId, claudeSessionId, workdir || null);
}

// Spawn tokens removed (P4): sub-agent delegation is now @mention-based.
// Depth guard is handled by MAX_WAKE_CASCADE_DEPTH + cascade only fires from
// parent responses, not sub-agent responses.

// Verify x-agent-id / x-agent-secret headers (same HMAC scheme as proactive message).
// Returns the agent actor row on success, or null.
function verifyAgentRequest(req) {
  const agentId = parseInt(req.headers['x-agent-id'] || '0');
  const agentSecret = req.headers['x-agent-secret'] || '';
  if (!agentId || !agentSecret) return null;
  const actor = db.prepare("SELECT id, secret FROM actors WHERE id=? AND type='ai'").get(agentId);
  if (!actor || !actor.secret) return null;
  const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
  try {
    if (!crypto.timingSafeEqual(h(agentSecret), h(actor.secret))) return null;
  } catch { return null; }
  return actor;
}

// ─── Phase 2b: durable auto-wake (R1) ──────────────────────────────────────
// When a sub-agent completes, wake its parent exactly once with the result in
// context. The pending_wakes row makes this survive a server restart (drained
// on startup). ALL sub-agent completions wake their parent — both
// /sub-agent-trigger spawns (parent_message_id set) and @mention-cascade
// triggers (parent_message_id null).
const MAX_WAKE_ATTEMPTS = 3;

function enqueueParentWake(roomId, parentParticipantId, subAgentMessageId) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO pending_wakes (room_id, parent_participant_id, sub_agent_message_id) VALUES (?,?,?)'
  ).run(roomId, parentParticipantId, subAgentMessageId);
  drainWake(Number(lastInsertRowid)).catch(e => console.error('[wake] drain error:', e.message));
}

// Phase 4 (Loop Guard #7): a compact per-sub-agent cost rollup for a room, used
// to hand the orchestrator enough context to post a run summary. Reads the
// canonical spend from usage_log (tokens attributed per sub-agent) and wall time
// from the messages' result_meta. Returns null when <2 sub-agent runs exist —
// a single spawn does not warrant a summary. `_fmtTok` mirrors the client chip.
function _fmtTok(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n || 0);
}
function buildRoomCostRollup(roomId) {
  const perAgent = db.prepare(`
    SELECT sub_agent_label AS label, COUNT(*) AS runs,
           COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
           COALESCE(SUM(cost_usd), 0) AS cost
    FROM usage_log
    WHERE room_id=? AND sub_agent_id IS NOT NULL
    GROUP BY sub_agent_id, sub_agent_label
    ORDER BY tokens DESC
  `).all(roomId);
  const totalRuns = perAgent.reduce((s, r) => s + r.runs, 0);
  if (totalRuns < 2) return null;
  const totalTokens = perAgent.reduce((s, r) => s + r.tokens, 0);
  const totalCost = perAgent.reduce((s, r) => s + r.cost, 0);
  const wall = db.prepare(`
    SELECT COALESCE(SUM(json_extract(result_meta, '$.duration_ms')), 0) AS ms
    FROM messages
    WHERE room_id=? AND sub_agent_id IS NOT NULL AND result_meta IS NOT NULL
  `).get(roomId);
  return { perAgent, totalRuns, totalTokens, totalCost, wallMs: wall?.ms || 0 };
}
function formatCostRollup(r) {
  const mins = Math.round(r.wallMs / 60000);
  const wall = r.wallMs >= 60000 ? `~${mins} menit` : `${Math.round(r.wallMs / 1000)} detik`;
  const perLine = r.perAgent
    .map(a => `  • ${a.label || 'sub-agent'}: ${a.runs} run, ${_fmtTok(a.tokens)} tok`)
    .join('\n');
  const cost = r.totalCost > 0 ? ` · ~$${r.totalCost.toFixed(2)}` : '';
  return `[cost so far] ${r.totalRuns} sub-agent run di room ini · ${_fmtTok(r.totalTokens)} tok · ${wall} wall time${cost}\n${perLine}`;
}

async function drainWake(wakeId) {
  const row = db.prepare('SELECT * FROM pending_wakes WHERE id=?').get(wakeId);
  if (!row) return;
  const parent = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.id=?
  `).get(row.parent_participant_id);
  const sub = db.prepare(`
    SELECT m.content, m.sub_agent_label, m.state, m.result_meta FROM messages m WHERE m.id=?
  `).get(row.sub_agent_message_id);
  if (!parent || !sub) { db.prepare('DELETE FROM pending_wakes WHERE id=?').run(wakeId); return; }

  const label = sub.sub_agent_label || 'sub-agent';
  // R13: if sub-agent finished with a failure state, prefix the wake prompt so
  // the parent synthesizer knows it failed rather than silently treating it as success.
  const subFailed = sub.state === 'error';
  const subExitReason = sub.result_meta ? (JSON.parse(sub.result_meta)?.exit_reason || null) : null;
  const failurePrefix = subFailed
    ? `[sub-agent GAGAL] Sub-agent "${label}" selesai dengan status ERROR (exit_reason: ${subExitReason || 'error'}). Output di bawah ini mungkin parsial atau pesan error:\n\n`
    : '';
  // R5: truncate very long results in the wake prompt; full text stays as the room message.
  const MAX_WAKE_CHARS = 4000;
  const body = (sub.content || '').length > MAX_WAKE_CHARS
    ? (sub.content.slice(0, MAX_WAKE_CHARS) + `\n… (dipotong — teks lengkap ada di pesan "${parent.name} (${label})" di room)`)
    : (sub.content || '');
  // Phase 4 (Loop Guard #7): attach the cost rollup only on the CLOSING wake of
  // a pipeline, so a big multi-spawn run gets exactly one summary (not one per
  // completion). When drainWake runs, the just-completed sub-agent is already
  // state='complete'/'error', so zero still-streaming sub-agents in the room means this
  // is the last wake. This also skips the two rollup queries on every earlier
  // wake. (Kira review PR #53, finding c.)
  const stillRunning = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'"
  ).get(row.room_id).c;
  const rollup = stillRunning === 0 ? buildRoomCostRollup(row.room_id) : null;
  const costBlock = rollup
    ? `\n\n${formatCostRollup(rollup)}\n(Ini menutup rangkaian spawn — sertakan ringkasan biaya singkat di jawabanmu kalau relevan.)`
    : '';
  const wakePrompt = `[sub-agent result] Sub-agent "${label}" yang kamu picu sudah selesai. ${failurePrefix}Hasilnya:\n\n${body}\n\nSintesiskan dan lanjutkan menjawab. Kamu boleh @mention sub-agent lain untuk delegate tugas berikutnya (misal @stoa-reviewer untuk review). Mention akan otomatis trigger sub-agent tersebut.${costBlock}`;

  try {
    await triggerAiResponse(row.room_id, { ...parent, sub_agent: null }, wakePrompt, null, []);
    db.prepare('DELETE FROM pending_wakes WHERE id=?').run(wakeId);
    cascadeMentionsAfterWake(row.room_id, parent).catch(e =>
      console.error('[wake-cascade] error:', e.message));
  } catch (e) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_WAKE_ATTEMPTS) {
      db.prepare('DELETE FROM pending_wakes WHERE id=?').run(wakeId);
      const sys = db.prepare(
        `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')`
      ).run(row.room_id, row.parent_participant_id, `gagal membangunkan ${parent.name} untuk hasil ${label} setelah ${attempts}×`);
      broadcast(row.room_id, { type: 'message_new', message: db.prepare('SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id=?').get(Number(sys.lastInsertRowid)) });
    } else {
      db.prepare('UPDATE pending_wakes SET attempts=? WHERE id=?').run(attempts, wakeId);
    }
    console.error(`[wake] attempt ${attempts} failed for wake ${wakeId}:`, e.message);
  }
}

// ─── Wake-turn mention cascade ─────────────────────────────────────────────
// After a wake-turn synthesis, check if the parent's response @mentions other
// agents or sub-agents. If so, trigger them sequentially — enabling the
// orchestration loop: sub-agent completes → parent synthesizes → @mentions
// next sub-agent → cascade triggers it → repeat.
const MAX_WAKE_CASCADE_DEPTH = 5;
const wakeCascadeDepth = new Map(); // roomId → current depth
const mentionBoundary = (name) => new RegExp(`(?:^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|[.,!?;:]|$)`);

async function cascadeMentionsAfterWake(roomId, parent) {
  const depth = (wakeCascadeDepth.get(roomId) || 0) + 1;
  if (depth > MAX_WAKE_CASCADE_DEPTH) {
    console.log(`[wake-cascade] depth ${depth} exceeds max ${MAX_WAKE_CASCADE_DEPTH} for room ${roomId}, stopping`);
    wakeCascadeDepth.delete(roomId);
    return;
  }

  const lastMsg = db.prepare(`
    SELECT m.content FROM messages m
    JOIN room_participants rp ON rp.id=m.participant_id
    WHERE rp.actor_id=? AND m.room_id=? AND m.state='complete' AND m.sub_agent_id IS NULL AND m.completed_at IS NOT NULL
    ORDER BY m.id DESC LIMIT 1
  `).get(parent.actor_id, roomId);
  if (!lastMsg?.content || !lastMsg.content.includes('@')) return;

  const allAi = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
  `).all(roomId);

  const linkedSubs = db.prepare(`
    SELECT sa.*, a.name AS parent_name FROM room_sub_agents rsa
    JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
    JOIN actors a ON a.id=sa.parent_actor_id
    WHERE rsa.room_id=? AND sa.enabled=1
  `).all(roomId);

  const subAgentsCascade = [];
  const regularAgentsCascade = [];

  for (const sa of linkedSubs) {
    if (mentionBoundary(sa.label).test(lastMsg.content)) {
      const parentAgent = allAi.find(a => a.actor_id === sa.parent_actor_id);
      if (parentAgent) subAgentsCascade.push({ ...parentAgent, sub_agent: sa });
    }
  }

  for (const other of allAi) {
    if (other.actor_id !== parent.actor_id && mentionBoundary(other.name).test(lastMsg.content)) {
      const alreadyQueued = regularAgentsCascade.some(a => a.actor_id === other.actor_id);
      if (!alreadyQueued) regularAgentsCascade.push({ ...other, sub_agent: null });
    }
  }

  if (!subAgentsCascade.length && !regularAgentsCascade.length) {
    wakeCascadeDepth.delete(roomId);
    return;
  }

  const allCascadeLabels = [...subAgentsCascade.map(a => a.sub_agent.label), ...regularAgentsCascade.map(a => a.name)];
  console.log(`[wake-cascade] depth ${depth}: ${allCascadeLabels.join(', ')} in room ${roomId}`);
  wakeCascadeDepth.set(roomId, depth);
  try {
    for (const sa of subAgentsCascade) {
      triggerAiResponse(roomId, sa, lastMsg.content, null, []).catch(e => console.error('[wake-cascade sub-agent] parallel error:', e));
    }
    if (regularAgentsCascade.length > 0) {
      await triggerAgentsSequential(roomId, regularAgentsCascade, lastMsg.content, null, []);
    }
  } finally {
    if (wakeCascadeDepth.get(roomId) === depth) wakeCascadeDepth.delete(roomId);
  }
}

// Cascade @mentions from a proactive agent message (same logic as wake-cascade but content is known upfront).
async function cascadeMentionsFromProactive(roomId, senderActorId, content) {
  if (!content.includes('@')) return;

  const allAi = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
  `).all(roomId);

  const linkedSubs = db.prepare(`
    SELECT sa.*, a.name AS parent_name FROM room_sub_agents rsa
    JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
    JOIN actors a ON a.id=sa.parent_actor_id
    WHERE rsa.room_id=? AND sa.enabled=1
  `).all(roomId);

  const subAgentsCascade = [];
  const regularAgentsCascade = [];

  for (const sa of linkedSubs) {
    if (mentionBoundary(sa.label).test(content)) {
      const parentAgent = allAi.find(a => a.actor_id === sa.parent_actor_id);
      if (parentAgent) subAgentsCascade.push({ ...parentAgent, sub_agent: sa });
    }
  }

  for (const other of allAi) {
    if (other.actor_id !== senderActorId && mentionBoundary(other.name).test(content)) {
      const alreadyQueued = regularAgentsCascade.some(a => a.actor_id === other.actor_id);
      if (!alreadyQueued) regularAgentsCascade.push({ ...other, sub_agent: null });
    }
  }

  if (!subAgentsCascade.length && !regularAgentsCascade.length) return;

  const labels = [...subAgentsCascade.map(a => a.sub_agent.label), ...regularAgentsCascade.map(a => a.name)];
  console.log(`[proactive-cascade] room ${roomId}: triggering ${labels.join(', ')}`);

  for (const sa of subAgentsCascade) {
    triggerAiResponse(roomId, sa, content, null, []).catch(e => console.error('[proactive-cascade sub-agent]', e.message));
  }
  if (regularAgentsCascade.length > 0) {
    await triggerAgentsSequential(roomId, regularAgentsCascade, content, null, []);
  }
}

// Drain any wakes left by a crash/restart (R1). Called after server boot.
function drainPendingWakesOnStartup() {
  const rows = db.prepare('SELECT id FROM pending_wakes ORDER BY id').all();
  if (rows.length) console.log(`[wake] draining ${rows.length} pending wake(s) from prior run`);
  for (const r of rows) drainWake(r.id).catch(e => console.error('[wake] startup drain error:', e.message));
}

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// Initialize schema on startup
try {
  db.exec(fs.readFileSync(path.join(__dirname, 'db', 'schema.sqlite.sql'), 'utf8'));
} catch (e) {
  console.error('[schema] init warning (non-fatal):', e.message);
}

// ─── Migration runner ─────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

// Seed old inline migrations as already-applied for existing DBs
const _seedMigrations = [
  { filename: '20260590-migrate-ai-sessions-unique.sql', applied: () => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'").get();
    return !!(tbl?.sql && !tbl.sql.includes('participant_id INTEGER NOT NULL UNIQUE'));
  }},
  { filename: '20260591-add-agent-workdirs-model.sql', applied: () => {
    const cols = db.prepare("PRAGMA table_info(agent_workdirs)").all().map(c => c.name);
    return cols.includes('model');
  }},
  { filename: '20260592-add-rooms-archived-at.sql', applied: () => {
    const cols = db.prepare("PRAGMA table_info(rooms)").all().map(c => c.name);
    return cols.includes('archived_at');
  }},
  { filename: '20260601-add-system-event-state.sql', applied: () => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
    return !!(tbl?.sql?.includes('system_event'));
  }},
  { filename: '20260602-clean-duplicate-settings.sql', applied: () => true },
  { filename: '20260609-automation-connections.sql', applied: () => {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_connections'").get();
    const cols = db.prepare('PRAGMA table_info(automations)').all().map(c => c.name);
    return !!(hasTable && cols.includes('connection_id'));
  }},
];
for (const m of _seedMigrations) {
  if (!db.prepare('SELECT 1 FROM migrations WHERE filename=?').get(m.filename) && m.applied()) {
    db.prepare('INSERT OR IGNORE INTO migrations (filename) VALUES (?)').run(m.filename);
  }
}

// Run pending migrations from migrations/ folder
try {
  const migFiles = fs.readdirSync(path.join(__dirname, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const filename of migFiles) {
    if (db.prepare('SELECT 1 FROM migrations WHERE filename=?').get(filename)) continue;
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', filename), 'utf8');
    try {
      db.exec('BEGIN TRANSACTION');
      db.exec(sql);
      db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(filename);
      db.exec('COMMIT');
      console.log(`[migration] applied: ${filename}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      console.error(`[migration] failed: ${filename} —`, e.message);
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[migration] runner error:', e.message);
}


// ─── Auth: password hashing & session management ─────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function createAuthSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return { token, expires };
}

function validateAuthSession(token) {
  if (!token) return null;
  const row = db.prepare("SELECT s.*, u.email FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')").get(token);
  return row || null;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

// Seed default auth user
{
  const existing = db.prepare('SELECT id FROM auth_users LIMIT 1').get();
  if (!existing) {
    const hash = hashPassword('stoa2026!');
    db.prepare('INSERT INTO auth_users (email, password_hash) VALUES (?,?)').run('stoa@stoa.com', hash);
    console.log('[auth] Default user seeded: stoa@stoa.com');
  }
}

// Cleanup expired sessions periodically
setInterval(() => {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
}, 3600_000);

// Rebuild FTS index on startup
{
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
}

const PORT = parseInt(process.env.PORT) || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONNECTOR_MEDIA_DIR = path.join(__dirname, 'connector-media');

// Sync HUMAN_NAME env → human actor on startup (default: "Human")
{
  const humanName = process.env.HUMAN_NAME || 'Human';
  const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
  if (human) db.prepare('UPDATE actors SET name=? WHERE id=?').run(humanName, human.id);
}

// Files yang boleh di-serve sebagai client update
const CLIENT_FILES = new Set(['stoa.js', 'claude-session.js']);

// One-time install tokens (expires in 10 min)
const installTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, v] of installTokens) if (v.expires < now) installTokens.delete(t);
}, 60_000);

function clientFileHash(name) {
  const fp = clientFilePath(name);
  if (!fs.existsSync(fp)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 12);
}
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(CONNECTOR_MEDIA_DIR)) fs.mkdirSync(CONNECTOR_MEDIA_DIR);

// ── Scheduled cleanup: delete uploaded files older than CLEANUP_MAX_AGE_HOURS (skip avatar/)
{
  const CLEANUP_HOUR = parseInt(process.env.CLEANUP_CRON_HOUR) || 10;
  const CLEANUP_MAX_AGE = (parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 24) * 3600_000;

  const cleanupUploads = () => {
    const now = Date.now();
    let count = 0;
    for (const entry of fs.readdirSync(UPLOADS_DIR)) {
      if (entry === 'avatar') continue;
      const fp = path.join(UPLOADS_DIR, entry);
      const stat = fs.statSync(fp);
      if (stat.isFile() && (now - stat.mtimeMs) > CLEANUP_MAX_AGE) {
        fs.unlinkSync(fp);
        count++;
      }
    }
    if (count) console.log(`[cleanup] Deleted ${count} expired file(s) from uploads/`);
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(CLEANUP_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => { cleanupUploads(); scheduleNext(); }, next - now);
  };
  scheduleNext();
}

// ── Phase 6: proactive scheduler ───────────────────────────────────────────
// Fires persistent sub-agents on a schedule (interval | daily) with no
// @mention / orchestrator in the loop. A scheduled fire reuses the SAME
// resolve→validate→triggerAiResponse path as POST /sub-agent-trigger, but is
// server-initiated: no spawn_token is issued, so the sub-agent stays depth=1.
//
// Design decisions (documented to pre-empt audit findings):
//   • Re-entrancy: recursive setTimeout, not setInterval — the next tick is
//     scheduled only after the current one returns, so ticks never stack.
//   • Claim-before-fire: next_run_at is advanced BEFORE firing, so a crash or
//     slow fire can never double-fire the same slot.
//   • Skip-missed: next_run_at is recomputed from `now`, never catch-up. A long
//     downtime yields one future slot, not a backlog burst (thundering herd).
//   • Re-resolve fresh each tick: sub-agent may have been deleted/disabled/
//     unlinked since the schedule was created — never cache; run the SAME
//     validation as the interactive trigger (archived / paused / concurrent cap
//     / parent online).
//   • Grace retry (D2): a TRANSIENT skip (parent offline / concurrency full /
//     self-overlap) provably did not dispatch, so next_run_at is pulled back to
//     now+SCHED_RETRY_MS — but never past the natural next slot. This keeps a
//     `daily` schedule from being lost for a whole day just because the machine
//     was offline at that minute, without risking a double-fire (nothing ran).
//     Non-transient skips (archived / paused / unlinked) keep the far next slot.
//   • Rate limiting: the interval floor (≥5 min) + concurrent cap + self-overlap
//     guard bound cadence. The interactive endpoint's hourly max_spawns_per_hour
//     is an ORCHESTRATOR fan-out guard (counts parent_message_id spawns) and does
//     not apply to server-initiated cadence runs, which are self-limiting.
//   • Failure isolation: try/catch per schedule; one bad row never kills the loop.
const SCHED_TICK_MS = parseInt(process.env.SCHED_TICK_MS) || 30000;
const SCHED_RETRY_MS = parseInt(process.env.SCHED_RETRY_MS) || 120000; // grace retry after transient skip
const fmtUtc = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

// Attempt one scheduled fire. Returns a short status string; never throws.
function fireSchedule(sched) {
  const room = db.prepare('SELECT id, archived_at, spawns_paused, max_sub_agents FROM rooms WHERE id=?').get(sched.room_id);
  if (!room) return 'room_gone';
  if (room.archived_at) return 'archived';
  if (room.spawns_paused) return 'paused';
  // Fresh resolve: still exists, enabled, and linked to THIS room.
  const sub = db.prepare(`
    SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
    WHERE rsa.room_id=? AND sa.id=? AND sa.enabled=1
  `).get(sched.room_id, sched.sub_agent_id);
  if (!sub) return 'unlinked_or_disabled';
  const parentPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(sched.room_id, sub.parent_actor_id);
  if (!parentPart) return 'parent_not_participant';
  // Concurrent cap — identical to the interactive trigger.
  const running = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'"
  ).get(sched.room_id).c;
  if (running >= room.max_sub_agents) return 'max_concurrent';
  // Self-overlap: don't stack a new run on top of this sub-agent's in-flight one.
  const selfRunning = db.prepare(
    "SELECT 1 FROM messages WHERE room_id=? AND sub_agent_id=? AND state='streaming'"
  ).get(sched.room_id, sched.sub_agent_id);
  if (selfRunning) return 'self_overlap';
  // Parent machine must be online to run the sub-agent.
  const parentWs = agentClients.get(sub.parent_actor_id);
  if (!parentWs || parentWs.readyState !== 1) return 'parent_offline';

  const ai = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.id=?
  `).get(parentPart.id);
  ai.sub_agent = { id: sub.id, label: sub.label, tier: sub.tier, model: sub.model, workdir: sub.workdir, system_prompt: sub.system_prompt };
  ai.parent_message_id = null; // standalone run — no orchestrator turn to auto-wake
  triggerAiResponse(sched.room_id, ai, sched.task, null, []).catch(e => console.error('[scheduler] trigger error:', e.message));
  return 'fired';
}

function schedulerTick() {
  let due;
  try {
    due = db.prepare(
      "SELECT * FROM sub_agent_schedules WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= datetime('now') ORDER BY next_run_at LIMIT 50"
    ).all();
  } catch (e) { console.error('[scheduler] query error:', e.message); return; }
  const now = new Date();
  for (const sched of due) {
    try {
      const specRes = validateScheduleSpec(JSON.parse(sched.schedule_spec));
      if (!specRes.ok) {
        // Corrupt/unknown spec: disable so it can't spin every tick.
        db.prepare('UPDATE sub_agent_schedules SET enabled=0, next_run_at=NULL WHERE id=?').run(sched.id);
        console.error(`[scheduler] schedule ${sched.id} disabled — bad spec: ${specRes.error}`);
        continue;
      }
      // Claim-before-fire: advance next_run_at to the far next slot FIRST, so a
      // crash mid-dispatch can never double-fire.
      const nextSlot = computeNextRun(specRes.spec, now);
      db.prepare('UPDATE sub_agent_schedules SET next_run_at=? WHERE id=?').run(fmtUtc(nextSlot), sched.id);
      const status = fireSchedule(sched);
      if (status === 'fired') {
        db.prepare("UPDATE sub_agent_schedules SET last_run_at=datetime('now'), last_error=NULL WHERE id=?").run(sched.id);
      } else {
        // Transient skips (nothing dispatched) get pulled back for a grace retry,
        // capped at nextSlot; other skips keep the far slot (see nextRunAfterSkip).
        const retryAt = nextRunAfterSkip(status, nextSlot, now, SCHED_RETRY_MS);
        if (retryAt.getTime() < nextSlot.getTime()) {
          db.prepare('UPDATE sub_agent_schedules SET next_run_at=? WHERE id=?').run(fmtUtc(retryAt), sched.id);
          console.log(`[scheduler] schedule ${sched.id} skipped: ${status} — retry ~${fmtUtc(retryAt)}`);
        } else {
          console.log(`[scheduler] schedule ${sched.id} skipped: ${status}`);
        }
      }
    } catch (e) {
      console.error(`[scheduler] schedule ${sched.id} error:`, e.message);
      try { db.prepare('UPDATE sub_agent_schedules SET last_error=? WHERE id=?').run(e.message.slice(0, 500), sched.id); } catch {}
    }
  }
}

// R18: GC nebeng scheduler tick — throttle 6 jam, async, errors swallowed to log.
// Split audit (read-only verdict) from reclaim (mutasi) for dry-run-ability.
const GC_INTERVAL_MS = 6 * 3600_000;
let _gcLastRun = 0;

function auditUploads() {
  // Collect all URLs referenced by DB — messages, avatars.
  const referenced = new Set();
  for (const row of db.prepare("SELECT image_url FROM messages WHERE image_url IS NOT NULL").all())
    referenced.add(row.image_url);
  for (const row of db.prepare("SELECT file_url FROM messages WHERE file_url IS NOT NULL").all())
    referenced.add(row.file_url);
  for (const row of db.prepare("SELECT json_each.value FROM messages, json_each(messages.attachments) WHERE messages.attachments IS NOT NULL").all())
    try { const a = JSON.parse(row.value); if (a?.url) referenced.add(a.url); } catch {}
  for (const row of db.prepare("SELECT avatar_url FROM actors WHERE avatar_url IS NOT NULL").all())
    referenced.add(row.avatar_url);

  const orphans = [];
  try {
    for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const rel = `/uploads/${entry.name}`;
      if (!referenced.has(rel)) orphans.push({ path: path.join(UPLOADS_DIR, entry.name), url: rel });
    }
  } catch (e) { console.error('[gc] auditUploads scan error:', e.message); }
  return orphans;
}

function reclaimUploads(orphans) {
  let count = 0;
  for (const { path: fp } of orphans) {
    try { fs.unlinkSync(fp); count++; } catch (e) { console.error('[gc] delete error:', fp, e.message); }
  }
  return count;
}

function gcTick() {
  const now = Date.now();
  if (now - _gcLastRun < GC_INTERVAL_MS) return;
  _gcLastRun = now;
  // Run async — GC must never block scheduler tick
  setImmediate(() => {
    try {
      const orphans = auditUploads();
      if (orphans.length) {
        const deleted = reclaimUploads(orphans);
        console.log(`[gc] reclaimed ${deleted} orphaned upload(s)`);
      }
    } catch (e) { console.error('[gc] tick error:', e.message); }
  });
}

// Gate the loop off under test (NODE_ENV=test) — integration tests drive the
// CRUD API directly and must not have the loop firing real triggers underneath.
if (process.env.NODE_ENV !== 'test') {
  (function scheduleLoop() {
    setTimeout(() => {
      try { schedulerTick(); } catch (e) { console.error('[scheduler] tick error:', e.message); }
      try { gcTick(); } catch (e) { console.error('[gc] tick error:', e.message); }
      scheduleLoop();
    }, SCHED_TICK_MS);
  })();
}

const _settingCache = new Map();
function getSetting(key, scopeId = null) {
  const cacheKey = `${key}:${scopeId}`;
  const cached = _settingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1000) return cached.value;
  if (cached) _settingCache.delete(cacheKey);
  const scope = scopeId ? 'room' : 'global';
  const row = db.prepare(
    'SELECT value FROM settings WHERE scope=? AND (scope_id=? OR scope_id IS NULL) AND key_name=? ORDER BY scope DESC LIMIT 1'
  ).get(scope, scopeId, key);
  const value = row?.value ?? null;
  _settingCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}
function getParsedSetting(key) {
  const cacheKey = `${key}:null:parsed`;
  const cached = _settingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1000) return cached.value;
  if (cached) _settingCache.delete(cacheKey);
  const raw = getSetting(key);
  const value = raw ? JSON.parse(raw) : null;
  _settingCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}

function setSetting(key, value) {
  for (const k of _settingCache.keys()) { if (k.startsWith(key + ':')) _settingCache.delete(k); }
  const existing = db.prepare("SELECT id FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name=?").get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value=? WHERE id=?').run(value, existing.id);
  } else {
    db.prepare("INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('global', NULL, ?, ?)").run(key, value);
  }
}

// R23: room-scoped settings. value=null deletes the entry.
const ALLOWED_ROOM_SETTINGS = new Set(['tool_status_mode', 'busy_input_mode']);
const ROOM_SETTING_VALUES = {
  tool_status_mode: new Set(['full', 'verb', 'off']),
  busy_input_mode:  new Set(['interrupt', 'queue', 'steer']),
};
function setRoomSetting(roomId, key, value) {
  for (const k of _settingCache.keys()) { if (k.startsWith(`${key}:${roomId}`)) _settingCache.delete(k); }
  const existing = db.prepare("SELECT id FROM settings WHERE scope='room' AND scope_id=? AND key_name=?").get(roomId, key);
  if (value === null) {
    if (existing) db.prepare('DELETE FROM settings WHERE id=?').run(existing.id);
  } else if (existing) {
    db.prepare('UPDATE settings SET value=? WHERE id=?').run(value, existing.id);
  } else {
    db.prepare("INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('room', ?, ?, ?)").run(roomId, key, value);
  }
}

function getPlatKeys(plat) {
  return plat.api_keys?.length ? plat.api_keys : (plat.api_key ? [plat.api_key] : []);
}

async function isOllamaDaemonUrl(baseUrl) {
  try {
    const r = await fetch(new URL(baseUrl).origin + '/api/version', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    return d != null && typeof d.version === 'string';
  } catch { return false; }
}

function getPublicUrl(fallbackHost) {
  const dbVal = getSetting('public_url');
  if (dbVal) return dbVal;
  const envVal = process.env.STOA_PUBLIC_URL;
  if (envVal) {
    try {
      const u = new URL(envVal);
      if (!u.port) u.port = PORT;
      return u.origin;
    } catch { return envVal; }
  }
  return `http://${fallbackHost}`;
}

function writeEnv(key, value) {
  const envFile = path.join(__dirname, '.env');
  let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const re = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, () => `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(envFile, content, 'utf8');
}

function docTitle(filePath) {
  try {
    const first = fs.readFileSync(filePath, 'utf8').split('\n').find(l => l.startsWith('# '));
    return first ? first.slice(2).trim() : path.basename(filePath, '.md');
  } catch { return path.basename(filePath, '.md'); }
}

// Parse "doc-tailscale.en.md" → { slug: "doc-tailscale", lang: "en" }
// Falls back: "doc-tailscale.md" → { slug: "doc-tailscale", lang: "en" }
function parseDocFilename(name) {
  const m = name.match(/^(.+)\.([a-z]{2})\.md$/);
  if (m) return { slug: m[1], lang: m[2] };
  if (name.endsWith('.md')) return { slug: name.slice(0, -3), lang: 'en' };
  return null;
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

const AUTH_EXEMPT = new Set(['/api/auth/login', '/favicon.ico']);
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

function cookieFlags(req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function serveIndex() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  if (IS_PROD && fs.existsSync(path.join(PUBLIC_DIR, 'dist', 'stoa.min.css'))) {
    html = html.replace(/<!-- \{\{APP_CSS\}\} -->[\s\S]*?<!-- \{\{\/APP_CSS\}\} -->/, '<link rel="stylesheet" href="/dist/stoa.min.css">');
    html = html.replace(/<!-- \{\{APP_JS\}\} -->[\s\S]*?<!-- \{\{\/APP_JS\}\} -->/, '<script src="/dist/stoa.min.js"></script>');
  }
  return html;
}

function requireAuth(req, res, url) {
  if (AUTH_EXEMPT.has(url.pathname)) return true;
  // Static assets from public/ (CSS, JS, manifest, icons, SW)
  if (url.pathname.match(/^\/(css|js|vendor|dist)\//) || ['/manifest.json', '/sw.js', '/stoa-icon.svg'].includes(url.pathname)) return true;
  // Uploaded files accessible by agents (they fetch without cookies)
  if (url.pathname.startsWith('/uploads/')) return true;
  // Connector media files (WA downloads) accessible without cookie auth
  if (url.pathname.startsWith('/connector-media/')) return true;
  // Install scripts and agent register are public (token-protected already)
  if (url.pathname === '/install.sh' || url.pathname === '/install.ps1' || url.pathname === '/install.cmd') return true;
  if (url.pathname === '/api/agent/register') return true;
  // Client file API used by agents for auto-update
  if (url.pathname === '/api/client/manifest' || url.pathname.startsWith('/api/client/file/')) return true;
  // Ollama Cloud proxy — called by Claude Code SDK which sends a Bearer token, not a browser cookie.
  // Auth relies on Stoa's trusted-network model (Tailscale): same as /api/agent/register.
  // The bearer token encodes platform_id (stoa-proxy:<id>) but is NOT a secret — do not treat it as one.
  if (url.pathname === '/v1/messages') return true;

  // Agent HTTP auth via headers (for upload etc.)
  const agentId = req.headers['x-agent-id'];
  const agentSecret = req.headers['x-agent-secret'];
  if (agentId && agentSecret) {
    const actor = db.prepare('SELECT secret FROM actors WHERE id=? AND type=?').get(agentId, 'ai');
    if (actor?.secret) {
      const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
      if (crypto.timingSafeEqual(h(agentSecret), h(actor.secret))) return true;
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = validateAuthSession(cookies.stoa_session);
  if (session) { req._authUser = session; return true; }

  // Not authenticated
  if (url.pathname === '/' || !url.pathname.startsWith('/api/')) {
    // Serve login page for HTML requests
    return 'login';
  }
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function updateConnStatus(id, status, errorMsg, meta) {
  const md = JSON.stringify(meta || {});
  db.prepare("UPDATE automation_connections SET status=?, error_msg=?, metadata=?, updated_at=datetime('now') WHERE id=?")
    .run(status, errorMsg || null, md, id);
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Auth check ──
  const authResult = requireAuth(req, res, url);
  if (authResult === false) return;
  if (authResult === 'login') {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(serveIndex());
    }
    res.writeHead(401); return res.end('Unauthorized');
  }

  // ── Auth routes (exempt from auth check above) ──
  if (req.method === 'POST' && url.pathname === '/api/client-error') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (data) {
      const sanitize = (s) => String(s || '').replace(/[\r\n]/g, ' ').slice(0, 2000);
      const line = `[${new Date().toISOString()}] ${sanitize(data.message)} | ${sanitize(data.source)}\n`;
      try { fs.appendFileSync(path.join(__dirname, '.claude', 'client-errors.log'), line); } catch {}
      console.log('[client-error]', sanitize(data.message));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { email, password } = data;
    const user = db.prepare('SELECT * FROM auth_users WHERE email=?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid email or password' }));
    }
    const session = createAuthSession(user.id);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `stoa_session=${session.token}; ${cookieFlags(req)}; Max-Age=${7*24*3600}`,
    });
    return res.end(JSON.stringify({ ok: true, email: user.email }));
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.stoa_session) {
      db.prepare('DELETE FROM auth_sessions WHERE token=?').run(cookies.stoa_session);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `stoa_session=; ${cookieFlags(req)}; Max-Age=0`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = db.prepare('SELECT id, email FROM auth_users WHERE id=?').get(req._authUser.user_id);
    return json(res, user || {});
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/email') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { email } = data;
    if (!email?.trim() || !email.includes('@')) { res.writeHead(400); return res.end('invalid email'); }
    try {
      db.prepare('UPDATE auth_users SET email=? WHERE id=?').run(email.trim(), req._authUser.user_id);
    } catch { res.writeHead(409); return res.end('email already in use'); }
    return json(res, { ok: true, email: email.trim() });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/password') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { current_password, new_password } = data;
    if (!new_password || new_password.length < 6) { res.writeHead(400); return res.end('password must be at least 6 characters'); }
    const user = db.prepare('SELECT * FROM auth_users WHERE id=?').get(req._authUser.user_id);
    if (!verifyPassword(current_password, user.password_hash)) {
      res.writeHead(401); return res.end('current password incorrect');
    }
    const hash = hashPassword(new_password);
    db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash, user.id);
    // Invalidate all other sessions
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token!=?').run(user.id, req._authUser.token);
    return json(res, { ok: true });
  }

  // ── Static: uploaded files
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const relative = path.normalize(url.pathname.slice('/uploads/'.length)).replace(/^(\.\.[\/\\])+/, '');
    const filepath = path.join(UPLOADS_DIR, relative);
    if (!filepath.startsWith(UPLOADS_DIR) || !fs.existsSync(filepath)) { res.writeHead(404); return res.end('Not found'); }
    const filename = path.basename(filepath);
    const ext = path.extname(filename).toLowerCase();
    const MIMES = {
      '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
      '.gif':'image/gif', '.webp':'image/webp',
      '.md':'text/markdown; charset=utf-8', '.txt':'text/plain; charset=utf-8',
      '.pdf':'application/pdf', '.json':'application/json; charset=utf-8',
      '.html':'text/html; charset=utf-8', '.csv':'text/csv; charset=utf-8',
      '.js':'text/javascript; charset=utf-8', '.ts':'text/plain; charset=utf-8',
    };
    const mime = MIMES[ext] || 'application/octet-stream';
    const disp = mime.startsWith('text/') || mime.includes('json') ? 'inline' : 'attachment';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': disp });
    return res.end(fs.readFileSync(filepath));
  }

  // ── Static: connector media files (WA downloads, etc.)
  if (req.method === 'GET' && url.pathname.startsWith('/connector-media/')) {
    const relative = path.normalize(url.pathname.slice('/connector-media/'.length)).replace(/^(\.\.[\/\\])+/, '');
    const filepath = path.join(CONNECTOR_MEDIA_DIR, relative);
    if (!filepath.startsWith(CONNECTOR_MEDIA_DIR + path.sep) || !fs.existsSync(filepath)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filepath).toLowerCase();
    const MIMES = {
      '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
      '.gif':'image/gif', '.webp':'image/webp',
      '.mp4':'video/mp4', '.mp3':'audio/mpeg', '.ogg':'audio/ogg',
      '.pdf':'application/pdf', '.txt':'text/plain; charset=utf-8',
    };
    const mime = MIMES[ext] || 'application/octet-stream';
    const disp = mime.startsWith('text/') ? 'inline' : 'attachment';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': disp });
    return res.end(fs.readFileSync(filepath));
  }

  // ── Upload file (raw binary)
  if (req.method === 'POST' && url.pathname === '/api/upload/raw') {
    const MAX_UPLOAD = 25 * 1024 * 1024;
    const chunks = [];
    let size = 0;
    await new Promise((resolve, reject) => {
      req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); reject(new Error('File too large')); } else chunks.push(c); });
      req.on('end', resolve);
      req.on('error', reject);
    }).catch(e => { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); return; });
    if (res.headersSent) return;
    const buffer = Buffer.concat(chunks);
    const fileName = decodeURIComponent(req.headers['x-file-name'] || 'file');
    const mimeType = req.headers['content-type'] || 'application/octet-stream';
    const origExt = fileName ? path.extname(fileName).toLowerCase() : null;
    const mimeToExt = { 'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp',
      'text/markdown':'.md','text/plain':'.txt','application/pdf':'.pdf','application/json':'.json' };
    const ext = origExt || mimeToExt[mimeType] || '.' + (mimeType.split('/')[1] || 'bin');
    const safeExt = ext.startsWith('.') ? ext : '.' + ext;
    const saved = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    const savedPath = path.join(UPLOADS_DIR, saved);
    try { fs.writeFileSync(savedPath, buffer); } catch { res.writeHead(500); return res.end(JSON.stringify({ error: 'Failed to save file' })); }
    return json(res, { url: `/uploads/${saved}`, name: fileName || saved });
  }

  // ── Actor avatar upload
  const avatarUploadMatch = req.method === 'POST' && url.pathname.match(/^\/api\/actors\/(\d+)\/avatar$/);
  if (avatarUploadMatch) {
    const id = parseInt(avatarUploadMatch[1]);
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { data_url } = data;
    if (!data_url || !data_url.startsWith('data:image/')) { res.writeHead(400); return res.end('invalid data_url'); }
    const mimeMatch = data_url.match(/^data:(image\/[a-z+]+);base64,/);
    if (!mimeMatch) { res.writeHead(400); return res.end('invalid data_url format'); }
    const mimeType = mimeMatch[1];
    const mimeToExt = { 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp' };
    const ext = mimeToExt[mimeType] || 'png';
    const base64Data = data_url.slice(data_url.indexOf(',') + 1);
    const oldAvatar = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (oldAvatar?.avatar_url) {
      const oldPath = path.join(__dirname, oldAvatar.avatar_url.replace(/^\//, ''));
      if (oldPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const saved = `avatar-${id}-${Date.now()}.${ext}`;
    const avatarDir = path.join(UPLOADS_DIR, 'avatar');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir);
    fs.writeFileSync(path.join(avatarDir, saved), Buffer.from(base64Data, 'base64'));
    const avatarUrl = `/uploads/avatar/${saved}`;
    db.prepare('UPDATE actors SET avatar_url=? WHERE id=?').run(avatarUrl, id);
    return json(res, { avatar_url: avatarUrl });
  }

  // ── Actor avatar delete
  const avatarDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/actors\/(\d+)\/avatar$/);
  if (avatarDeleteMatch) {
    const id = parseInt(avatarDeleteMatch[1]);
    const actor = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (actor?.avatar_url) {
      const oldPath = path.join(__dirname, actor.avatar_url.replace(/^\//, ''));
      if (oldPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    db.prepare('UPDATE actors SET avatar_url=NULL WHERE id=?').run(id);
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 145"><rect x="15" y="0" width="230" height="10" fill="#2e2820"/><rect x="50" y="60" width="40" height="70" fill="#5b8fd4"/><rect x="110" y="40" width="40" height="90" fill="#8a7660"/><rect x="170" y="20" width="40" height="110" fill="#d39749"/><rect x="15" y="130" width="230" height="10" fill="#2e2820"/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(svg);
  }

  // Serve static files from public/
  const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  if (req.method === 'GET') {
    const isRoot = url.pathname === '/';
    const ext = isRoot ? '.html' : path.extname(url.pathname);
    if (STATIC_TYPES[ext]) {
      if (isRoot) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(serveIndex());
      }
      const filePath = path.join(PUBLIC_DIR, url.pathname);
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(PUBLIC_DIR) && fs.existsSync(resolved)) {
        const cachePolicy = (ext === '.svg' || ext === '.json') ? 'public, max-age=86400' : 'no-cache';
        res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext], 'Cache-Control': cachePolicy });
        return res.end(fs.readFileSync(resolved));
      }
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const archived = url.searchParams.get('archived') === '1';
    const rows = db.prepare(`
      SELECT r.*, a.name as creator_name,
        (SELECT COUNT(*) FROM room_participants WHERE room_id=r.id) as participant_count,
        (SELECT COUNT(*) FROM messages WHERE room_id=r.id) as message_count,
        (SELECT m.content FROM messages m WHERE m.room_id=r.id AND m.state='complete' AND m.content != '' ORDER BY m.id DESC LIMIT 1) as last_message,
        (SELECT a2.name FROM messages m2 JOIN room_participants rp ON rp.id=m2.participant_id JOIN actors a2 ON a2.id=rp.actor_id WHERE m2.room_id=r.id AND m2.state='complete' AND m2.content != '' ORDER BY m2.id DESC LIMIT 1) as last_message_actor,
        COALESCE((SELECT m3.created_at FROM messages m3 WHERE m3.room_id=r.id ORDER BY m3.id DESC LIMIT 1), r.created_at) as last_activity
      FROM rooms r JOIN actors a ON a.id=r.created_by LEFT JOIN agent_workdirs w ON w.id=r.workdir_id
      WHERE ${archived ? 'r.archived_at IS NOT NULL' : 'r.archived_at IS NULL'}
      ORDER BY r.is_pinned DESC, last_activity DESC
      LIMIT 200
    `).all();
    return json(res, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms/participants') {
    const ids = (url.searchParams.get('ids') || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return json(res, {});
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT rp.room_id, rp.*, a.name, a.type, a.avatar_color, a.avatar_symbol, a.avatar_url, a.adapter
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id IN (${ph})
    `).all(...ids);
    const grouped = {};
    for (const r of rows) { (grouped[r.room_id] ||= []).push(r); }
    return json(res, grouped);
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { title, participant_ids = [], workdir_id = null } = data;
    if (!workdir_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir_id is required' })); }
    const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
    const humanId = human?.id ?? 1;
    const allIds = [...new Set([humanId, ...participant_ids])];
    // Validate the workdir exists and belongs to one of the participants before creating the
    // room — mirrors the ownership check on POST /api/rooms/:id/participants and prevents a
    // dangling rooms.workdir_id whose participant assignment would otherwise silently no-op.
    const wdOwner = db.prepare('SELECT actor_id FROM agent_workdirs WHERE id=?').get(workdir_id);
    if (!wdOwner) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir not found' })); }
    if (!allIds.includes(wdOwner.actor_id)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir must belong to one of the participants' })); }
    // Every AI participant must be online at creation time — a room is only useful with an
    // agent that can actually respond, and an offline agent can't be "prepared ahead". Human
    // participants are never gated (they hold no agent connection). The frontend mirrors this
    // by disabling offline agents; enforced here too because the API can be called directly.
    if (participant_ids.length) {
      const ph = participant_ids.map(() => '?').join(',');
      const agentRows = db.prepare(`SELECT id, name FROM actors WHERE type='ai' AND id IN (${ph})`).all(...participant_ids);
      const offline = agentRows.filter(a => !agentClients.has(a.id));
      if (offline.length) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `agent offline: ${offline.map(a => a.name).join(', ')}` }));
      }
    }
    const result = db.prepare('INSERT INTO rooms (title, created_by, workdir_id) VALUES (?,?,?)').run(title, humanId, workdir_id);
    const roomId = result.lastInsertRowid;
    const insertParticipant = db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id) VALUES (?,?)');
    db.transaction((ids) => { for (const id of ids) insertParticipant.run(roomId, id); })(allIds);
    // Assign the room's workdir to the participant that owns it (the chosen agent), so every
    // participant carries an explicit workdir_id — consistent with the backfill migration.
    db.prepare('UPDATE room_participants SET workdir_id=? WHERE room_id=? AND actor_id=?').run(workdir_id, roomId, wdOwner.actor_id);
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
    console.log(`[server] Room created id=${roomId}, broadcasting to ${globalClients.size} clients`);
    broadcastGlobal({ type: 'room_created', room });
    return json(res, room);
  }

  const roomPatchMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomPatchMatch) {
    const roomId = parseInt(roomPatchMatch[1]);
    const body = await readBody(req);
    const parsed = parseJsonBody(body);
    if (!parsed) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    if (parsed.title) {
      db.prepare('UPDATE rooms SET title=? WHERE id=?').run(parsed.title.trim(), roomId);
      broadcastGlobal({ type: 'room_updated', room_id: roomId, title: parsed.title.trim() });
    }
    if (parsed.archived === true) {
      db.prepare("UPDATE rooms SET archived_at=datetime('now'), is_pinned=0 WHERE id=?").run(roomId);
      broadcastGlobal({ type: 'room_archived', room_id: roomId });
    }
    if (parsed.archived === false) {
      db.prepare('UPDATE rooms SET archived_at=NULL WHERE id=?').run(roomId);
      broadcastGlobal({ type: 'room_restored', room_id: roomId });
    }
    // Phase 2b: sub-agent budget (clamped to sane ranges)
    if (Number.isInteger(parsed.max_sub_agents)) {
      const v = Math.max(1, Math.min(10, parsed.max_sub_agents));
      db.prepare('UPDATE rooms SET max_sub_agents=? WHERE id=?').run(v, roomId);
    }
    if (Number.isInteger(parsed.max_spawns_per_hour)) {
      const v = Math.max(1, Math.min(100, parsed.max_spawns_per_hour));
      db.prepare('UPDATE rooms SET max_spawns_per_hour=? WHERE id=?').run(v, roomId);
    }
    // Phase 3: per-room model tier fallback chains. null resets to server defaults.
    // Only known tier keys are kept, each a chain of up to 8 model-name strings.
    if ('model_tiers' in parsed) {
      const mt = parsed.model_tiers;
      if (mt === null) {
        db.prepare('UPDATE rooms SET model_tiers=NULL WHERE id=?').run(roomId);
      } else if (mt && typeof mt === 'object' && !Array.isArray(mt)) {
        const clean = {};
        for (const tier of ['quick', 'standard', 'deep']) {
          const chain = mt[tier];
          if (Array.isArray(chain)) {
            const models = chain.filter(m => typeof m === 'string' && m.trim() && m.length <= 200).slice(0, 8);
            if (models.length) clean[tier] = models;
          }
        }
        db.prepare('UPDATE rooms SET model_tiers=? WHERE id=?').run(Object.keys(clean).length ? JSON.stringify(clean) : null, roomId);
      } else {
        return json(res, { error: 'model_tiers must be an object or null' }, 400);
      }
    }
    return json(res, { ok: true });
  }

  const roomPinMatch = req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/(\d+)\/pin$/);
  if (roomPinMatch) {
    const roomId = parseInt(roomPinMatch[1]);
    const pinErr = db.transaction(() => {
      const room = db.prepare("SELECT id, is_pinned FROM rooms WHERE id=? AND archived_at IS NULL").get(roomId);
      if (!room) return 'not_found';
      if (room.is_pinned) return 'already_pinned';
      const pinCount = db.prepare("SELECT COUNT(*) as cnt FROM rooms WHERE is_pinned=1 AND archived_at IS NULL").get().cnt;
      const maxPin = parseInt(process.env.MAX_PINNED_ROOMS) || 3; if (pinCount >= maxPin) return 'limit';
      db.prepare("UPDATE rooms SET is_pinned=1 WHERE id=?").run(roomId);
      return null;
    })();
    if (pinErr === 'not_found') return json(res, { error: 'Room not found' }, 404);
    const maxPinDisplay = parseInt(process.env.MAX_PINNED_ROOMS) || 3; if (pinErr === 'limit') return json(res, { error: `Maximum ${maxPinDisplay} pinned rooms reached` }, 400);
    broadcastGlobal({ type: 'room_pinned', room_id: roomId });
    return json(res, { ok: true });
  }

  const roomUnpinMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/(\d+)\/pin$/);
  if (roomUnpinMatch) {
    const roomId = parseInt(roomUnpinMatch[1]);
    const room = db.prepare("SELECT id, is_pinned FROM rooms WHERE id=? AND archived_at IS NULL").get(roomId);
    if (!room) return json(res, { error: 'Room not found' }, 404);
    if (!room.is_pinned) return json(res, { ok: true });
    db.prepare("UPDATE rooms SET is_pinned=0 WHERE id=?").run(roomId);
    broadcastGlobal({ type: 'room_unpinned', room_id: roomId });
    return json(res, { ok: true });
  }

  const roomDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomDeleteMatch) {
    const roomId = parseInt(roomDeleteMatch[1]);
    const participantIds = db.prepare('SELECT id FROM room_participants WHERE room_id=?').all(roomId).map(r => r.id);
    if (participantIds.length) {
      const ph = participantIds.map(() => '?').join(',');
      // Notify agents to delete session files before removing from DB
      const sessions = db.prepare(`
        SELECT s.claude_session_id, s.workdir, rp.actor_id
        FROM ai_sessions s JOIN room_participants rp ON rp.id=s.participant_id
        WHERE rp.room_id=? AND s.claude_session_id IS NOT NULL AND s.workdir IS NOT NULL
      `).all(roomId);
      for (const sess of sessions) {
        const agentWs = agentClients.get(sess.actor_id);
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: 'cleanup_session', claude_session_id: sess.claude_session_id, workdir: sess.workdir }));
        }
      }
      db.prepare(`DELETE FROM ai_sessions WHERE participant_id IN (${ph})`).run(...participantIds);
    }
    db.prepare('DELETE FROM invite_suggestions WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM messages WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM room_participants WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
    broadcastGlobal({ type: 'room_deleted', room_id: roomId });
    res.writeHead(204); return res.end();
  }

  const msgDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgDeleteMatch) {
    const msgId = parseInt(msgDeleteMatch[1]);
    const msg = db.prepare('SELECT room_id FROM messages WHERE id=?').get(msgId);
    if (!msg) { res.writeHead(404); return res.end(); }
    db.prepare("INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?, (SELECT content FROM messages WHERE id=?))").run(msgId, msgId);
    db.prepare('DELETE FROM messages WHERE id=?').run(msgId);
    broadcast(msg.room_id, { type: 'message_deleted', message_id: msgId });
    res.writeHead(204); return res.end();
  }

  const msgGetMatch = req.method === 'GET' && url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgGetMatch) {
    const msgId = parseInt(msgGetMatch[1]);
    const row = db.prepare(`
      SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(msgId);
    if (!row) { res.writeHead(404); return res.end(); }
    return json(res, row);
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    const roomId = url.searchParams.get('room_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 100);
    if (!q) return json(res, []);
    const rows = db.prepare(`
      SELECT m.id, m.room_id, m.content, m.created_at,
             a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type,
             r.title as room_title, r.archived_at,
             snippet(messages_fts, 0, '<mark>', '</mark>', '…', 40) as snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN room_participants rp ON rp.id = m.participant_id
      JOIN actors a ON a.id = rp.actor_id
      JOIN rooms r ON r.id = m.room_id
      WHERE messages_fts MATCH ? AND m.state='complete'
      ${roomId ? 'AND m.room_id = ?' : ''}
      ORDER BY rank
      LIMIT ?
    `).all(...(roomId ? [q, roomId, limit] : [q, limit]));
    return json(res, rows);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/')) {
    const roomId = url.pathname.split('/')[3];

    if (url.pathname.endsWith('/messages')) {
      const before = url.searchParams.get('before');
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
      if (before) {
        const rows = db.prepare(`
          SELECT * FROM (
            SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
            FROM messages m
            JOIN room_participants rp ON rp.id=m.participant_id
            JOIN actors a ON a.id=rp.actor_id
            WHERE m.room_id=? AND m.id < ?
              AND (
                (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
                OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
                OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
              )
            ORDER BY m.created_at DESC LIMIT ?
          ) t ORDER BY created_at ASC
        `).all(roomId, before, limit);
        return json(res, enrichReply(rows));
      }
      const since = url.searchParams.get('since') ?? '0';
      const rows = db.prepare(`
        SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
        FROM messages m
        JOIN room_participants rp ON rp.id=m.participant_id
        JOIN actors a ON a.id=rp.actor_id
        WHERE m.room_id=? AND m.id > ?
          AND (
            (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
            OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
            OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
          )
        ORDER BY m.created_at ASC
        LIMIT 500
      `).all(roomId, since);
      return json(res, enrichReply(rows));
    }

    if (url.pathname.endsWith('/participants')) {
      const rows = db.prepare(`
        SELECT rp.*, a.name, a.type, a.avatar_color, a.avatar_symbol, a.avatar_url, a.adapter,
               w.path AS workdir_path, w.label AS workdir_label,
               sess.status AS session_status
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        LEFT JOIN agent_workdirs w ON w.id=rp.workdir_id
        LEFT JOIN ai_sessions sess ON sess.participant_id=rp.id AND sess.sub_agent_id IS NULL
        WHERE rp.room_id=?
      `).all(roomId);
      return json(res, rows);
    }

    if (url.pathname.endsWith('/sub-agents')) {
      const linked = db.prepare(`
        SELECT sa.*, a.name AS parent_name, a.avatar_color, a.avatar_url, rsa.added_at AS linked_at
        FROM room_sub_agents rsa
        JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
        JOIN actors a ON a.id=sa.parent_actor_id
        WHERE rsa.room_id=?
        ORDER BY a.name, sa.label
      `).all(roomId);
      const parentIds = db.prepare(
        "SELECT a.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai'"
      ).all(roomId).map(r => r.id);
      let available = [];
      if (parentIds.length) {
        const ph = parentIds.map(() => '?').join(',');
        const linkedIds = new Set(linked.map(l => l.id));
        available = db.prepare(
          `SELECT sa.*, a.name AS parent_name FROM sub_agents sa JOIN actors a ON a.id=sa.parent_actor_id WHERE sa.parent_actor_id IN (${ph}) AND sa.enabled=1`
        ).all(...parentIds).filter(sa => !linkedIds.has(sa.id));
      }
      return json(res, { linked, available });
    }

    const subPath = url.pathname.split('/').slice(4).join('/');
    if (!subPath) {
      const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
      if (!room) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Room not found' })); }
      return json(res, room);
    }

    if (url.pathname.endsWith('/skills')) {
      const room = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
      if (!room) { res.writeHead(404); return res.end('Room not found'); }
      const agentIds = db.prepare(
        "SELECT a.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai'"
      ).all(roomId).map(r => r.id);
      if (!agentIds.length) return json(res, []);
      const ph = agentIds.map(() => '?').join(',');
      const skills = db.prepare(`
        SELECT s.name, s.description, s.scope, s.actor_id, a.name as actor_name,
               a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM agent_skills s JOIN actors a ON a.id=s.actor_id
        WHERE s.actor_id IN (${ph})
          AND ((s.scope IN ('project','local') AND s.workdir_id = ?) OR s.scope = 'global')
        ORDER BY s.scope, s.name
      `).all(...agentIds, room.workdir_id);
      return json(res, skills);
    }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/participants$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { actor_id, workdir_id = null } = data;
    if (!actor_id) return json(res, { error: 'actor_id required' }, 400);
    const actor = db.prepare('SELECT id, name, type FROM actors WHERE id=?').get(actor_id);
    if (!actor) return json(res, { error: 'actor not found' }, 404);
    // An AI participant must be online to be added — same rule as room creation. Enforced
    // server-side (not just disabled in the UI) since this endpoint can be called directly.
    if (actor.type === 'ai' && !agentClients.has(actor.id)) {
      return json(res, { error: `agent offline: ${actor.name}` }, 409);
    }
    // Validate workdir ownership: a workdir may only be assigned to the agent that owns it.
    if (workdir_id != null) {
      const wd = db.prepare('SELECT id FROM agent_workdirs WHERE id=? AND actor_id=?').get(workdir_id, actor_id);
      if (!wd) return json(res, { error: 'workdir not found for this agent' }, 400);
    }
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id, workdir_id) VALUES (?,?,?)').run(roomId, actor_id, workdir_id);
    // If the participant already existed, update its workdir when a new one is provided.
    if (workdir_id != null) {
      db.prepare('UPDATE room_participants SET workdir_id=? WHERE room_id=? AND actor_id=?').run(workdir_id, roomId, actor_id);
    }
    broadcast(roomId, { type: 'participant_joined', actor_id });
    return json(res, { ok: true });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agents$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);
    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    const { sub_agent_id } = data;
    if (!sub_agent_id) return json(res, { error: 'sub_agent_id required' }, 400);
    const sa = db.prepare('SELECT id, parent_actor_id, label FROM sub_agents WHERE id=?').get(sub_agent_id);
    if (!sa) return json(res, { error: 'sub-agent not found' }, 404);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const parentInRoom = db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, sa.parent_actor_id);
    if (!parentInRoom) return json(res, { error: 'parent agent is not a participant in this room' }, 403);
    const labelCollision = db.prepare(`
      SELECT sa2.label, a.name AS parent_name FROM room_sub_agents rsa
      JOIN sub_agents sa2 ON sa2.id=rsa.sub_agent_id
      JOIN actors a ON a.id=sa2.parent_actor_id
      WHERE rsa.room_id=? AND sa2.label=? AND sa2.parent_actor_id!=?
    `).get(roomId, sa.label, sa.parent_actor_id);
    if (labelCollision) return json(res, { error: `label "${sa.label}" already in this room (from ${labelCollision.parent_name})` }, 409);
    db.prepare('INSERT OR IGNORE INTO room_sub_agents (room_id, sub_agent_id) VALUES (?,?)').run(roomId, sub_agent_id);
    broadcast(roomId, { type: 'sub_agent_linked', room_id: roomId, sub_agent_id });
    return json(res, { ok: true });
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agents\/\d+$/)) {
    const parts = url.pathname.split('/');
    const roomId = parseInt(parts[3]);
    const subAgentId = parseInt(parts[5]);
    db.prepare('DELETE FROM room_sub_agents WHERE room_id=? AND sub_agent_id=?').run(roomId, subAgentId);
    broadcast(roomId, { type: 'sub_agent_unlinked', room_id: roomId, sub_agent_id: subAgentId });
    return json(res, { ok: true });
  }

  // ── R12: schedule doctor — read-only health check per room ──────────────────
  if (req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agent-schedules\/doctor$/)) {
    if (!req._authUser) return json(res, { error: 'human auth required' }, 403);
    const roomId = parseInt(url.pathname.split('/')[3]);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const rows = db.prepare(`
      SELECT s.id, s.sub_agent_id, s.enabled, s.next_run_at, s.last_run_at, s.last_error, s.task,
             sa.label AS sub_agent_label
      FROM sub_agent_schedules s JOIN sub_agents sa ON sa.id=s.sub_agent_id
      WHERE s.room_id=? ORDER BY s.id
    `).all(roomId);
    const linkedIds = new Set(
      db.prepare('SELECT sub_agent_id FROM room_sub_agents WHERE room_id=?').all(roomId).map(r => r.sub_agent_id)
    );
    const overdueMs = 15 * 60 * 1000;
    const nowMs = Date.now();
    const diagnoses = rows.map(s => {
      let status = 'ok';
      let details = null;
      if (!linkedIds.has(s.sub_agent_id)) {
        status = 'unlinked';
        details = 'sub-agent is no longer linked to this room — schedule will not fire';
      } else if (s.enabled && s.next_run_at && (nowMs - new Date(s.next_run_at + 'Z').getTime()) > overdueMs) {
        status = 'overdue';
        details = `next_run_at was ${s.next_run_at} UTC — overdue by more than 15 minutes`;
      } else if (s.last_error) {
        status = 'error';
        details = s.last_error;
      }
      return { schedule_id: s.id, sub_agent_label: s.sub_agent_label, task: s.task, status, details };
    });
    return json(res, { room_id: roomId, diagnoses });
  }

  // ── Phase 6: proactive schedules (human-only — Settings/room UI) ───────────
  // These manage sub_agent_schedules rows; the scheduler loop fires them.
  // Agent-header auth is rejected: only the logged-in human sets up schedules.
  if (url.pathname.match(/^\/api\/rooms\/\d+\/sub-agent-schedules(\/\d+)?$/)) {
    if (!req._authUser) return json(res, { error: 'human auth required' }, 403);
    const parts = url.pathname.split('/');
    const roomId = parseInt(parts[3]);
    const schedId = parts[5] ? parseInt(parts[5]) : null;
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);

    // Task validation identical to the interactive trigger (R4).
    const validTask = (t) => {
      const task = (t || '').trim();
      if (task.length < 10 || /^(test|todo|tbd|placeholder|\.+)$/i.test(task)) return null;
      return task;
    };

    // GET — list schedules for this room (with label for display).
    if (req.method === 'GET' && !schedId) {
      const rows = db.prepare(`
        SELECT s.*, sa.label AS sub_agent_label
        FROM sub_agent_schedules s JOIN sub_agents sa ON sa.id=s.sub_agent_id
        WHERE s.room_id=? ORDER BY s.id
      `).all(roomId);
      for (const r of rows) { try { r.schedule_spec = JSON.parse(r.schedule_spec); } catch { r.schedule_spec = null; } }
      return json(res, { schedules: rows });
    }

    // POST — create a schedule.
    if (req.method === 'POST' && !schedId) {
      const data = parseJsonBody(await readBody(req));
      if (!data) return json(res, { error: 'Invalid JSON' }, 400);
      const subAgentId = parseInt(data.sub_agent_id);
      if (!subAgentId) return json(res, { error: 'sub_agent_id required' }, 400);
      const task = validTask(data.task);
      if (!task) return json(res, { error: 'invalid_task' }, 400);
      const specRes = validateScheduleSpec(data.schedule_spec);
      if (!specRes.ok) return json(res, { error: `invalid_schedule: ${specRes.error}` }, 400);
      // Sub-agent must be linked to this room (implies parent was a participant at link time).
      const sub = db.prepare(`
        SELECT sa.id, sa.parent_actor_id FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
        WHERE rsa.room_id=? AND sa.id=?
      `).get(roomId, subAgentId);
      if (!sub) return json(res, { error: 'sub-agent not in this room' }, 404);
      const human = db.prepare("SELECT id FROM actors WHERE type='human' LIMIT 1").get();
      const nextRun = fmtUtc(computeNextRun(specRes.spec, new Date()));
      const result = db.prepare(`
        INSERT INTO sub_agent_schedules (room_id, sub_agent_id, created_by_actor_id, task, schedule_spec, enabled, next_run_at)
        VALUES (?,?,?,?,?,1,?)
      `).run(roomId, subAgentId, human?.id ?? sub.parent_actor_id, task, JSON.stringify(specRes.spec), nextRun);
      const row = db.prepare('SELECT * FROM sub_agent_schedules WHERE id=?').get(result.lastInsertRowid);
      try { row.schedule_spec = JSON.parse(row.schedule_spec); } catch {}
      broadcast(roomId, { type: 'sub_agent_schedule_changed', room_id: roomId });
      return json(res, { ok: true, schedule: row });
    }

    // PATCH — update task / schedule_spec / enabled.
    if (req.method === 'PATCH' && schedId) {
      const existing = db.prepare('SELECT * FROM sub_agent_schedules WHERE id=? AND room_id=?').get(schedId, roomId);
      if (!existing) return json(res, { error: 'schedule not found' }, 404);
      const data = parseJsonBody(await readBody(req));
      if (!data) return json(res, { error: 'Invalid JSON' }, 400);
      const updates = [];
      const params = [];
      let spec = null;
      try { spec = JSON.parse(existing.schedule_spec); } catch {}
      if (data.task !== undefined) {
        const task = validTask(data.task);
        if (!task) return json(res, { error: 'invalid_task' }, 400);
        updates.push('task=?'); params.push(task);
      }
      if (data.schedule_spec !== undefined) {
        const specRes = validateScheduleSpec(data.schedule_spec);
        if (!specRes.ok) return json(res, { error: `invalid_schedule: ${specRes.error}` }, 400);
        spec = specRes.spec;
        updates.push('schedule_spec=?'); params.push(JSON.stringify(spec));
      }
      let enabled = existing.enabled;
      if (data.enabled !== undefined) {
        enabled = data.enabled ? 1 : 0;
        updates.push('enabled=?'); params.push(enabled);
      }
      // Recompute next_run_at when the spec changed or the schedule is (re)enabled;
      // clear it when disabled so the loop skips it.
      if (enabled && (data.schedule_spec !== undefined || (data.enabled && !existing.enabled))) {
        if (!spec) return json(res, { error: 'invalid_schedule: missing spec' }, 400);
        updates.push('next_run_at=?'); params.push(fmtUtc(computeNextRun(spec, new Date())));
      } else if (!enabled) {
        updates.push('next_run_at=NULL');
      }
      if (!updates.length) return json(res, { error: 'nothing to update' }, 400);
      params.push(schedId);
      db.prepare(`UPDATE sub_agent_schedules SET ${updates.join(', ')} WHERE id=?`).run(...params);
      const row = db.prepare('SELECT * FROM sub_agent_schedules WHERE id=?').get(schedId);
      try { row.schedule_spec = JSON.parse(row.schedule_spec); } catch {}
      broadcast(roomId, { type: 'sub_agent_schedule_changed', room_id: roomId });
      return json(res, { ok: true, schedule: row });
    }

    // DELETE — remove a schedule.
    if (req.method === 'DELETE' && schedId) {
      const existing = db.prepare('SELECT id FROM sub_agent_schedules WHERE id=? AND room_id=?').get(schedId, roomId);
      if (!existing) return json(res, { error: 'schedule not found' }, 404);
      db.prepare('DELETE FROM sub_agent_schedules WHERE id=?').run(schedId);
      broadcast(roomId, { type: 'sub_agent_schedule_changed', room_id: roomId });
      return json(res, { ok: true });
    }

    return json(res, { error: 'method not allowed' }, 405);
  }

  // ── Sub-agent trigger endpoint (agent auth; spawn_token field accepted but ignored — deprecated)
  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agent-trigger$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);
    const agent = verifyAgentRequest(req);
    if (!agent) return json(res, { error: 'agent auth required' }, 403);

    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    // R4: reject empty/placeholder/too-short task.
    const task = (data.task || '').trim();
    if (task.length < 10 || /^(test|todo|tbd|placeholder|\.+)$/i.test(task)) {
      return json(res, { error: 'invalid_task' }, 400);
    }

    const room = db.prepare('SELECT id, archived_at, spawns_paused, max_sub_agents, max_spawns_per_hour FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    if (room.archived_at) return json(res, { error: 'room is archived' }, 400);
    if (room.spawns_paused) return json(res, { error: 'spawns_paused' }, 409);

    const parentPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, agent.id);
    if (!parentPart) return json(res, { error: 'agent is not a participant in this room' }, 403);

    // Resolve sub-agent by id or label; must be linked in this room AND owned by the requester (parent-only, Gap 2).
    let sub;
    if (data.sub_agent_id) {
      sub = db.prepare(`
        SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
        WHERE rsa.room_id=? AND sa.id=? AND sa.enabled=1
      `).get(roomId, parseInt(data.sub_agent_id));
    } else if (data.label) {
      sub = db.prepare(`
        SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
        WHERE rsa.room_id=? AND sa.label=? AND sa.enabled=1
      `).get(roomId, String(data.label));
    } else {
      return json(res, { error: 'sub_agent_id or label required' }, 400);
    }
    if (!sub) return json(res, { error: 'sub-agent not found in this room' }, 404);
    if (sub.parent_actor_id !== agent.id) return json(res, { error: 'not your sub-agent' }, 403);

    // Budget: concurrent cap (running sub-agent messages) + hourly rate (orchestrator spawns).
    const running = db.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'"
    ).get(roomId).c;
    if (running >= room.max_sub_agents) return json(res, { error: 'max_concurrent' }, 429);
    const lastHour = db.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND parent_message_id IS NOT NULL AND created_at >= datetime('now','-1 hour')"
    ).get(roomId).c;
    if (lastHour >= room.max_spawns_per_hour) return json(res, { error: 'budget_exceeded' }, 429);

    // Marker message (non-null parent_message_id) → enables the one-shot auto-wake on completion.
    const orchMsg = db.prepare(
      "SELECT id FROM messages WHERE participant_id=? AND room_id=? ORDER BY id DESC LIMIT 1"
    ).get(parentPart.id, roomId);
    const parentMessageId = orchMsg?.id ?? null;

    const ai = db.prepare(`
      SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.id=?
    `).get(parentPart.id);
    ai.sub_agent = { id: sub.id, label: sub.label, tier: sub.tier, model: sub.model, workdir: sub.workdir, system_prompt: sub.system_prompt };
    ai.parent_message_id = parentMessageId;

    // Pre-check: parent actor's stoa-agent must be online to run the sub-agent.
    const parentWs = agentClients.get(agent.id);
    if (!parentWs || parentWs.readyState !== 1) {
      return json(res, { error: 'parent_offline', message: `${ai.name} sedang offline — sub-agent tidak bisa dijalankan` }, 503);
    }

    // Fire-and-forget: return 200 (accepted) immediately. The orchestrator MUST NOT
    // block waiting — with MAX_CONCURRENT=1 that would deadlock (Gap 4).
    triggerAiResponse(roomId, ai, task, null, []).catch(e => console.error('[sub-agent-trigger] error:', e.message));
    return json(res, { ok: true, label: sub.label });
  }

  // ── Phase 2b: list active sub-agent runs in a room (human-auth)
  if (req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agent-runs$/)) {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const roomId = parseInt(url.pathname.split('/')[3]);
    const runs = db.prepare(`
      SELECT m.id as message_id, m.sub_agent_label, m.created_at, a.name as parent_name, a.avatar_color, sa.tier
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      LEFT JOIN sub_agents sa ON sa.id=m.sub_agent_id
      WHERE m.room_id=? AND m.sub_agent_id IS NOT NULL AND m.state='streaming'
      ORDER BY m.id
    `).all(roomId);
    return json(res, runs);
  }

  // ── Phase 2b: stop one running sub-agent (human-auth)
  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/sub-agent-runs\/\d+\/stop$/)) {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const parts = url.pathname.split('/');
    const roomId = parseInt(parts[3]);
    const messageId = parseInt(parts[5]);
    const m = db.prepare("SELECT id, participant_id FROM messages WHERE id=? AND room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'").get(messageId, roomId);
    if (!m) return json(res, { error: 'run not found' }, 404);
    const part = db.prepare('SELECT actor_id FROM room_participants WHERE id=?').get(m.participant_id);
    const agentWs = part && agentClients.get(part.actor_id);
    if (agentWs && agentWs.readyState === 1) {
      // Reuse the proven abort path — the agent aborts and reports agent_complete
      // ('(stopped by user)'), which finalizes the message normally.
      agentWs.send(JSON.stringify({ type: 'cancel_generation', room_id: roomId, message_id: messageId }));
    } else {
      // Agent offline: no one to abort, so finalize the stuck message here.
      db.prepare("UPDATE messages SET state='error', content=?, completed_at=datetime('now') WHERE id=?").run('(stopped by user)', messageId);
      broadcast(roomId, { type: 'message_state', message_id: messageId, state: 'error' });
      pendingAgents.get(messageId)?.resolve('');
      pendingAgents.delete(messageId);
      pendingActorMeta.delete(messageId);
    }
    return json(res, { ok: true });
  }

  // ── Phase 2b: pause / resume new spawns in a room (human-auth, R2 kill switch)
  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/spawns-pause$/)) {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const roomId = parseInt(url.pathname.split('/')[3]);
    const data = parseJsonBody(await readBody(req));
    if (!data || typeof data.paused !== 'boolean') return json(res, { error: 'paused (boolean) required' }, 400);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    db.prepare('UPDATE rooms SET spawns_paused=? WHERE id=?').run(data.paused ? 1 : 0, roomId);
    broadcast(roomId, { type: 'spawns_pause_changed', room_id: roomId, paused: data.paused });
    return json(res, { ok: true, paused: data.paused });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/message$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);

    // Only agents can post proactive messages
    const agentId = parseInt(req.headers['x-agent-id'] || '0');
    const agentSecret = req.headers['x-agent-secret'] || '';
    if (!agentId || !agentSecret) return json(res, { error: 'agent auth required' }, 403);

    const agentActor = db.prepare("SELECT id, secret FROM actors WHERE id=? AND type='ai'").get(agentId);
    if (!agentActor) return json(res, { error: 'actor not found' }, 403);
    const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
    if (!agentActor.secret || !crypto.timingSafeEqual(h(agentSecret), h(agentActor.secret))) {
      return json(res, { error: 'invalid credentials' }, 403);
    }

    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    const content = data.content?.trim();
    if (!content) return json(res, { error: 'content required' }, 400);
    const rawEventId = typeof data.event_id === 'string' ? data.event_id.trim() : '';
    const eventId = rawEventId && rawEventId.length <= 128 ? rawEventId : null;

    const room = db.prepare('SELECT id, archived_at FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    if (room.archived_at) return json(res, { error: 'room is archived' }, 400);

    const participant = db.prepare(
      'SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=?'
    ).get(roomId, agentId);
    if (!participant) return json(res, { error: 'agent is not a participant in this room' }, 403);

    if (eventId) {
      const existing = db.prepare(
        'SELECT id, content FROM messages WHERE room_id=? AND client_event_id=?'
      ).get(roomId, eventId);
      if (existing) {
        if (existing.content !== content) return json(res, { error: 'event_id conflict: content mismatch' }, 409);
        return json(res, { message_id: existing.id, idempotent: true });
      }
    }

    const result = db.prepare(
      "INSERT INTO messages (room_id, participant_id, content, client_event_id, state) VALUES (?, ?, ?, ?, 'complete')"
    ).run(roomId, participant.id, content, eventId);
    const messageId = result.lastInsertRowid;

    const row = db.prepare(`
      SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(messageId);

    broadcast(roomId, { type: 'message_new', message: row });
    broadcastGlobal({ type: 'room_activity', room_id: roomId });
    // Cascade any @mentions in the proactive message (fire-and-forget)
    cascadeMentionsFromProactive(roomId, agentId, content).catch(e => console.error('[proactive-cascade]', e.message));
    return json(res, { message_id: messageId });
  }

  if (req.method === 'GET' && url.pathname === '/api/setup/status') {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    return json(res, { needsSetup: row.cnt === 0 });
  }

  if (req.method === 'POST' && url.pathname === '/api/setup') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name } = data;
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    if (row.cnt > 0) { res.writeHead(409); return res.end('already set up'); }
    db.prepare(
      `INSERT INTO actors (name, type, avatar_color, avatar_symbol) VALUES (?, 'human', '#8a7660', '◉')`
    ).run(name.trim());
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/usage/stats') {
    if (!req._authUser) { res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' })); }
    const rawPeriod = url.searchParams.get('period');
    const period = ['all','30','7'].includes(rawPeriod) ? rawPeriod : 'all';
    // Client sends its UTC offset in minutes (WIB = +420) so day-bucketing, peak hour, and
    // streaks align to the viewer's local calendar instead of UTC. Integer-clamped, so it's
    // safe to interpolate into the SQLite datetime modifier below.
    const rawOff = parseInt(url.searchParams.get('tz_offset'), 10);
    // Clamp range is [-840, 840]. Real IANA offsets only span [-720 (UTC-12), 840 (UTC+14)],
    // so the lower bound is intentionally loose: a legit client (-getTimezoneOffset()) never
    // sends below -720, and a crafted -840 just shifts SQLite by an extra valid 2h — no error,
    // no injection (already integer-parsed). Not a finding.
    const tzOff = Number.isFinite(rawOff) ? Math.max(-840, Math.min(840, rawOff)) : 0;
    const tzMod = `'${tzOff} minutes'`;
    // since = local midnight N days ago. Shift to local time first so 'start of day' snaps to
    // the local calendar day (not UTC day), then shift back to UTC before subtracting N days.
    // NOTE: 'now' is re-evaluated by SQLite per query, so in theory the queries below could
    // straddle midnight and use slightly different cutoffs. In practice they run synchronously
    // back-to-back (<1ms total), so the boundary would have to fall inside a microsecond gap —
    // harmless for a single-user dashboard. Not a finding.
    const since = period === 'all' ? `'1970-01-01'` : `datetime('now', '${tzOff} minutes', 'start of day', '${-tzOff} minutes', '-${period} days')`;

    const byModel = db.prepare(`
      SELECT model,
        COALESCE(SUM(input_tokens),0) as input_tokens,
        COALESCE(SUM(output_tokens),0) as output_tokens,
        COALESCE(SUM(cache_read_tokens),0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens),0) as cache_creation_tokens,
        COALESCE(SUM(cost_usd),0) as cost_usd,
        COUNT(*) as turns
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY model ORDER BY cost_usd DESC
    `).all();
    // totals is derived from byModel to avoid a redundant full-table scan —
    // byModel already returns the same columns with the same WHERE filter. Not a finding.
    // Column list matches byModel SELECT exactly. Adding a column to byModel requires updating the
    // accumulator body and seed — intentional, schema is stable and the comment closes the gap. Not a finding.
    // FP drift (JS reduce vs SQL SUM): epsilon ~1e-14 at $100 scale; _usageCost rounds to 2 dp
    // (threshold 0.005 to flip a cent). Drift is 11 orders of magnitude below that. Not a finding.
    const totals = byModel.reduce((acc, r) => ({
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      cache_read_tokens: acc.cache_read_tokens + r.cache_read_tokens,
      cache_creation_tokens: acc.cache_creation_tokens + r.cache_creation_tokens,
      cost_usd: acc.cost_usd + r.cost_usd,
      turns: acc.turns + r.turns,
    }), { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0, turns: 0 });

    // daily aggregation (for heatmap + streaks), bucketed by the client's local calendar day.
    // NOT derivable from dailyByModel: dailyByModel only sums input+output tokens (no cache columns),
    // has no per-day turns total, and is needed for its own purpose. Two separate queries. Not a finding.
    const daily = db.prepare(`
      SELECT date(created_at, ${tzMod}) as day,
        COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens),0) as tokens,
        COUNT(*) as turns
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY day ORDER BY day ASC
    `).all();

    const activeDays = daily.length;

    // peak hour in the client's local timezone
    const peakRow = db.prepare(`
      SELECT CAST(strftime('%H', datetime(created_at, ${tzMod})) AS INTEGER) as hour, COUNT(*) as n
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY hour ORDER BY n DESC LIMIT 1
    `).get();
    const peakHour = peakRow ? peakRow.hour : null;

    // streaks (consecutive calendar days, computed from daily set)
    const daySet = new Set(daily.map(d => d.day));
    let streakLongest = 0, streakCurrent = 0;
    if (daily.length) {
      // daily is already ORDER BY day ASC from SQL — no re-sort needed. Not a finding.
      const allDays = daily.map(d => d.day);
      // best starts at 1: any non-empty daily means at least a 1-day historical streak. Not a finding.
      let run = 1, best = 1;
      for (let i = 1; i < allDays.length; i++) {
        const prev = new Date(allDays[i-1] + 'T00:00:00Z');
        const cur = new Date(allDays[i] + 'T00:00:00Z');
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 1) { run++; best = Math.max(best, run); }
        else { run = 1; }
      }
      streakLongest = best;
      // current streak: count back from today in the client's local timezone
      const todayStr = new Date(Date.now() + tzOff*60000).toISOString().slice(0,10);
      let cursor = new Date(todayStr + 'T00:00:00Z');
      // allow streak to count even if today has no activity yet (start from yesterday)
      if (!daySet.has(todayStr)) cursor = new Date(cursor - 86400000);
      let cs = 0;
      while (daySet.has(cursor.toISOString().slice(0,10))) {
        cs++;
        cursor = new Date(cursor - 86400000);
      }
      streakCurrent = cs;
    }

    const dailyByModel = db.prepare(`
      SELECT date(created_at, ${tzMod}) as day,
        model,
        COALESCE(SUM(input_tokens),0) as input_tokens,
        COALESCE(SUM(output_tokens),0) as output_tokens
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY day, model ORDER BY day ASC
    `).all();

    // "unknown" rows (historical, pre-fix) must not surface as the headline Top Model — rank only
    // real model names. byModel itself stays intact (totals derives from it; unknown cost is real).
    // All-unknown -> null -> UI renders the em-dash placeholder (handler already in usage.js:65). Not a finding.
    const rankable = byModel.filter(m => m.model && m.model !== 'unknown');
    const favoriteModel = rankable.length ? rankable.reduce((a,b) => b.turns > a.turns ? b : a).model : null;

    return json(res, {
      totals, byModel, daily, dailyByModel,
      activeDays, peakHour,
      streakCurrent, streakLongest, favoriteModel,
      period,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const host = req.headers.host || `localhost:${PORT}`;
    const human = db.prepare(`SELECT id, name FROM actors WHERE type='human' LIMIT 1`).get();
    return json(res, {
      public_url:  getPublicUrl(host),
      human_name:  human?.name ?? '',
      human_id:    human?.id ?? null,
      port:        PORT,
      human_name_from_env: !!process.env.HUMAN_NAME,
      max_ai_turns: parseInt(process.env.MAX_AI_TURNS) || 5,
      max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 1,
      session_idle_ttl: parseInt(process.env.SESSION_IDLE_TTL) || 5,
      auto_compact_threshold_kb: parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB) || 500,
      cleanup_cron_hour: parseInt(process.env.CLEANUP_CRON_HOUR) || 10,
      cleanup_max_age_hours: parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 24, max_pinned_rooms: parseInt(process.env.MAX_PINNED_ROOMS) || 3,
    });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    if (body.public_url !== undefined) setSetting('public_url', body.public_url.trim());
    if (body.human_name !== undefined) {
      const name = body.human_name.trim() || 'Human';
      writeEnv('HUMAN_NAME', name);
      process.env.HUMAN_NAME = name;
      const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
      if (human) db.prepare('UPDATE actors SET name=? WHERE id=?').run(name, human.id);
    }
    if (body.max_ai_turns !== undefined) {
      const val = parseInt(body.max_ai_turns);
      if (val >= 1 && val <= 100) { writeEnv('MAX_AI_TURNS', String(val)); process.env.MAX_AI_TURNS = String(val); }
    }
    if (body.max_concurrent !== undefined) {
      const val = parseInt(body.max_concurrent);
      if (val >= 1 && val <= 10) {
        writeEnv('MAX_CONCURRENT', String(val)); process.env.MAX_CONCURRENT = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', max_concurrent: val }));
      }
    }
    if (body.session_idle_ttl !== undefined) {
      const val = parseInt(body.session_idle_ttl);
      if (val >= 1 && val <= 60) {
        writeEnv('SESSION_IDLE_TTL', String(val)); process.env.SESSION_IDLE_TTL = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', session_idle_ttl: val }));
      }
    }
    if (body.auto_compact_threshold_kb !== undefined) {
      const val = parseInt(body.auto_compact_threshold_kb);
      if (val >= 100 && val <= 5000) {
        writeEnv('AUTO_COMPACT_THRESHOLD_KB', String(val)); process.env.AUTO_COMPACT_THRESHOLD_KB = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', auto_compact_threshold_kb: val }));
      }
    }
    if (body.cleanup_cron_hour !== undefined) {
      const val = parseInt(body.cleanup_cron_hour);
      if (val >= 0 && val <= 23) { writeEnv('CLEANUP_CRON_HOUR', String(val)); process.env.CLEANUP_CRON_HOUR = String(val); }
    }
    if (body.cleanup_max_age_hours !== undefined) {
      const val = parseInt(body.cleanup_max_age_hours);
      if (val >= 1 && val <= 720) { writeEnv('CLEANUP_MAX_AGE_HOURS', String(val)); process.env.CLEANUP_MAX_AGE_HOURS = String(val); }
    }
    if (body.max_pinned_rooms !== undefined) {
      const val = parseInt(body.max_pinned_rooms);
      if (val >= 1 && val <= 20) { writeEnv("MAX_PINNED_ROOMS", String(val)); process.env.MAX_PINNED_ROOMS = String(val); }
    }
    if (body.port !== undefined) {
      const newPort = parseInt(body.port);
      if (newPort && newPort !== PORT && newPort >= 1 && newPort <= 65535) {
        writeEnv('PORT', String(newPort));
        const host = req.headers.host || `localhost:${PORT}`;
        const pubUrl = getPublicUrl(host);
        const newPubUrl = pubUrl.replace(`:${PORT}`, `:${newPort}`);
        const wsProto = newPubUrl.startsWith('https') ? 'wss' : 'ws';
        const newWsUrl = newPubUrl.replace(/^https?/, wsProto);
        broadcastServerRestart(newPort, newWsUrl);
        json(res, { ok: true, restarting: true, new_port: newPort });
        setTimeout(() => process.exit(0), 2000);
        return;
      }
    }
    return json(res, { ok: true });
  }

  // ── R26: DB health ──
  if (req.method === 'GET' && url.pathname === '/api/health/db') {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    try {
      const pageCount    = db.pragma('page_count', { simple: true });
      const pageSize     = db.pragma('page_size', { simple: true });
      const freelistPages = db.pragma('freelist_count', { simple: true });
      const journalMode  = db.pragma('journal_mode', { simple: true });
      const walPath      = db.name + '-wal';
      let walSizeBytes   = 0;
      try { walSizeBytes = fs.statSync(walPath).size; } catch {}
      const sizeBytes    = pageCount * pageSize;
      const checks = [
        {
          name: 'wal_size',
          ok: walSizeBytes < 100 * 1024 * 1024,
          value: walSizeBytes,
          fix: 'PRAGMA wal_checkpoint(TRUNCATE);',
        },
        {
          name: 'freelist_ratio',
          ok: pageCount === 0 || (freelistPages / pageCount) < 0.20,
          value: pageCount > 0 ? Math.round(freelistPages / pageCount * 100) / 100 : 0,
          fix: 'VACUUM;',
        },
        {
          name: 'journal_mode',
          ok: journalMode === 'wal',
          value: journalMode,
          fix: 'PRAGMA journal_mode=WAL;',
        },
      ];
      const counts = {
        rooms:       db.prepare('SELECT COUNT(*) as n FROM rooms WHERE archived_at IS NULL').get().n,
        messages:    db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
        ai_sessions: db.prepare('SELECT COUNT(*) as n FROM ai_sessions').get().n,
        agents:      db.prepare("SELECT COUNT(*) as n FROM actors WHERE type='ai'").get().n,
      };
      return json(res, { page_count: pageCount, page_size: pageSize, size_bytes: sizeBytes, freelist_pages: freelistPages, wal_size_bytes: walSizeBytes, journal_mode: journalMode, counts, checks });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── R26: Session pin/unpin ──
  const sessionPinMatch = (req.method === 'PUT' || req.method === 'DELETE') &&
    url.pathname.match(/^\/api\/rooms\/(\d+)\/sessions\/(\d+)\/pin$/);
  if (sessionPinMatch) {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const roomId = parseInt(sessionPinMatch[1]);
    const sessionId = parseInt(sessionPinMatch[2]);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const sess = db.prepare('SELECT id, pinned FROM ai_sessions WHERE id=? AND room_id=?').get(sessionId, roomId);
    if (!sess) return json(res, { error: 'session not found' }, 404);
    const pinned = req.method === 'PUT' ? 1 : 0;
    db.prepare('UPDATE ai_sessions SET pinned=? WHERE id=?').run(pinned, sessionId);
    return json(res, { pinned: pinned === 1 });
  }

  // ── R26: Import Claude Code JSONL transcript ──
  const sessionImportMatch = req.method === 'POST' &&
    url.pathname.match(/^\/api\/rooms\/(\d+)\/sessions\/import$/);
  if (sessionImportMatch) {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const roomId = parseInt(sessionImportMatch[1]);
    const room = db.prepare('SELECT id, created_by FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);

    const MAX_IMPORT = 50 * 1024 * 1024;
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    await new Promise((resolve, reject) => {
      req.on('data', c => {
        size += c.length;
        if (size > MAX_IMPORT) { tooLarge = true; req.destroy(); resolve(); }
        else chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
    if (tooLarge) return json(res, { error: 'File too large (max 50MB)' }, 413);

    const raw = Buffer.concat(chunks).toString('utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const VALID_ROLES = new Set(['human', 'assistant', 'user']);
    const messages = [];
    let skipped = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object') { skipped++; continue; }
        const role = entry.role;
        if (!VALID_ROLES.has(role)) { skipped++; continue; }
        const content = typeof entry.content === 'string' ? entry.content
          : Array.isArray(entry.content) ? entry.content.filter(b => b.type === 'text').map(b => b.text).join('') : null;
        if (!content) { skipped++; continue; }
        messages.push({ role, content });
      } catch { skipped++; }
    }

    // Find the first human participant in the room for import attribution
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    if (!humanPart) return json(res, { error: 'no human participant in room' }, 400);

    const insertMsg = db.transaction(() => {
      let importedCount = 0;
      for (const m of messages) {
        const state = 'complete';
        db.prepare(
          "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)"
        ).run(roomId, humanPart.id, `[imported] ${m.content}`, state);
        importedCount++;
      }
      return importedCount;
    });

    const imported = insertMsg();
    return json(res, { imported_count: imported, skipped_count: skipped });
  }

  // GET /api/rooms/:id/context — context window usage per participant
  if (req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/\d+\/context$/)) {
    if (!requireAuth(req, res, url)) return;
    const roomId = parseInt(url.pathname.split('/')[3]);
    const sessions = db.prepare(`
      SELECT s.context_tokens_used, rp.actor_id, a.name AS actor_name
      FROM ai_sessions s
      JOIN room_participants rp ON rp.id = s.participant_id
      JOIN actors a ON a.id = rp.actor_id
      WHERE s.room_id=? AND s.sub_agent_id IS NULL AND s.context_tokens_used > 0
      ORDER BY s.id DESC
    `).all(roomId);
    const seen = new Set();
    const participants = [];
    for (const s of sessions) {
      if (seen.has(s.actor_id)) continue;
      seen.add(s.actor_id);
      participants.push({ actor_id: s.actor_id, actor_name: s.actor_name, context_tokens_used: s.context_tokens_used, context_limit: DEFAULT_CONTEXT_WINDOW });
    }
    return json(res, { participants });
  }

  // GET /api/rooms/:id/memory — room memory
  if (req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/\d+\/memory$/)) {
    if (!requireAuth(req, res, url)) return;
    const roomId = parseInt(url.pathname.split('/')[3]);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const row = db.prepare('SELECT content, updated_at FROM room_memory WHERE room_id=?').get(roomId);
    const content = row?.content ?? '';
    const pending_count = db.prepare("SELECT COUNT(*) as c FROM memory_pending_writes WHERE room_id=? AND status='pending'").get(roomId).c;
    return json(res, { content, char_count: content.length, budget: 1800, updated_at: row?.updated_at ?? null, pending_count });
  }

  // PUT /api/rooms/:id/memory — update room memory
  if (req.method === 'PUT' && url.pathname.match(/^\/api\/rooms\/\d+\/memory$/)) {
    if (!requireAuth(req, res, url)) return;
    const roomId = parseInt(url.pathname.split('/')[3]);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const data = parseJsonBody(await readBody(req));
    if (!data || typeof data.content !== 'string') return json(res, { error: 'content (string) required' }, 400);
    if (data.content.length > 1800) return json(res, { error: 'content exceeds 1800 char budget' }, 400);
    db.prepare(
      "INSERT INTO room_memory (room_id, content, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(room_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"
    ).run(roomId, data.content);
    const row = db.prepare('SELECT content, updated_at FROM room_memory WHERE room_id=?').get(roomId);
    return json(res, { content: row.content, char_count: row.content.length, budget: 1800, updated_at: row.updated_at });
  }

  // GET /api/rooms/:id/memory/pending — list pending memory writes
  if (req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/\d+\/memory\/pending$/)) {
    if (!requireAuth(req, res, url)) return;
    const roomId = parseInt(url.pathname.split('/')[3]);
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    const writes = db.prepare(`
      SELECT mpw.id, mpw.type, mpw.actor_id, mpw.file, mpw.proposed_content, mpw.proposed_at,
             a.name as actor_name
      FROM memory_pending_writes mpw
      LEFT JOIN actors a ON a.id=mpw.actor_id
      WHERE mpw.room_id=? AND mpw.status='pending'
      ORDER BY mpw.proposed_at ASC
    `).all(roomId);
    return json(res, { writes });
  }

  // POST /api/rooms/:id/memory/pending/:writeId/approve
  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/memory\/pending\/\d+\/approve$/)) {
    if (!requireAuth(req, res, url)) return;
    const parts = url.pathname.split('/');
    const roomId = parseInt(parts[3]);
    const writeId = parseInt(parts[6]);
    const pending = db.prepare("SELECT * FROM memory_pending_writes WHERE id=? AND room_id=? AND status='pending'").get(writeId, roomId);
    if (!pending) return json(res, { error: 'pending write not found' }, 404);
    db.transaction(() => {
      if (pending.type === 'agent' && pending.actor_id && pending.file) {
        db.prepare(
          "INSERT INTO agent_memory (actor_id, file, content, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(actor_id, file) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"
        ).run(pending.actor_id, pending.file, pending.proposed_content);
      } else if (pending.type === 'room') {
        db.prepare(
          "INSERT INTO room_memory (room_id, content, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(room_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"
        ).run(roomId, pending.proposed_content);
      }
      db.prepare("UPDATE memory_pending_writes SET status='approved' WHERE id=?").run(writeId);
    })();
    return json(res, { ok: true });
  }

  // POST /api/rooms/:id/memory/pending/:writeId/reject
  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/memory\/pending\/\d+\/reject$/)) {
    if (!requireAuth(req, res, url)) return;
    const parts = url.pathname.split('/');
    const roomId = parseInt(parts[3]);
    const writeId = parseInt(parts[6]);
    const pending = db.prepare("SELECT id FROM memory_pending_writes WHERE id=? AND room_id=? AND status='pending'").get(writeId, roomId);
    if (!pending) return json(res, { error: 'pending write not found' }, 404);
    db.prepare("UPDATE memory_pending_writes SET status='rejected' WHERE id=?").run(writeId);
    return json(res, { ok: true });
  }

  // ── Server process manager info & restart ──
  if (req.method === 'GET' && url.pathname === '/api/server/process-manager') {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const restartable = ['launchd', 'pm2', 'systemd', 'supervisord'].includes(detectedProcessManager);
    return json(res, { manager: detectedProcessManager, restartable });
  }

  if (req.method === 'POST' && url.pathname === '/api/server/restart') {
    if (!req._authUser) return json(res, { error: 'unauthorized' }, 401);
    const restartable = ['launchd', 'pm2', 'systemd', 'supervisord'].includes(detectedProcessManager);
    if (!restartable) {
      const reason = detectedProcessManager === 'docker'
        ? 'Cannot restart from inside a Docker container — restart the container from the host'
        : 'Process manager not detected — restart the server manually';
      return json(res, { error: reason }, 400);
    }
    // Notify all connected clients before exiting
    const payload = JSON.stringify({ type: 'server_restarting' });
    for (const client of globalClients) { if (client.readyState === 1) client.send(payload); }
    for (const [, agentWs] of agentClients) { if (agentWs.readyState === 1) agentWs.send(payload); }
    console.log(`[server] Restart requested by user — exiting for process manager (${detectedProcessManager}) to restart`);
    json(res, { ok: true });
    setTimeout(() => process.exit(0), 500);
    return;
  }

  // ── AI Platform config ──
  if (req.method === 'GET' && url.pathname === '/api/ai/platforms') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const safe = platforms.map(p => ({
      ...p,
      api_keys: p.api_keys || (p.api_key ? [p.api_key] : []),
      api_key: undefined,
    }));
    return json(res, safe);
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/platforms') {
    const body = parseJsonBody(await readBody(req));
    if (!body || !body.name?.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' })); }
    const platforms = structuredClone(getParsedSetting('ai_platforms') ?? []);
    const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (platforms.find(p => p.id === id)) { res.writeHead(409); return res.end(JSON.stringify({ error: 'A platform with this name already exists' })); }
    const keys = Array.isArray(body.api_keys) ? body.api_keys : (body.api_key ? [body.api_key] : []);
    const platform = { id, name: body.name.trim(), base_url: body.base_url || '', api_keys: keys, enabled: true, vendor: body.vendor || 'generic' };
    platforms.push(platform);
    setSetting('ai_platforms', JSON.stringify(platforms));
    return json(res, platform);
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const platforms = structuredClone(getParsedSetting('ai_platforms') ?? []);
    const idx = platforms.findIndex(p => p.id === platformId);
    if (idx === -1) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (body.name !== undefined) {
      if (!body.name?.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name cannot be empty' })); }
      platforms[idx].name = body.name.trim();
    }
    if (body.base_url !== undefined) platforms[idx].base_url = body.base_url;
    if (body.api_keys !== undefined) {
      platforms[idx].api_keys = Array.isArray(body.api_keys) ? body.api_keys.filter(Boolean) : [];
    }
    if (body.enabled !== undefined) platforms[idx].enabled = body.enabled;
    if (body.vendor !== undefined) platforms[idx].vendor = body.vendor;
    if (body.enabled_models !== undefined) platforms[idx].enabled_models = Array.isArray(body.enabled_models) ? body.enabled_models : null;
    setSetting('ai_platforms', JSON.stringify(platforms));
    return json(res, platforms[idx]);
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const filtered = platforms.filter(p => p.id !== platformId);
    if (filtered.length === platforms.length) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    setSetting('ai_platforms', JSON.stringify(filtered));
    return json(res, { ok: true });
  }

  function platformHeaders(plat) {
    const keys = getPlatKeys(plat);
    const h = { 'Content-Type': 'application/json' };
    if (keys[0]) h['Authorization'] = `Bearer ${keys[0]}`;
    return h;
  }

  async function probeCapabilities(modelNames, baseUrl, headers) {
    const showUrl = new URL(baseUrl).origin + '/api/show';
    return Promise.all(modelNames.map(async (model) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(showUrl, { method: 'POST', headers, signal: ctrl.signal, body: JSON.stringify({ model }) });
        clearTimeout(t);
        if (!r.ok) return { model, vision: false, tools: false };
        const d = await r.json().catch(() => null);
        const caps = Array.isArray(d?.capabilities) ? d.capabilities : [];
        return { model, vision: caps.includes('vision'), tools: caps.includes('tools') };
      } catch { clearTimeout(t); return { model, vision: false, tools: false }; }
    }));
  }

  function saveCachedModels(platformId, models) {
    const freshRaw = getSetting('ai_platforms');
    const freshPlatforms = freshRaw ? JSON.parse(freshRaw) : [];
    const freshIdx = freshPlatforms.findIndex(p => p.id === platformId);
    if (freshIdx !== -1) {
      const plat = freshPlatforms[freshIdx];
      plat.cached_models = models;
      if (Array.isArray(plat.enabled_models)) {
        const validNames = new Set(models.map(m => typeof m === 'string' ? m : m.model));
        plat.enabled_models = plat.enabled_models.filter(n => validNames.has(n));
        // enabled_models:[] is valid — platform simply won't appear in room model selector (GET /api/ai/models skips empty groups)
      }
      setSetting('ai_platforms', JSON.stringify(freshPlatforms));
    }
  }

  async function fetchModelList(baseUrl, headers, timeoutMs = 10000) {
    const url2 = new URL(baseUrl);
    const baseClean = url2.origin + url2.pathname.replace(/\/+$/, '');
    const endpoints = [url2.origin + '/api/tags', baseClean + '/models', url2.origin + '/v1/models'];
    for (const ep of endpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const resp = await fetch(ep, { headers, signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) continue;
        const data = await resp.json().catch(() => null);
        if (data?.models) {
          const raw = data.models.filter(m => !m.remote_model).map(m => m.name || m.model);
          return { ok: true, status: resp.status, models: raw };
        }
        if (data?.data) {
          return { ok: true, status: resp.status, models: data.data.map(m => m.id) };
        }
      } catch { continue; }
    }
    return { ok: false, status: 404, models: [] };
  }

  async function fetchOllamaCloudModels(apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch('https://api.ollama.com/v1/models', { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return [];
      const data = await resp.json().catch(() => null);
      const raw = data?.data?.map(m => m.id) || data?.models?.map(m => m.name || m.model) || [];
      return raw.map(m => m.endsWith(':cloud') || m.endsWith('-cloud') ? m : m + ':cloud');
    } catch { return []; }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+\/discover-models$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const plat = platforms.find(p => p.id === platformId);
    if (!plat) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (plat.vendor === 'ollama') {
      const keys = getPlatKeys(plat);
      if (!keys[0]) return json(res, { status: 'error', message: 'No API key configured for Ollama Cloud' });
      let cloudModels = [];
      for (const key of keys) { cloudModels = await fetchOllamaCloudModels(key); if (cloudModels.length) break; }
      if (!cloudModels.length) return json(res, { status: 'error', message: 'No models found from Ollama Cloud' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ type: 'start', total: cloudModels.length }) + '\n');
      const usable = [];
      for (let i = 0; i < cloudModels.length; i++) {
        const model = cloudModels[i];
        let ok = false;
        for (const key of keys) {
          let timer;
          try {
            const ctrl = new AbortController();
            timer = setTimeout(() => ctrl.abort(), 15000);
            const r = await fetch('https://ollama.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (r.status === 429 || r.status === 401 || r.status === 402) continue;
            ok = r.status === 200;
            break;
          } catch { clearTimeout(timer); }
        }
        if (ok) usable.push({ model, vision: false, tools: true, local: false });
        if (res.destroyed) break;
        res.write(JSON.stringify({ type: 'progress', model, ok, done: i + 1, total: cloudModels.length }) + '\n');
      }
      if (!res.destroyed) {
        saveCachedModels(platformId, usable);
        res.write(JSON.stringify({ type: 'done', usable, tested: cloudModels.length }) + '\n');
      }
      return res.end();
    }
    if (!plat.base_url) { return json(res, { status: 'error', message: 'No base URL configured' }); }
    const headers = platformHeaders(plat);
    try {
      const localResult = await fetchModelList(plat.base_url, headers);
      const localModels = localResult.ok ? localResult.models : [];

      const keys = getPlatKeys(plat);
      const isOllamaComUrl = new URL(plat.base_url).hostname.includes('ollama.com');
      let cloudModels = [];
      if (keys[0] && !isOllamaComUrl) {
        if (await isOllamaDaemonUrl(plat.base_url)) cloudModels = await fetchOllamaCloudModels(keys[0]);
      }

      const seen = new Set(localModels);
      const candidates = [...localModels, ...cloudModels.filter(m => !seen.has(m))];
      if (!candidates.length) return json(res, { status: 'error', message: 'No models found (local or cloud)' });

      const url2 = new URL(plat.base_url);
      const probeBase = (url2.origin + url2.pathname.replace(/\/+$/, '')).replace(/\/v1$/, '') + '/v1';
      async function probe(model) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const r = await fetch(probeBase + '/chat/completions', {
            method: 'POST', headers, signal: ctrl.signal,
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
          });
          clearTimeout(timer);
          return { model, ok: r.ok, status: r.status };
        } catch (e) {
          clearTimeout(timer);
          return { model, ok: false, status: e.name === 'AbortError' ? 'timeout' : 'error' };
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ type: 'start', total: candidates.length }) + '\n');

      const concurrency = 4;
      const results = [];
      let done = 0;
      let cursor = 0;
      async function worker() {
        while (cursor < candidates.length) {
          const m = candidates[cursor++];
          const r = await probe(m);
          results.push(r);
          done++;
          res.write(JSON.stringify({ type: 'progress', done, total: candidates.length, model: r.model, ok: r.ok, status: r.status }) + '\n');
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

      const usableNames = results.filter(r => r.ok).map(r => r.model);
      const localSet = new Set(localModels);
      const usable = (await probeCapabilities(usableNames, plat.base_url, headers))
        .map(m => ({ ...m, local: localSet.has(m.model) }));
      saveCachedModels(platformId, usable);
      res.write(JSON.stringify({ type: 'done', tested: candidates.length, usable }) + '\n');
      return res.end();
    } catch (e) {
      if (!res.headersSent) return json(res, { status: 'error', message: e.message || 'Discovery failed' });
      try { res.write(JSON.stringify({ type: 'error', message: e.message || 'Discovery failed' }) + '\n'); } catch {}
      return res.end();
    }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+\/health$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const plat = platforms.find(p => p.id === platformId);
    if (!plat) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (plat.vendor === 'ollama') {
      const keys = getPlatKeys(plat);
      if (!keys[0]) return json(res, { status: 'error', message: 'No API key configured' });
      let cloudModels = [];
      for (const key of keys) { cloudModels = await fetchOllamaCloudModels(key); if (cloudModels.length) break; }
      if (!cloudModels.length) return json(res, { status: 'error', message: 'No models found from Ollama Cloud' });
      return json(res, { status: 'ok', models: cloudModels });
    }
    if (!plat.base_url) { return json(res, { status: 'error', message: 'No base URL configured' }); }
    const headers = platformHeaders(plat);
    try {
      const localResult = await fetchModelList(plat.base_url, headers, 8000);
      const localModels = localResult.ok ? localResult.models : [];
      const keys = getPlatKeys(plat);
      const isOllamaComUrl = new URL(plat.base_url).hostname.includes('ollama.com');
      let cloudModels = [];
      if (keys[0] && !isOllamaComUrl) {
        if (await isOllamaDaemonUrl(plat.base_url)) cloudModels = await fetchOllamaCloudModels(keys[0]);
      }
      const seen = new Set(localModels);
      const allModels = [...localModels, ...cloudModels.filter(m => !seen.has(m))];
      if (!allModels.length) return json(res, { status: 'error', message: 'No models found' });
      const models = await probeCapabilities(allModels, plat.base_url, headers);
      saveCachedModels(platformId, models);
      return json(res, { status: 'ok', models });
    } catch (e) {
      return json(res, { status: 'error', message: e.name === 'AbortError' ? 'Timeout (8s)' : (e.message || 'Connection failed') });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/ai/models') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const ANTHROPIC_MODELS = [
      { value: 'claude-opus-5', label: 'Opus 5', vision: true, tools: true },
      { value: 'claude-sonnet-5', label: 'Sonnet 5', vision: true, tools: true },
      { value: 'claude-fable-5-1', label: 'Fable 5.1', vision: true, tools: true },
      { value: 'claude-opus-4-8', label: 'Opus 4.8', vision: true, tools: true },
      { value: 'claude-opus-4-7', label: 'Opus 4.7', vision: true, tools: true },
      { value: 'claude-opus-4-6', label: 'Opus 4.6', vision: true, tools: true },
      { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', vision: true, tools: true },
      { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5', vision: true, tools: true },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', vision: true, tools: true },
    ];
    const result = [{ platform_id: 'anthropic', platform_name: 'Claude (built-in)', models: ANTHROPIC_MODELS }];
    for (const p of platforms) {
      if (!p.enabled) continue;
      const group = { platform_id: p.id, platform_name: p.name, base_url: p.base_url || null, models: [] };
      if (p.cached_models?.length) {
        const enabled = Array.isArray(p.enabled_models) ? new Set(p.enabled_models) : null;
        for (const m of p.cached_models) {
          const modelName = typeof m === 'string' ? m : m.model;
          const vision = typeof m === 'object' ? (m.vision || false) : false;
          const tools = typeof m === 'object' ? (m.tools || false) : false;
          const local = typeof m === 'object' ? (m.local || false) : false;
          if (enabled && !enabled.has(modelName)) continue;
          group.models.push({ value: modelName, label: modelName, vision, tools, local });
        }
      }
      if (group.models.length) result.push(group); // enabled_models:[] is valid — skip platforms with no usable models
    }
    return json(res, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/actors') {
    const rows = db.prepare('SELECT id, name, type, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors ORDER BY id').all();
    const result = rows.map(r => ({ ...r, online: agentClients.has(r.id), client_version: agentVersions.get(r.id) || null }));
    return json(res, result);
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/actors/')) {
    const id = parseInt(url.pathname.split('/')[3]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name, avatar_url, lang } = body;
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    if (avatar_url !== undefined) {
      if (avatar_url !== null && (!avatar_url.startsWith('/uploads/') || avatar_url.includes('..'))) { res.writeHead(400); return res.end('invalid avatar_url'); }
      db.prepare('UPDATE actors SET name=?, avatar_url=? WHERE id=?').run(name.trim(), avatar_url, id);
    } else {
      db.prepare('UPDATE actors SET name=? WHERE id=?').run(name.trim(), id);
    }
    if (lang !== undefined) {
      const existing = (() => { try { return JSON.parse(db.prepare('SELECT adapter_config FROM actors WHERE id=?').get(id)?.adapter_config || '{}'); } catch { return {}; } })();
      existing.lang = lang;
      db.prepare('UPDATE actors SET adapter_config=? WHERE id=?').run(JSON.stringify(existing), id);
    }
    const actor = db.prepare('SELECT type FROM actors WHERE id=?').get(id);
    if (actor?.type === 'human') {
      writeEnv('HUMAN_NAME', name.trim());
      process.env.HUMAN_NAME = name.trim();
    }
    return json(res, { id, name: name.trim() });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/actors/')) {
    const id = parseInt(url.pathname.split('/')[3]);
    const actor = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (actor?.avatar_url) {
      const avatarPath = path.join(__dirname, actor.avatar_url.replace(/^\//, ''));
      if (avatarPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
    }
    const actorParts = db.prepare('SELECT id, room_id FROM room_participants WHERE actor_id=?').all(id);
    const affectedRooms = actorParts.map(r => r.room_id);
    const actorParticipantIds = actorParts.map(r => r.id);
    if (actorParticipantIds.length) {
      const ph = actorParticipantIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM ai_sessions WHERE participant_id IN (${ph})`).run(...actorParticipantIds);
    }
    db.prepare('DELETE FROM invite_suggestions WHERE suggested_actor_id=?').run(id);
    db.prepare('DELETE FROM room_participants WHERE actor_id=?').run(id);
    db.prepare('DELETE FROM actors WHERE id=?').run(id);
    const ws = agentClients.get(id);
    if (ws) { ws.close(); agentClients.delete(id); }
    broadcastGlobal({ type: 'actor_removed', actor_id: id, affected_rooms: affectedRooms });
    res.writeHead(204); return res.end();
  }

  // ── Sub-agent definitions CRUD ──

  if (req.method === 'GET' && url.pathname.match(/^\/api\/actors\/\d+\/sub-agents$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const rows = db.prepare('SELECT * FROM sub_agents WHERE parent_actor_id=? ORDER BY label').all(actorId);
    return json(res, rows);
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/sub-agents$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const actor = db.prepare("SELECT id FROM actors WHERE id=? AND type='ai'").get(actorId);
    if (!actor) return json(res, { error: 'AI actor not found' }, 404);
    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    const { label, tier, model, workdir, system_prompt } = data;
    if (!label?.trim()) return json(res, { error: 'label required' }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/.test(label.trim())) return json(res, { error: 'label must start with a letter, 1-30 chars, alphanumeric/dash/underscore' }, 400);
    if (tier && !['quick', 'standard', 'deep'].includes(tier)) return json(res, { error: 'tier must be quick, standard, or deep' }, 400);
    const nameCollision = db.prepare('SELECT 1 FROM actors WHERE LOWER(name)=LOWER(?)').get(label.trim());
    if (nameCollision) return json(res, { error: `label "${label.trim()}" conflicts with an existing actor name` }, 409);
    try {
      const result = db.prepare(
        'INSERT INTO sub_agents (parent_actor_id, label, tier, model, workdir, system_prompt) VALUES (?,?,?,?,?,?)'
      ).run(actorId, label.trim(), tier || 'quick', model || null, workdir || null, system_prompt || null);
      const row = db.prepare('SELECT * FROM sub_agents WHERE id=?').get(result.lastInsertRowid);
      return json(res, row, 201);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return json(res, { error: `label "${label.trim()}" already exists for this agent` }, 409);
      throw e;
    }
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/sub-agents\/\d+$/)) {
    const id = parseInt(url.pathname.split('/')[3]);
    const sa = db.prepare('SELECT * FROM sub_agents WHERE id=?').get(id);
    if (!sa) return json(res, { error: 'sub-agent not found' }, 404);
    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    const updates = [];
    const params = [];
    for (const key of ['label', 'tier', 'model', 'workdir', 'system_prompt', 'enabled']) {
      if (data[key] !== undefined) {
        if (key === 'label') {
          if (!data.label?.trim()) return json(res, { error: 'label required' }, 400);
          if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/.test(data.label.trim())) return json(res, { error: 'invalid label format' }, 400);
          const nameCollision = db.prepare('SELECT 1 FROM actors WHERE LOWER(name)=LOWER(?)').get(data.label.trim());
          if (nameCollision) return json(res, { error: `label conflicts with actor name` }, 409);
          updates.push('label=?'); params.push(data.label.trim());
        } else if (key === 'tier') {
          if (!['quick', 'standard', 'deep'].includes(data.tier)) return json(res, { error: 'invalid tier' }, 400);
          updates.push('tier=?'); params.push(data.tier);
        } else if (key === 'enabled') {
          updates.push('enabled=?'); params.push(data.enabled ? 1 : 0);
        } else {
          updates.push(`${key}=?`); params.push(data[key] ?? null);
        }
      }
    }
    if (!updates.length) return json(res, { error: 'no fields to update' }, 400);
    params.push(id);
    try {
      db.prepare(`UPDATE sub_agents SET ${updates.join(', ')} WHERE id=?`).run(...params);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return json(res, { error: 'label already exists for this agent' }, 409);
      throw e;
    }
    const row = db.prepare('SELECT * FROM sub_agents WHERE id=?').get(id);
    return json(res, row);
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/sub-agents\/\d+$/)) {
    const id = parseInt(url.pathname.split('/')[3]);
    db.prepare('DELETE FROM sub_agents WHERE id=?').run(id);
    res.writeHead(204); return res.end();
  }

  // ── Client auto-update API ──
  if (req.method === 'GET' && url.pathname === '/api/client/manifest') {
    const files = {};
    for (const name of CLIENT_FILES) {
      if (name === 'stoa.js' && !agentBundleReady) continue;
      let hash = clientFileHash(name);
      if (!hash) continue;
      // Monotonic downgrade guard: if stoa.js on disk has changed from startup and is now
      // a lower version than EXPECTED_CLIENT_VERSION, report the startup hash instead.
      // This prevents clients from auto-downloading a downgrade that would send them into a
      // force_update loop (EXPECTED is cached at startup; serving a lower version causes
      // client to restart with client_version < expected indefinitely).
      if (name === 'stoa.js' && SAFE_CLIENT_HASH && EXPECTED_CLIENT_VERSION && hash !== SAFE_CLIENT_HASH) {
        try {
          const diskSrc = fs.readFileSync(clientFilePath(name), 'utf8');
          const m = diskSrc.match(/^(?:const|var)\s+CLIENT_VERSION\s*=\s*['"]([^'"]+)['"]/m);
          const diskVer = m ? m[1] : null;
          if (diskVer && diskVer.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
            console.warn(`[update-guard] stoa.js on disk (v${diskVer}) < expected (v${EXPECTED_CLIENT_VERSION}) — suppressing manifest to prevent downgrade loop`);
            hash = SAFE_CLIENT_HASH;
          }
        } catch {}
      }
      files[name] = hash;
    }
    return json(res, { files });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/client/file/')) {
    const name = path.basename(url.pathname.slice('/api/client/file/'.length));
    if (!CLIENT_FILES.has(name)) { res.writeHead(404); return res.end('Not found'); }
    if (name === 'stoa.js' && !agentBundleReady) {
      console.error('[update] Blocked serving unbundled stoa.js — esbuild build failed at startup');
      res.writeHead(503); return res.end('Agent bundle not available');
    }
    const fp = clientFilePath(name);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(fp));
  }

  // ── Docs ──
  if (req.method === 'GET' && url.pathname === '/api/docs') {
    const docsDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(docsDir)) return json(res, []);
    const slugMap = new Map(); // slug → { langs: Set, enFile }
    for (const f of fs.readdirSync(docsDir).sort()) {
      const parsed = parseDocFilename(f);
      if (!parsed) continue;
      if (!slugMap.has(parsed.slug)) slugMap.set(parsed.slug, { langs: new Set(), enFile: null });
      const entry = slugMap.get(parsed.slug);
      entry.langs.add(parsed.lang);
      if (parsed.lang === 'en') entry.enFile = f;
    }
    const result = [];
    for (const [slug, entry] of slugMap) {
      const titleFile = entry.enFile || `${slug}.md`;
      result.push({
        slug,
        title: docTitle(path.join(__dirname, 'docs', titleFile)),
        langs: [...entry.langs].sort(),
      });
    }
    return json(res, result);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/docs/')) {
    const name = path.basename(url.pathname);
    if (!name.endsWith('.md')) { res.writeHead(400); return res.end('md only'); }
    const fp = path.join(__dirname, 'docs', name);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(fp, 'utf8'));
  }

  // ── Workspace file serve (images, binary files) ──
  if (req.method === 'GET' && url.pathname === '/api/workspace/file') {
    const roomId = url.searchParams.get('room');
    const relPath = url.searchParams.get('path');
    if (!roomId || !relPath) { res.writeHead(400); return res.end('missing room or path'); }
    const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
    if (!roomRow?.workdir_id) { res.writeHead(404); return res.end('no workdir'); }
    const wd = db.prepare('SELECT path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
    if (!wd?.path) { res.writeHead(404); return res.end('workdir not found'); }
    const filePath = path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(wd.path, relPath);
    if (!isPathSafe(filePath, wd.path)) { res.writeHead(403); return res.end('path outside workdir'); }
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.pdf': 'application/pdf' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    return res.end(data);
  }

  // ── Agent install script ──
  if (req.method === 'GET' && url.pathname === '/install.sh') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const wsProto = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const stoaUrl = baseUrl.replace(/^https?/, wsProto);
    const token = crypto.randomBytes(12).toString('hex');
    const presetName = url.searchParams.get('name') || '';
    const lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, lang });

    const clientFiles = 'stoa.js claude-session.js';
    const trustCmd = 'claude --version > /dev/null 2>&1 || true';

    const script = `#!/bin/bash
set -e

BASE_URL="${baseUrl}"
STOA_URL="${stoaUrl}"
REG_TOKEN="${token}"
AGENT_DIR="\${HOME}/stoa-agent"

echo "=== Stoa Agent Setup ==="
echo "Server : \${BASE_URL}"
echo ""

mkdir -p "\${AGENT_DIR}"
mkdir -p "\${HOME}/stoa-workspace"

echo "[1/5] Downloading client files..."
cd "\${AGENT_DIR}"
for FILE in ${clientFiles}; do
  curl -fsSL "\${BASE_URL}/api/client/file/\${FILE}" -o "\${FILE}"
  echo "  ok \${FILE}"
done

echo "[2/5] Installing dependencies..."
npm init -y > /dev/null 2>&1
npm install ws > /dev/null 2>&1
echo "  ok ws"

echo "[3/5] Registering agent..."
RESPONSE=\$(curl -s -X POST "\${BASE_URL}/api/agent/register" \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\":\\"\${REG_TOKEN}\\"}")
ACTOR_ID=\$(echo "\${RESPONSE}" | grep -o '"actor_id":[0-9]*' | grep -o '[0-9]*')
AGENT_NAME=\$(echo "\${RESPONSE}" | grep -o '"name":"[^"]*"' | sed 's/.*"name":"//;s/".*//')
STOA_SECRET=\$(echo "\${RESPONSE}" | grep -o '"secret":"[^"]*"' | sed 's/.*"secret":"//;s/".*//')
if [ -z "\${ACTOR_ID}" ]; then
  echo "  Registration failed: \${RESPONSE}"
  exit 1
fi
echo "  ok Actor #\${ACTOR_ID} (\${AGENT_NAME})"

echo "[4/5] Approving workspace trust..."
cd "\${HOME}/stoa-workspace"
${trustCmd}
cd "\${AGENT_DIR}"

echo "[5/5] Setting up PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2 > /dev/null 2>&1 || npm install -g pm2 > /dev/null 2>&1
fi

cat > ecosystem.config.js << EOFCFG
module.exports = {
  apps: [{
    name: '\${AGENT_NAME}',
    script: 'stoa.js',
    cwd: process.env.HOME + '/stoa-agent',
    env: {
      STOA_URL: '\${STOA_URL}',
      STOA_TYPE: 'ai',
      STOA_ACTOR_ID: '\${ACTOR_ID}',
      STOA_SECRET: '\${STOA_SECRET}',
      STOA_WORK_DIR: process.env.HOME + '/stoa-workspace',
    },
    restart_delay: 3000,
    max_restarts: 50,
    autorestart: true,
  }]
};
EOFCFG

pm2 stop "\${AGENT_NAME}" 2>/dev/null || true
pm2 delete "\${AGENT_NAME}" 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup 2>/dev/null | grep -E "sudo|^[A-Z]" | head -1 | bash 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Actor  : #\${ACTOR_ID} (\${AGENT_NAME})"
echo "Status : pm2 status"
echo "Logs   : pm2 logs \${AGENT_NAME}"
`;

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Windows PowerShell installer ──
  if (req.method === 'GET' && url.pathname === '/install.ps1') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const wsProto = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const stoaUrl = baseUrl.replace(/^https?/, wsProto);
    const token = crypto.randomBytes(12).toString('hex');
    const presetName = url.searchParams.get('name') || '';
    const ps1Lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, lang: ps1Lang });

    const ps1Files = '"stoa.js","claude-session.js"';
    const ps1TrustCmd = 'try { & claude --version 2>$null } catch {}';

    const script = `$ErrorActionPreference = "Stop"
$BaseUrl = "${baseUrl}"
$StoaUrl = "${stoaUrl}"
$RegToken = "${token}"
$AgentDir = "$env:USERPROFILE\\stoa-agent"
$WorkDir  = "$env:USERPROFILE\\stoa-workspace"

Write-Host "=== Stoa Agent Setup ==="
Write-Host "Server : $BaseUrl"
Write-Host ""

New-Item -ItemType Directory -Force $AgentDir | Out-Null
New-Item -ItemType Directory -Force $WorkDir  | Out-Null

Write-Host "[1/5] Downloading client files..."
foreach ($file in @(${ps1Files})) {
  Invoke-WebRequest "$BaseUrl/api/client/file/$file" -OutFile "$AgentDir\\$file" -UseBasicParsing
  Write-Host "  ok $file"
}

Write-Host "[2/5] Installing dependencies..."
Set-Location $AgentDir
npm init -y 2>&1 | Out-Null
npm install ws 2>&1 | Out-Null
Write-Host "  ok ws"

Write-Host "[3/5] Registering agent..."
$body = '{"token":"' + $RegToken + '"}'
$resp = Invoke-RestMethod -Uri "$BaseUrl/api/agent/register" -Method Post -ContentType "application/json" -Body $body
$ActorId   = $resp.actor_id
$AgentName = $resp.name
$Secret    = $resp.secret
if (-not $ActorId) { Write-Error "Registration failed"; exit 1 }
Write-Host "  ok Actor #$ActorId ($AgentName)"

Write-Host "[4/5] Approving workspace trust..."
Set-Location $WorkDir
${ps1TrustCmd}
Set-Location $AgentDir

Write-Host "[5/5] Setting up PM2..."
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2 }

@"
module.exports = {
  apps: [{
    name: '$AgentName',
    script: 'stoa.js',
    cwd: require('os').homedir() + '/stoa-agent',
    env: {
      STOA_URL: '$StoaUrl',
      STOA_TYPE: 'ai',
      STOA_ACTOR_ID: String($ActorId),
      STOA_SECRET: '$Secret',
      STOA_WORK_DIR: require('os').homedir() + '/stoa-workspace',
    },
    restart_delay: 3000,
    max_restarts: 50,
    autorestart: true,
  }]
};
"@ | Out-File -Encoding utf8 "$AgentDir\\ecosystem.config.js"

try { pm2 stop $AgentName 2>$null } catch {}
try { pm2 delete $AgentName 2>$null } catch {}
pm2 start "$AgentDir\\ecosystem.config.js"
pm2 save

Write-Host ""
Write-Host "=== Done ==="
Write-Host "Actor  : #$ActorId ($AgentName)"
Write-Host "Status : pm2 status"
Write-Host "Logs   : pm2 logs $AgentName"
`;

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Windows CMD installer (proxies to PS1) ──
  if (req.method === 'GET' && url.pathname === '/install.cmd') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const cmdParams = [];
    if (url.searchParams.get('name')) cmdParams.push(`name=${encodeURIComponent(url.searchParams.get('name'))}`);
    if (url.searchParams.get('lang')) cmdParams.push(`lang=${encodeURIComponent(url.searchParams.get('lang'))}`);
    const qs = cmdParams.length ? '?' + cmdParams.join('&') : '';
    const script = `@echo off\r\npowershell -ExecutionPolicy Bypass -Command "irm '${baseUrl}/install.ps1${qs}' | iex"\r\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Agent registration ──
  if (req.method === 'POST' && url.pathname === '/api/agent/register') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { token } = data;
    const entry = installTokens.get(token);
    if (!entry || entry.expires < Date.now()) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'invalid or expired token' }));
    }
    installTokens.delete(token);
    const suffix = crypto.randomBytes(3).toString('hex');
    const name = (entry.name || '').trim() || `stoa-${suffix}`;
    const secret = crypto.randomBytes(32).toString('hex');
    const adapter = 'claude';
    const adapterConfig = JSON.stringify({ lang: entry.lang || 'en' });
    const result = db.prepare(
      `INSERT INTO actors (name, type, adapter, adapter_config, avatar_color, avatar_symbol, secret) VALUES (?, 'ai', ?, ?, '#4d9f9f', '◈', ?)`
    ).run(name, adapter, adapterConfig, secret);
    return json(res, { actor_id: result.lastInsertRowid, name, secret, adapter });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/invites/') && url.pathname.endsWith('/resolve')) {
    const inviteId = url.pathname.split('/')[3];
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const invite = db.prepare('SELECT * FROM invite_suggestions WHERE id=?').get(inviteId);
    if (!invite) { res.writeHead(404); return res.end(JSON.stringify({ error: 'invite not found' })); }
    const { approved } = data;
    const status = approved ? 'approved' : 'rejected';
    db.prepare("UPDATE invite_suggestions SET status=?, resolved_at=datetime('now') WHERE id=?").run(status, inviteId);
    if (approved) {
      db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id, invited_by) VALUES (?,?,?)').run(
        invite.room_id, invite.suggested_actor_id, invite.suggested_by_participant_id
      );
      broadcast(invite.room_id, { type: 'participant_joined', actor_id: invite.suggested_actor_id });
    }
    return json(res, { ok: true });
  }

  // GET /api/actors/:id/workdirs — list workdirs for an agent
  if (req.method === 'GET' && url.pathname.match(/^\/api\/actors\/\d+\/workdirs$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const rows = db.prepare(
      'SELECT id, path, label, is_default FROM agent_workdirs WHERE actor_id=? ORDER BY is_default DESC, id ASC'
    ).all(actorId);
    return json(res, rows);
  }

  // POST /api/actors/:id/workdirs — request agent to create a new workdir
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/workdirs$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { path: dirPath } = data;
    if (!dirPath?.trim()) { res.writeHead(400); return res.end('path required'); }
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'create_workdir', path: dirPath.trim() }));
    const labelProvided = 'label' in data;
    if (labelProvided) {
      const labelValue = (data.label || '').trim() || null;
      db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label'
      ).run(actorId, dirPath.trim(), labelValue);
    } else {
      db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0) ON CONFLICT(actor_id, path) DO NOTHING'
      ).run(actorId, dirPath.trim(), null);
    }
    const wd = db.prepare('SELECT id, path, label, is_default FROM agent_workdirs WHERE actor_id=? AND path=?').get(actorId, dirPath.trim());
    return json(res, wd);
  }

  // POST /api/actors/:id/force-update — ask agent to check for updates immediately
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/force-update$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'force_update' }));
    return json(res, { ok: true });
  }

  // POST /api/actors/:id/rescan — ask agent to re-scan workdirs & skills
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/rescan$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'request_scan' }));
    return json(res, { ok: true });
  }

  // GET /api/actors/:id/memory — list agent memory files
  if (req.method === 'GET' && url.pathname.match(/^\/api\/actors\/\d+\/memory$/)) {
    if (!requireAuth(req, res, url)) return;
    const actorId = parseInt(url.pathname.split('/')[3]);
    const BUDGETS = { 'MEMORY.md': 2200, 'USER.md': 1375 };
    const files = ['MEMORY.md', 'USER.md'].map(file => {
      const row = db.prepare('SELECT content, updated_at FROM agent_memory WHERE actor_id=? AND file=?').get(actorId, file);
      const content = row?.content ?? '';
      return { file, content, char_count: content.length, budget: BUDGETS[file], updated_at: row?.updated_at ?? null };
    });
    return json(res, { files });
  }

  // PUT /api/actors/:id/memory/:file — update one agent memory file
  if (req.method === 'PUT' && url.pathname.match(/^\/api\/actors\/\d+\/memory\/(MEMORY\.md|USER\.md)$/)) {
    if (!requireAuth(req, res, url)) return;
    const parts = url.pathname.split('/');
    const actorId = parseInt(parts[3]);
    const file = parts[5];
    const BUDGETS = { 'MEMORY.md': 2200, 'USER.md': 1375 };
    const data = parseJsonBody(await readBody(req));
    if (!data || typeof data.content !== 'string') return json(res, { error: 'content (string) required' }, 400);
    const budget = BUDGETS[file];
    if (data.content.length > budget) return json(res, { error: `content exceeds ${budget} char budget` }, 400);
    db.prepare(
      "INSERT INTO agent_memory (actor_id, file, content, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(actor_id, file) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"
    ).run(actorId, file, data.content);
    const row = db.prepare('SELECT content, updated_at FROM agent_memory WHERE actor_id=? AND file=?').get(actorId, file);
    return json(res, { file, content: row.content, char_count: row.content.length, budget, updated_at: row.updated_at });
  }

  // PUT /api/actors/:id/config — update name, lang, adapter_config fields
  if (req.method === 'PUT' && url.pathname.match(/^\/api\/actors\/\d+\/config$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name, lang, adapter_config: newCfg } = body;
    if (name !== undefined && !name?.trim()) { res.writeHead(400); return res.end('name required'); }
    if (name !== undefined) db.prepare('UPDATE actors SET name=? WHERE id=?').run(name.trim(), actorId);
    if (lang !== undefined || (newCfg && typeof newCfg === 'object')) {
      const existing = (() => { try { return JSON.parse(db.prepare('SELECT adapter_config FROM actors WHERE id=?').get(actorId)?.adapter_config || '{}'); } catch { return {}; } })();
      if (lang !== undefined) existing.lang = lang;
      if (newCfg && typeof newCfg === 'object') Object.assign(existing, newCfg);
      db.prepare('UPDATE actors SET adapter_config=? WHERE id=?').run(JSON.stringify(existing), actorId);
    }
    const actor = db.prepare('SELECT id, name, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(actorId);
    return json(res, actor);
  }



  // ── Export room messages ──
  const exportMatch = req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/(\d+)\/export$/);
  if (exportMatch) {
    const roomId = parseInt(exportMatch[1]);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const room = db.prepare('SELECT title FROM rooms WHERE id=?').get(roomId);
    if (!room) { res.writeHead(404); return res.end('room not found'); }
    const rows = db.prepare(`
      SELECT m.id, m.content, m.created_at, m.completed_at, m.image_url, m.file_url, m.file_name, m.attachments, m.reply_to,
             a.name as actor_name, a.type as actor_type
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.room_id=? AND m.state='complete'
      ORDER BY m.created_at ASC
    `).all(roomId);

    const safeTitle = room.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);

    if (format === 'csv') {
      const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
      const header = 'id,timestamp,actor,type,content,attachments,reply_to';
      const lines = rows.map(r => {
        let parsedAtt; try { parsedAtt = r.attachments ? JSON.parse(r.attachments) : null; } catch { parsedAtt = null; }
        const attachments = parsedAtt ? parsedAtt.map(a => a.name || a.url).join('; ') : (r.file_name || '');
        return [r.id, r.created_at, escape(r.actor_name), r.actor_type, escape(r.content), escape(attachments), r.reply_to || ''].join(',');
      });
      const csv = [header, ...lines].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}.csv"`,
      });
      return res.end(csv);
    }

    // Default: JSON
    const data = { room: { id: roomId, title: room.title }, exported_at: new Date().toISOString(), messages: rows.map(r => { let att = null; try { att = r.attachments ? JSON.parse(r.attachments) : null; } catch { att = null; } return { ...r, attachments: att }; }) };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeTitle}.json"`,
    });
    return res.end(JSON.stringify(data, null, 2));
  }

  // ── Automation: Connections CRUD ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/automations/connections') {
    const rows = db.prepare('SELECT id,name,provider,token_type,credentials,metadata,status,error_msg,created_at FROM automation_connections ORDER BY id ASC').all();
    return json(res, rows.map(r => {
      let meta = {}; try { meta = JSON.parse(r.metadata || '{}'); } catch {}
      let creds = {}; try { creds = JSON.parse(r.credentials || '{}'); } catch {}
      const { credentials: _c, ...rest } = r;
      return { ...rest, metadata: meta, appToken: creds.appToken || '', token: creds.token || '' };
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/automations/connections') {
    const body = parseJsonBody(await readBody(req));
    const provider = body?.provider || 'slack';
    if (!['slack', 'whatsapp'].includes(provider)) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid provider' }));
    }

    let creds, tokenType, initialMeta;
    if (provider === 'slack') {
      if (!body?.name || !body?.appToken || !body?.token) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'name, appToken, token required' }));
      }
      tokenType = body.tokenType || 'bot';
      if (!['bot', 'user'].includes(tokenType)) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid tokenType' }));
      }
      creds = JSON.stringify({ appToken: body.appToken, token: body.token });
      initialMeta = '{}';
    } else { // whatsapp
      if (!body?.name) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' }));
      }
      tokenType = 'qr';
      creds = '{}';
      initialMeta = '{}'; // sessionDir set after insert (needs id)
    }

    const result = db.prepare(
      'INSERT INTO automation_connections (name,provider,token_type,credentials,metadata,status) VALUES (?,?,?,?,?,?)'
    ).run((body.name || '').trim(), provider, tokenType, creds, initialMeta, 'connecting');
    const connId = Number(result.lastInsertRowid);

    // For WA: set sessionDir now that we have the connection id
    if (provider === 'whatsapp') {
      const waMeta = JSON.stringify({
        sessionDir: `.wa-sessions/${connId}`,
        phoneNumber: (body.phoneNumber || '').trim(),
      });
      db.prepare("UPDATE automation_connections SET metadata=? WHERE id=?").run(waMeta, connId);
    }

    const conn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(connId);
    try {
      await connectionManager.startConnection(conn, updateConnStatus);
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(conn.id);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      return json(res, { ...updated, metadata: meta });
    } catch (e) {
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(conn.id);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      res.writeHead(500); return res.end(JSON.stringify({ ...updated, metadata: meta, error: e.message }));
    }
  }

  const connMatch = url.pathname.match(/^\/api\/automations\/connections\/(\d+)(\/.*)?$/);
  if (connMatch) {
    const connId = Number(connMatch[1]);
    const sub = connMatch[2] || '';
    const conn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(connId);
    if (!conn) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }

    if (req.method === 'GET' && sub === '') {
      let meta = {}; try { meta = JSON.parse(conn.metadata || '{}'); } catch {}
      let creds2 = {}; try { creds2 = JSON.parse(conn.credentials || '{}'); } catch {}
      return json(res, { id: conn.id, name: conn.name, provider: conn.provider,
        token_type: conn.token_type, metadata: meta, status: conn.status,
        error_msg: conn.error_msg, created_at: conn.created_at,
        appToken: creds2.appToken || '', token: creds2.token || '' });
    }

    if (req.method === 'PATCH' && sub === '') {
      const body = parseJsonBody(await readBody(req));
      const name = body.name !== undefined ? body.name.trim() : conn.name;
      if (!name) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name cannot be empty' })); }
      let creds = {}; try { creds = JSON.parse(conn.credentials || '{}'); } catch {}
      let meta3 = {}; try { meta3 = JSON.parse(conn.metadata || '{}'); } catch {}
      let tokenType = conn.token_type;
      let tokenChanged = false;
      if (conn.provider === 'whatsapp') {
        if (body.phoneNumber !== undefined)   meta3.phoneNumber   = (body.phoneNumber || '').trim();
        if (body.maxMediaSizeMb !== undefined) meta3.maxMediaSizeMb = Number(body.maxMediaSizeMb) || 100;
        db.prepare("UPDATE automation_connections SET name=?,metadata=?,updated_at=datetime('now') WHERE id=?")
          .run(name, JSON.stringify(meta3), connId);
      } else {
        if (body.appToken) { creds.appToken = body.appToken; tokenChanged = true; }
        if (body.token)    { creds.token    = body.token;    tokenChanged = true; }
        if (body.tokenType && !['bot','user'].includes(body.tokenType)) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid tokenType' }));
        }
        tokenType = body.tokenType || conn.token_type;
        db.prepare("UPDATE automation_connections SET name=?,token_type=?,credentials=?,updated_at=datetime('now') WHERE id=?")
          .run(name, tokenType, JSON.stringify(creds), connId);
        if (tokenChanged && conn.status === 'connected') {
          await connectionManager.stopConnection(connId);
          db.prepare("UPDATE automation_connections SET status='disconnected',updated_at=datetime('now') WHERE id=?").run(connId);
        }
      }
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      return json(res, { ...updated, metadata: meta });
    }

    if (req.method === 'POST' && sub === '/disconnect') {
      await connectionManager.stopConnection(connId);
      db.prepare("UPDATE automation_connections SET status='disconnected',updated_at=datetime('now') WHERE id=?").run(connId);
      return json(res, { ok: true });
    }

    if (req.method === 'POST' && sub === '/reconnect') {
      db.prepare("UPDATE automation_connections SET status='connecting',updated_at=datetime('now') WHERE id=?").run(connId);
      const freshConn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(connId);
      try {
        await connectionManager.startConnection(freshConn, updateConnStatus);
        const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
        let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
        return json(res, { ...updated, metadata: meta });
      } catch (e) {
        const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
        let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
        res.writeHead(500); return res.end(JSON.stringify({ ...updated, metadata: meta, error: e.message }));
      }
    }

    if (req.method === 'GET' && sub === '/messages') {
      const chatId = url.searchParams.get('chatId');
      if (!chatId) { res.writeHead(400); return res.end(JSON.stringify({ error: 'chatId is required' })); }
      const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
      if (conn.provider === 'whatsapp') {
        const rows = db.prepare(`
          SELECT sender, text, direction, media_type, created_at
          FROM wa_incoming_messages
          WHERE connection_id=? AND chat_id=?
          ORDER BY created_at DESC LIMIT ?
        `).all(connId, chatId, limit);
        return json(res, rows.reverse().map(r => ({
          sender: r.direction === 'out' ? 'bot' : r.sender,
          text: r.text, direction: r.direction,
          media_type: r.media_type || null, timestamp: r.created_at,
        })));
      }
      res.writeHead(400); return res.end(JSON.stringify({ error: 'history only available for whatsapp connections' }));
    }

    if (req.method === 'DELETE' && sub === '') {
      if (connectionManager.isRunning(connId)) {
        res.writeHead(409); return res.end(JSON.stringify({ error: 'Disconnect first' }));
      }
      db.prepare('DELETE FROM automation_connections WHERE id=?').run(connId);
      return json(res, { ok: true });
    }
    res.writeHead(405); return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // ── Automation: CRUD ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/automations') {
    const rows = db.prepare('SELECT * FROM automations ORDER BY id DESC').all();
    return json(res, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/automations') {
    const body = parseJsonBody(await readBody(req));
    if (!body?.name || !body?.trigger_event || !body?.target_room_id || !body?.prompt_template) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'Missing required fields' }));
    }
    const rawConds = body.trigger_conditions || '[]';
    const condsErr = validateConditions(rawConds);
    if (condsErr) { res.writeHead(400); return res.end(JSON.stringify({ error: condsErr })); }
    const result = db.prepare(`
      INSERT INTO automations (name, trigger_type, trigger_event, trigger_conditions, target_room_id, prompt_template, connection_id, reply_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.name.trim(),
      body.trigger_type || 'slack',
      body.trigger_event,
      typeof rawConds === 'string' ? rawConds : JSON.stringify(rawConds),
      parseInt(body.target_room_id),
      body.prompt_template.trim(),
      parseInt(body.connection_id) || null,
      body.reply_mode || 'none',
    );
    const row = db.prepare('SELECT * FROM automations WHERE id=?').get(result.lastInsertRowid);
    return json(res, row);
  }

  const autoIdMatch = url.pathname.match(/^\/api\/automations\/(\d+)$/);
  if (autoIdMatch) {
    const autoId = parseInt(autoIdMatch[1]);
    if (req.method === 'PATCH') {
      const body = parseJsonBody(await readBody(req));
      if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
      const auto = db.prepare('SELECT * FROM automations WHERE id=?').get(autoId);
      if (!auto) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }
      const name        = body.name !== undefined        ? body.name.trim()                          : auto.name;
      const event       = body.trigger_event !== undefined ? body.trigger_event                       : auto.trigger_event;
      let   conds       = body.trigger_conditions !== undefined ? body.trigger_conditions             : auto.trigger_conditions;
      if (body.trigger_conditions !== undefined) {
        const condsErr = validateConditions(conds);
        if (condsErr) { res.writeHead(400); return res.end(JSON.stringify({ error: condsErr })); }
      }
      const roomId      = body.target_room_id !== undefined ? parseInt(body.target_room_id)          : auto.target_room_id;
      const prompt      = body.prompt_template !== undefined ? body.prompt_template.trim()           : auto.prompt_template;
      const enabled     = body.enabled !== undefined     ? (body.enabled ? 1 : 0)                    : auto.enabled;
      const connId      = body.connection_id !== undefined ? (parseInt(body.connection_id) || null)  : auto.connection_id;
      const replyMode   = body.reply_mode !== undefined    ? (body.reply_mode || 'none')              : (auto.reply_mode || 'none');
      db.prepare(`
        UPDATE automations SET name=?, trigger_event=?, trigger_conditions=?, target_room_id=?, prompt_template=?, enabled=?, connection_id=?, reply_mode=? WHERE id=?
      `).run(name, event, conds, roomId, prompt, enabled, connId, replyMode, autoId);
      const updated = db.prepare('SELECT * FROM automations WHERE id=?').get(autoId);
      return json(res, updated);
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM automations WHERE id=?').run(autoId);
      return json(res, { ok: true });
    }
  }

  // Ollama Cloud proxy — forward /v1/messages to ollama.com with API key rotation
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    // Bearer token carries platform_id: "stoa-proxy:<id>". Fall back to first vendor='ollama' for legacy callers.
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const proxyPlatId = bearer.startsWith('stoa-proxy:') ? bearer.slice('stoa-proxy:'.length) : null;
    const plat = (proxyPlatId && platforms.find(p => p.id === proxyPlatId && p.vendor === 'ollama'))
      || platforms.find(p => p.vendor === 'ollama')
      || platforms.find(p => p.base_url?.includes('ollama.com'));
    if (!plat) { res.writeHead(503); return res.end(JSON.stringify({ type: 'error', error: { type: 'service_unavailable', message: 'No Ollama Cloud platform configured' } })); }
    const keys = getPlatKeys(plat);
    if (!keys.length) { res.writeHead(503); return res.end(JSON.stringify({ type: 'error', error: { type: 'service_unavailable', message: 'No API keys configured for Ollama Cloud' } })); }

    const body = await readBody(req);
    const TARGET = 'https://ollama.com/v1/messages';

    async function tryWithKey(keyIdx) {
      if (keyIdx >= keys.length) return null;
      const fwdHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys[keyIdx]}`,
      };
      if (req.headers['anthropic-version']) fwdHeaders['anthropic-version'] = req.headers['anthropic-version'];
      if (req.headers['anthropic-beta']) fwdHeaders['anthropic-beta'] = req.headers['anthropic-beta'];
      let connTimer;
      try {
        const ctrl = new AbortController();
        connTimer = setTimeout(() => ctrl.abort(), 30000);
        const upstream = await fetch(TARGET, { method: 'POST', headers: fwdHeaders, body, signal: ctrl.signal });
        clearTimeout(connTimer);
        // 429=rate-limited, 401=key invalid (next key may be valid), 402=quota exhausted (next key may have remaining quota)
        if (upstream.status === 429 || upstream.status === 401 || upstream.status === 402) {
          const next = await tryWithKey(keyIdx + 1);
          return next || upstream;
        }
        return upstream;
      } catch (e) {
        clearTimeout(connTimer);
        return tryWithKey(keyIdx + 1);
      }
    }

    let reqModel = '?';
    try { reqModel = JSON.parse(body)?.model || '?'; } catch {}
    const upstream = await tryWithKey(0);
    if (!upstream) { res.writeHead(502); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Ollama Cloud unreachable' } })); }
    console.log(`[ollama-proxy] ${reqModel} → ollama.com status=${upstream.status}`);

    const isStream = upstream.headers.get('content-type')?.includes('text/event-stream');
    const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
    if (isStream) { headers['Cache-Control'] = 'no-cache'; headers['X-Accel-Buffering'] = 'no'; }
    res.writeHead(upstream.status, headers);

    if (isStream) {
      const reader = upstream.body.getReader();
      res.on('close', () => reader.cancel());
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          // res.write() back-pressure (drain) not awaited — acceptable for single-user loopback
          // where downstream drains faster than upstream LLM generates. TODO: add drain handling
          // if Stoa ever serves remote or multi-tenant clients.
          res.write(value);
        }
      };
      pump().catch(() => res.end());
    } else {
      const text = await upstream.text();
      res.end(text);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
  } catch (err) {
    console.error('[http] unhandled error:', err.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' })); }
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, pingInterval: 20000 });
const roomClients = new Map();    // roomId → Set<ws>
const globalClients = new Set();  // all browser ws connections
const agentClients = new Map();   // actor_id → ws
const agentVersions = new Map();  // actor_id → client_version string
const pendingAgents = new Map();    // message_id → { resolve, reject }
const pendingActorMeta = new Map(); // message_id → { name, avatar_color, avatar_symbol }
const pendingCompacts = new Map();  // room_id → { total, completed, agents[] }
const recentCompacts = new Map();      // room_id → timestamp — suppresses duplicate auto_compact_start within 30s
const recentCompactTimers = new Map(); // room_id → timer handle — cleared before reset to avoid early expiry
let reauthProcess = null;  // true when remote reauth is in progress
let reauthRoomId = null;   // room that triggered /reauth
let reauthAgentActorId = null; // actor_id of the agent handling reauth
let reauthTimer = null;    // timeout handle for reauth
function setRecentCompact(roomId) {
  clearTimeout(recentCompactTimers.get(roomId));
  recentCompacts.set(roomId, Date.now());
  recentCompactTimers.set(roomId, setTimeout(() => { recentCompacts.delete(roomId); recentCompactTimers.delete(roomId); }, 30_000));
}
const pendingFileOps = new Map();   // request_id → { type, clientWs }
function addPendingFileOp(rid, op) {
  pendingFileOps.set(rid, op);
  setTimeout(() => pendingFileOps.delete(rid), 15000);
}

function broadcastGlobal(data) {
  const str = JSON.stringify(data);
  for (const client of globalClients) {
    if (client.readyState === 1) client.send(str);
  }
}

function broadcastServerRestart(newPort, newWsUrl) {
  const payload = JSON.stringify({ type: 'server_restart', new_port: newPort, new_ws_url: newWsUrl });
  for (const client of globalClients) {
    if (client.readyState === 1) client.send(payload);
  }
  for (const [, agentWs] of agentClients) {
    if (agentWs.readyState === 1) agentWs.send(payload);
  }
  console.log(`[server] Port change → ${newPort}, notified ${globalClients.size} browsers + ${agentClients.size} agents`);
}

wss.on('connection', (ws, req) => {
  // Origin validation: reject cross-origin browser connections (CSWSH prevention)
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      const host = req.headers.host?.split(':')[0];
      if (o.hostname !== host && o.hostname !== 'localhost' && o.hostname !== '127.0.0.1') {
        ws.close(1008, 'Origin not allowed');
        return;
      }
    } catch { ws.close(1008, 'Invalid origin'); return; }
  }

  let subscribedRoom = null;
  let agentActorId = null;
  let isHumanClient = false;
  // Auth check: browser clients must have valid session cookie
  const cookies = parseCookies(req.headers.cookie);
  const wsAuth = validateAuthSession(cookies.stoa_session);
  let wsAuthenticated = !!wsAuth; // agents authenticate later via agent_connect

  ws.on('error', () => {}); // prevent unhandled error crash on abrupt disconnect

  ws.on('message', async raw => {
   try {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Block unauthenticated browser messages (agents auth via agent_connect)
    if (!wsAuthenticated && msg.type !== 'agent_connect') return;

    // ── Human client subscribes to global events (sent on WS open)
    if (msg.type === 'subscribe_global') {
      if (!isHumanClient) { isHumanClient = true; globalClients.add(ws); }
    }

    // ── Human client joins a room
    if (msg.type === 'join_room') {
      if (!isHumanClient) { isHumanClient = true; globalClients.add(ws); }
      subscribedRoom = msg.room_id;
      if (!roomClients.has(subscribedRoom)) roomClients.set(subscribedRoom, new Set());
      roomClients.get(subscribedRoom).add(ws);
      const messages = db.prepare(`
        SELECT * FROM (
          SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
          FROM messages m
          JOIN room_participants rp ON rp.id=m.participant_id
          JOIN actors a ON a.id=rp.actor_id
          WHERE m.room_id=? AND (
            (m.state IN ('complete','streaming','requesting') AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL OR m.state IN ('streaming','requesting')))
            OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
            OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
          )
          ORDER BY m.created_at DESC LIMIT 100
        ) AS recent ORDER BY created_at ASC
      `).all(subscribedRoom);
      ws.send(JSON.stringify({ type: 'history', messages: enrichReply(messages) }));
      // Restore compact state if room is currently compacting
      if (pendingCompacts.has(subscribedRoom)) {
        const cs = pendingCompacts.get(subscribedRoom);
        ws.send(JSON.stringify({ type: 'compact_start', room_id: subscribedRoom, total: cs.total, participants: cs.targets || [] }));
        if (cs.completed > 0) ws.send(JSON.stringify({ type: 'compact_progress', room_id: subscribedRoom, completed: cs.completed, total: cs.total, completed_participant_ids: cs.completedParticipantIds || [] }));
      }
    }

    if (msg.type === 'send_message') {
      // /reauth: human-only command that spawns claude auth login and captures the OAuth URL
      if (msg.content?.trim() === '/reauth' && !agentActorId) {
        handleReauth(msg.room_id);
        return;
      }
      // REAUTH:<code>: user pastes the OAuth code returned by the browser after authorizing
      if (reauthProcess && !agentActorId && msg.content?.startsWith('REAUTH:')) {
        if (reauthRoomId !== msg.room_id) return;
        const code = msg.content.slice('REAUTH:'.length).trim();
        const aw = agentClients.get(reauthAgentActorId);
        if (code && aw?.readyState === 1) aw.send(JSON.stringify({ type: 'reauth_code', code }));
        return;
      }
      // /logout: human-only, runs claude auth logout for the agent in this room
      if (msg.content?.trim() === '/logout' && !agentActorId) {
        handleLogout(msg.room_id);
        return;
      }
      let handled = false;
      if (msg.content?.startsWith('/')) {
        handled = await handleSkillCommand(msg.room_id, msg.content, ws);
      }
      if (!handled) {
        const wsEventId = typeof msg.event_id === 'string' && msg.event_id.length <= 128 ? msg.event_id : null;
        await handleHumanMessage(msg.room_id, msg.content, msg.attachments || null, msg.reply_to || null, ws, wsEventId);
      }
    }

    if (msg.type === 'stop_generation') {
      // Cancel the active sequence for this room
      const seq = activeSequences.get(msg.room_id);
      if (seq) seq.cancelled = true;

      const msgRow = db.prepare(
        'SELECT rp.actor_id FROM messages m JOIN room_participants rp ON rp.id=m.participant_id WHERE m.id=?'
      ).get(msg.message_id);
      if (msgRow) {
        const agentWs = agentClients.get(msgRow.actor_id);
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: 'cancel_generation', message_id: msg.message_id, room_id: msg.room_id }));
        }
      }
    }

    if (msg.type === 'compact_session' && !agentActorId) {
      const roomId = msg.room_id;
      if (pendingCompacts.has(roomId)) return;
      const aiParts = db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai'
      `).all(roomId);
      // Batch-fetch sessions for all participants (avoids N+1)
      const sessionMap = new Map();
      if (aiParts.length) {
        const ph = aiParts.map(() => '?').join(',');
        const allSessions = db.prepare(
          `SELECT participant_id, claude_session_id FROM ai_sessions WHERE participant_id IN (${ph}) AND room_id=? AND sub_agent_id IS NULL ORDER BY last_active_at DESC`
        ).all(...aiParts.map(a => a.participant_id), roomId);
        for (const s of allSessions) {
          if (!sessionMap.has(s.participant_id)) sessionMap.set(s.participant_id, s);
        }
      }
      const nowIso = new Date().toISOString();
      const targets = [];
      for (const ai of aiParts) {
        const agentWs = agentClients.get(ai.actor_id);
        if (!agentWs || agentWs.readyState !== 1) continue;
        const sessionRow = sessionMap.get(ai.participant_id);
        if (!sessionRow?.claude_session_id) continue;
        // R14: skip agents still in compact failure cooldown
        const sessRow = db.prepare('SELECT compact_failure_cooldown_until FROM ai_sessions WHERE participant_id=? AND room_id=? AND sub_agent_id IS NULL').get(ai.participant_id, roomId);
        if (sessRow?.compact_failure_cooldown_until && sessRow.compact_failure_cooldown_until > nowIso) {
          console.warn(`[server] compact_session: skipping agent=${ai.actor_id} (failure cooldown until ${sessRow.compact_failure_cooldown_until})`);
          continue;
        }
        // Resolve the workdir the same way dispatch does, so compact targets the dir where this
        // agent actually ran — not a stale stored value or the room workdir.
        const workdir = resolveParticipantWorkdir(ai.participant_id);
        targets.push({ actor_id: ai.actor_id, participant_id: ai.participant_id, name: ai.name, workdir, claude_session_id: sessionRow.claude_session_id });
      }
      if (!targets.length) {
        ws.send(JSON.stringify({ type: 'compact_error', room_id: roomId, error: 'No active AI sessions to compact' }));
        return;
      }
      pendingCompacts.set(roomId, { total: targets.length, completed: 0, agents: targets.map(t => t.actor_id), targets, completedParticipantIds: [] });
      const participants = targets.map(t => ({ participant_id: t.participant_id, actor_id: t.actor_id, name: t.name }));
      broadcast(roomId, { type: 'compact_start', room_id: roomId, total: targets.length, participants });
      const names = targets.map(t => t.name).join(', ');
      broadcast(roomId, { type: 'system_event', actor_name: names, status: 'session compacting' });
      setTimeout(() => {
        if (pendingCompacts.has(roomId)) {
          pendingCompacts.delete(roomId);
          setRecentCompact(roomId); // suppress immediate re-register from auto_compact_start while original compact still finishing
          broadcast(roomId, { type: 'compact_error', room_id: roomId, error: 'Compact timed out' });
        }
      }, 600_000);
      for (const t of targets) {
        const agentWs = agentClients.get(t.actor_id);
        if (!agentWs || agentWs.readyState !== 1) continue;
        agentWs.send(JSON.stringify({ type: 'compact_trigger', room_id: roomId, workdir: t.workdir, claude_session_id: t.claude_session_id }));
      }
    }

    if (msg.type === 'invite_suggest' && agentActorId) {
      await handleInviteSuggest(msg.room_id, msg.suggested_by_participant_id, msg.suggested_actor_id, msg.reason);
    }

    // ── AI agent connects and identifies itself
    if (msg.type === 'agent_connect') {
      const actor = db.prepare(`SELECT id, secret FROM actors WHERE id=? AND type='ai'`).get(msg.actor_id);
      if (!actor) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'actor not found' }));
        ws.close(); return;
      }
      if (!actor.secret) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'actor has no secret configured' }));
        ws.close(); return;
      }
      const provided = String(msg.secret || '');
      const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
      if (!crypto.timingSafeEqual(h(actor.secret), h(provided))) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'invalid secret' }));
        ws.close(); return;
      }
      agentActorId = msg.actor_id;
      wsAuthenticated = true;
      const oldWs = agentClients.get(agentActorId);
      if (oldWs && oldWs !== ws) oldWs.close();
      agentClients.set(agentActorId, ws);
      const reconnectCleaned = db.prepare(
        "UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — agent reconnected)' ELSE content END WHERE state IN ('streaming','requesting') AND participant_id IN (SELECT rp.id FROM room_participants rp WHERE rp.actor_id=?)"
      ).run(agentActorId);
      if (reconnectCleaned.changes) console.log(`[agent] Cleaned ${reconnectCleaned.changes} orphaned message(s) on reconnect for Actor #${agentActorId}`);
      if (msg.client_version) agentVersions.set(agentActorId, msg.client_version);
      console.log(`[agent] Actor #${agentActorId} connected (v${msg.client_version || '?'})`);
      if (EXPECTED_CLIENT_VERSION && msg.client_version && msg.client_version.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
        console.log(`[agent] Actor #${agentActorId} outdated (v${msg.client_version} < v${EXPECTED_CLIENT_VERSION}), sending force_update`);
        ws.send(JSON.stringify({ type: 'force_update' }));
      }
      ws.send(JSON.stringify({ type: 'agent_ready' }));
      ws.send(JSON.stringify({ type: 'set_config', max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 1, session_idle_ttl: parseInt(process.env.SESSION_IDLE_TTL) || 5, auto_compact_threshold_kb: parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB) || 500 }));
      const connectedActor = db.prepare('SELECT id, name, type, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(agentActorId);
      if (connectedActor) broadcastGlobal({ type: 'actor_status', actor: { ...connectedActor, online: true, client_version: msg.client_version || null } });
      // R23: push all room settings so agent is always in sync regardless of connect order.
      const agentRooms = db.prepare("SELECT DISTINCT room_id FROM room_participants WHERE actor_id=?").all(agentActorId).map(r => r.room_id);
      for (const rid of agentRooms) {
        const roomSettingRows = db.prepare("SELECT key_name, value FROM settings WHERE scope='room' AND scope_id=?").all(rid);
        for (const s of roomSettingRows) {
          ws.send(JSON.stringify({ type: 'room_setting', room_id: rid, key: s.key_name, value: s.value }));
        }
      }
      // Drain any pending wakes left by a disconnect mid-trigger or prior crash.
      const reconnectWakes = db.prepare(
        "SELECT pw.id FROM pending_wakes pw JOIN room_participants rp ON rp.id=pw.parent_participant_id WHERE rp.actor_id=?"
      ).all(agentActorId);
      if (reconnectWakes.length) {
        console.log(`[agent] draining ${reconnectWakes.length} pending wake(s) for Actor #${agentActorId} on reconnect`);
        for (const r of reconnectWakes) drainWake(r.id).catch(e => console.error('[wake] reconnect drain error:', e.message));
      }
    }

    // ── Agent reports scan results
    if (msg.type === 'agent_scan_result' && agentActorId) {
      const { workdirs = [], globalSkills = [] } = msg;
      // UPSERT workdirs — preserve IDs so room references stay valid
      const upsertWorkdir = db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,?) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label, is_default=excluded.is_default'
      );
      const insertSkill = db.prepare(
        'INSERT OR IGNORE INTO agent_skills (actor_id, workdir_id, name, description, scope) VALUES (?,?,?,?,?)'
      );
      const scannedPaths = new Set();
      for (const wd of workdirs) {
        const label = wd.path.split(/[\/\\]/).pop() || wd.path;
        upsertWorkdir.run(agentActorId, wd.path, label, wd.is_default ? 1 : 0);
        scannedPaths.add(wd.path);
      }
      const allWds = db.prepare('SELECT id, path FROM agent_workdirs WHERE actor_id=?').all(agentActorId);
      const wdMap = new Map(allWds.map(w => [w.path, w.id]));
      db.prepare('DELETE FROM agent_skills WHERE actor_id=? AND workdir_id IS NOT NULL').run(agentActorId);
      const batchSkills = db.transaction((skills) => { for (const s of skills) insertSkill.run(s.actorId, s.wdId, s.name, s.desc, s.scope); });
      const allSkills = [];
      for (const wd of workdirs) {
        const wdId = wdMap.get(wd.path);
        for (const sk of (wd.skills || [])) {
          allSkills.push({ actorId: agentActorId, wdId, name: sk.name, desc: sk.description || null, scope: sk.scope || 'project' });
        }
      }
      if (allSkills.length) batchSkills(allSkills);
      // Remove workdirs no longer reported (only if not referenced by any room)
      const staleWds = db.prepare('SELECT id, path FROM agent_workdirs WHERE actor_id=?').all(agentActorId);
      const staleIds = staleWds.filter(wd => !scannedPaths.has(wd.path)).map(wd => wd.id);
      if (staleIds.length) {
        // "In use" = referenced by a room's workdir_id OR a participant's workdir_id.
        // room_participants.workdir_id is the per-participant FK this branch added; omitting it
        // let cleanup try to DELETE a workdir still referenced by a participant → FOREIGN KEY
        // constraint failed. UNION both sources. The `IN (...)` filter naturally excludes NULL
        // workdir_id (NULL never matches IN), so no NOT-IN/NULL pitfall here.
        const ph0 = staleIds.map(() => '?').join(',');
        const inUseIds = new Set(
          db.prepare(
            `SELECT workdir_id FROM rooms WHERE workdir_id IN (${ph0})
             UNION
             SELECT workdir_id FROM room_participants WHERE workdir_id IN (${ph0})`
          ).all(...staleIds, ...staleIds).map(r => r.workdir_id)
        );
        const toDelete = staleIds.filter(id => !inUseIds.has(id));
        if (toDelete.length) {
          const ph = toDelete.map(() => '?').join(',');
          db.prepare(`DELETE FROM agent_skills WHERE workdir_id IN (${ph})`).run(...toDelete);
          db.prepare(`DELETE FROM agent_workdirs WHERE id IN (${ph})`).run(...toDelete);
        }
      }
      db.prepare('DELETE FROM agent_skills WHERE actor_id=? AND workdir_id IS NULL').run(agentActorId);
      const globalBatch = globalSkills.map(sk => ({ actorId: agentActorId, wdId: null, name: sk.name, desc: sk.description || null, scope: 'global' }));
      if (globalBatch.length) batchSkills(globalBatch);
      console.log(`[agent] Actor #${agentActorId} reported ${workdirs.length} workdirs, ${globalSkills.length} global skills`);
      broadcastGlobal({ type: 'agent_scan_complete', actor_id: agentActorId });
    }


    // ── Agent streams a token
    if (msg.type === 'agent_token' && agentActorId) {
      broadcast(msg.room_id, { type: 'message_token', message_id: msg.message_id, token: msg.token });
    }

    // ── Agent reports a tool call
    if (msg.type === 'agent_tool' && agentActorId) {
      broadcast(msg.room_id, { type: 'message_tool', message_id: msg.message_id, tool: msg.tool });
    }

    // ── Agent reports state change (requesting / streaming)
    if (msg.type === 'agent_state' && agentActorId) {
      const actorMeta = pendingActorMeta.get(msg.message_id) || {};
      broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: msg.state, ...actorMeta });
    }

    if (msg.type === 'agent_search' && agentActorId) {
      const q = (msg.query || '').trim();
      const roomId = msg.room_id;
      const limit = Math.min(parseInt(msg.limit ?? '20'), 50);
      if (!q) { ws.send(JSON.stringify({ type: 'search_result', request_id: msg.request_id, results: [] })); }
      else {
        const rows = db.prepare(`
          SELECT m.id, m.room_id, m.content, m.created_at,
                 a.name as actor_name, a.type as actor_type,
                 snippet(messages_fts, 0, '', '', '…', 60) as snippet
          FROM messages_fts
          JOIN messages m ON m.id = messages_fts.rowid
          JOIN room_participants rp ON rp.id = m.participant_id
          JOIN actors a ON a.id = rp.actor_id
          WHERE messages_fts MATCH ? AND m.state='complete'
          ${roomId ? 'AND m.room_id = ?' : ''}
          ORDER BY rank LIMIT ?
        `).all(...(roomId ? [q, roomId, limit] : [q, limit]));
        ws.send(JSON.stringify({ type: 'search_result', request_id: msg.request_id, results: rows }));
      }
    }

    if (msg.type === 'agent_get_message' && agentActorId) {
      const row = db.prepare(`
        SELECT m.id, m.room_id, m.content, m.reply_to, m.created_at, a.name as actor_name, a.type as actor_type
        FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
        WHERE m.id=?
      `).get(msg.message_id);
      ws.send(JSON.stringify({ type: 'get_message_result', request_id: msg.request_id, message: row || null }));
    }

    if (msg.type === 'agent_system_event' && agentActorId) {
      const actor = db.prepare('SELECT name FROM actors WHERE id=?').get(agentActorId);
      broadcast(msg.room_id, { type: 'system_event', status: msg.status, actor_name: actor?.name, sub_agent_label: msg.sub_agent_label || null });
    }

    if (msg.type === 'auto_compact_start' && agentActorId) {
      // Look up room_id from session if not provided
      let roomId = msg.room_id;
      if (!roomId && msg.claude_session_id) {
        const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(msg.claude_session_id);
        roomId = s?.room_id;
      }
      if (roomId) {
        if (recentCompacts.has(roomId)) {
          console.log(`[server] auto_compact_start suppressed for room=${roomId} (compact recently completed)`);
        } else if (!pendingCompacts.has(roomId)) {
          const actor = db.prepare('SELECT id, name FROM actors WHERE id=?').get(agentActorId);
          const participant = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1').get(roomId, agentActorId);
          // R14: check failure cooldown — skip if still within window
          if (participant) {
            const sess = db.prepare('SELECT compact_failure_cooldown_until FROM ai_sessions WHERE participant_id=? AND room_id=? AND sub_agent_id IS NULL').get(participant.id, roomId);
            if (sess?.compact_failure_cooldown_until && sess.compact_failure_cooldown_until > new Date().toISOString()) {
              console.warn(`[server] auto_compact_start suppressed for room=${roomId} agent=${agentActorId} (failure cooldown until ${sess.compact_failure_cooldown_until})`);
              return;
            }
          }
          const participants = actor && participant ? [{ participant_id: participant.id, actor_id: actor.id, name: actor.name }] : [];
          pendingCompacts.set(roomId, { total: 1, completed: 0, agents: [agentActorId], completedAgentIds: [], completedParticipantIds: [], targets: participants });
          broadcast(roomId, { type: 'compact_start', room_id: roomId, total: 1, participants });
          if (actor) broadcast(roomId, { type: 'system_event', actor_name: actor.name, status: 'session compacting' });
          console.log(`[server] auto-compact started room=${roomId} by agent=${agentActorId}`);
        } else {
          // Another compact already registered — add this agent to the total if not already counted
          const cs = pendingCompacts.get(roomId);
          if (!cs.agents.includes(agentActorId)) {
            cs.total++;
            cs.agents.push(agentActorId);
            console.log(`[server] auto-compact: added agent=${agentActorId} to room=${roomId} (total=${cs.total})`);
          }
        }
      }
    }

    if (msg.type === 'compact_complete' && agentActorId) {
      // Resolve room_id: use msg.room_id, or look up via orig_session_id (pre-compact) then new session_id
      if (!msg.room_id) {
        const lookup = msg.orig_session_id || msg.claude_session_id;
        if (lookup) {
          const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(lookup);
          if (s?.room_id) msg.room_id = s.room_id;
        }
      }
      if (!msg.room_id) {
        console.warn(`[server] compact_complete: unresolvable room_id for session ${msg.claude_session_id}`);
        return;
      }
      if (msg.claude_session_id) {
        const participant = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
        if (participant) {
          db.prepare(`UPDATE ai_sessions SET claude_session_id=?, last_active_at=datetime('now') WHERE participant_id=? AND room_id=? AND sub_agent_id IS NULL`).run(msg.claude_session_id, participant.id, msg.room_id);
        }
      }
      // R14: clear failure cooldown on success
      const successParticipant = db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
      if (successParticipant) {
        db.prepare(`UPDATE ai_sessions SET compact_failure_cooldown_until=NULL, compact_failure_error=NULL WHERE participant_id=? AND room_id=? AND sub_agent_id IS NULL`).run(successParticipant.id, msg.room_id);
      }
      const state = pendingCompacts.get(msg.room_id);
      const actor = db.prepare('SELECT name FROM actors WHERE id=?').get(agentActorId);
      const participant = db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
      if (!state) {
        // No pendingCompacts entry — background compact with failed auto_compact_start, or disconnect cleared it.
        // Still write marker and unstick any UI that may be in compacting state.
        if (participant && actor) {
          const content = `${actor.name} · session compacted`;
          const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(msg.room_id, participant.id, content);
          broadcast(msg.room_id, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: msg.room_id, content, state: 'system_event', created_at: new Date().toISOString() } });
        }
        if (!recentCompacts.has(msg.room_id)) {
          broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
        }
        setRecentCompact(msg.room_id);
        return;
      }
      if (!state.names) state.names = [];
      if (!state.completedAgentIds) state.completedAgentIds = [];
      if (!state.completedParticipantIds) state.completedParticipantIds = [];
      if (actor) state.names.push(actor.name);
      state.completedAgentIds.push(agentActorId);
      if (participant) state.completedParticipantIds.push(participant.id);
      state.completed++;
      if (state.completed >= state.total) {
        pendingCompacts.delete(msg.room_id);
        setRecentCompact(msg.room_id);
        const label = state.names.length ? state.names.join(', ') : 'session';
        const content = `${label} · session compacted`;
        if (participant) {
          const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(msg.room_id, participant.id, content);
          broadcast(msg.room_id, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: msg.room_id, content, state: 'system_event', created_at: new Date().toISOString() } });
        }
        broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
        for (const aid of state.completedAgentIds) {
          db.prepare('UPDATE ai_sessions SET context_tokens_used=0 WHERE room_id=? AND participant_id IN (SELECT id FROM room_participants WHERE actor_id=?)').run(msg.room_id, aid);
          broadcast(msg.room_id, { type: 'context_update', room_id: msg.room_id, actor_id: aid, context_tokens_used: 0, context_limit: DEFAULT_CONTEXT_WINDOW, model: null });
        }
      } else {
        broadcast(msg.room_id, { type: 'compact_progress', room_id: msg.room_id, completed: state.completed, total: state.total, completed_participant_ids: state.completedParticipantIds });
      }
    }

    if (msg.type === 'compact_error' && agentActorId) {
      // Resolve room_id — background worker sends orig_session_id without room_id
      if (!msg.room_id) {
        const lookup = msg.orig_session_id || msg.claude_session_id;
        if (lookup) {
          const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(lookup);
          if (s?.room_id) msg.room_id = s.room_id;
        }
      }
      if (!msg.room_id) {
        console.warn(`[server] compact_error: unresolvable room_id for session ${msg.orig_session_id}`);
        return;
      }
      const state = pendingCompacts.get(msg.room_id);
      if (!state) return;
      if (!state.completedParticipantIds) state.completedParticipantIds = [];
      const participant = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
      if (participant) {
        state.completedParticipantIds.push(participant.id);
        // R14: set failure cooldown (30 min, MAX semantics — never shorten an existing longer cooldown)
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const errorText = (msg.error || 'compact failed').slice(0, 500);
        db.prepare(`UPDATE ai_sessions SET
          compact_failure_cooldown_until = CASE
            WHEN compact_failure_cooldown_until IS NULL OR compact_failure_cooldown_until < ? THEN ?
            ELSE compact_failure_cooldown_until
          END,
          compact_failure_error = ?
          WHERE participant_id=? AND room_id=? AND sub_agent_id IS NULL`
        ).run(cooldownUntil, cooldownUntil, errorText, participant.id, msg.room_id);
        console.warn(`[server] compact failure cooldown set for participant=${participant.id} until ${cooldownUntil}: ${errorText}`);
      }
      if (!state.errors) state.errors = 0;
      state.errors++;
      state.completed++;
      if (state.completed >= state.total) {
        pendingCompacts.delete(msg.room_id);
        setRecentCompact(msg.room_id);
        if (state.errors >= state.total) {
          broadcast(msg.room_id, { type: 'compact_error', room_id: msg.room_id, error: msg.error || 'Compact failed' });
        } else {
          broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
        }
      } else {
        broadcast(msg.room_id, { type: 'compact_progress', room_id: msg.room_id, completed: state.completed, total: state.total, completed_participant_ids: state.completedParticipantIds });
      }
    }

    // ── Agent finished responding
    if (msg.type === 'agent_complete' && agentActorId) {
      if (!msg.content?.trim()) {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msg.message_id);
        broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: 'error' });
        pendingAgents.get(msg.message_id)?.resolve('');
        pendingAgents.delete(msg.message_id);
        pendingActorMeta.delete(msg.message_id);
        return;
      }
      const attachJson = msg.attachments?.length ? JSON.stringify(msg.attachments) : null;
      const rawContent = (msg.content || '').replace(/Please run \/login\b/g, 'Please run /reauth');
      if (/\[wa:reply[\s\S]*?\[\/wa:reply\]/.test(rawContent)) {
        extractAndSendWaReplies(rawContent, msg.room_id).catch(e =>
          console.error('[wa:reply] extraction error:', e.message));
      }
      const agentContent = stripWaReplyMarkers(rawContent) || rawContent;
      // Phase 4: whitelist result_meta from the agent to a fixed shape before
      // persisting — never store arbitrary agent-supplied JSON on the row.
      const resultMetaJson = sanitizeResultMeta(msg.result_meta);
      // R13: explicit failure exit_reason wins over presence of output content.
      const parsedMeta = resultMetaJson ? JSON.parse(resultMetaJson) : null;
      const finalState = FAILURE_EXIT_REASONS.has(parsedMeta?.exit_reason) ? 'error' : 'complete';
      db.prepare(
        'UPDATE messages SET content=?, file_url=?, file_name=?, attachments=?, ai_model=?, result_meta=?, state=?, completed_at=datetime(\'now\') WHERE id=?'
      ).run(agentContent, msg.file_url || null, msg.file_name || null, attachJson, msg.ai_model || null, resultMetaJson, finalState, msg.message_id);
      const completePayload = { type: 'message_complete', message_id: msg.message_id, content: agentContent, ai_model: msg.ai_model || null, state: finalState };
      if (resultMetaJson) completePayload.result_meta = resultMetaJson;
      if (msg.attachments?.length) { completePayload.attachments = msg.attachments; }
      else if (msg.file_url) { completePayload.file_url = msg.file_url; completePayload.file_name = msg.file_name; }
      broadcast(msg.room_id, completePayload);
      broadcastGlobal({ type: 'room_activity', room_id: msg.room_id });
      const doneRow = db.prepare('SELECT participant_id, sub_agent_id, parent_message_id FROM messages WHERE id=?').get(msg.message_id);
      if (msg.claude_session_id) {
        try {
          if (doneRow && doneRow.sub_agent_id) {
            saveSubAgentSession(doneRow.participant_id, doneRow.sub_agent_id, msg.claude_session_id, resolveParticipantWorkdir(doneRow.participant_id));
          } else if (doneRow) {
            saveSession(doneRow.participant_id, msg.claude_session_id, resolveParticipantWorkdir(doneRow.participant_id));
          }
        } catch (e) { console.error('[agent] saveSession error:', e.message); }
      }
      // Completed sub-agent wakes its parent exactly once (R1). Applies to all
      // sub-agent completions — both /sub-agent-trigger and @mention cascade.
      try {
        if (doneRow && doneRow.sub_agent_id) {
          enqueueParentWake(msg.room_id, doneRow.participant_id, msg.message_id);
        }
      } catch (e) { console.error('[wake] enqueue error:', e.message); }
      pendingAgents.get(msg.message_id)?.resolve(msg.content);
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }

    // ── Agent proxy file responses
    if (msg.type === 'workdir_created' && agentActorId) {
      // Agent resolved the requested path (e.g. expanded "~") to an absolute path.
      // Store the canonical absolute path so file ops resolve correctly.
      if (msg.error && msg.requested) {
        // Workdir creation failed — remove the ghost row and null out any rooms that already
        // reference it (browser may have created a room optimistically before agent confirmed)
        try {
          const ghostRow = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.requested);
          if (ghostRow) {
            db.transaction(() => {
              db.prepare('UPDATE rooms SET workdir_id=NULL WHERE workdir_id=?').run(ghostRow.id);
              db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(ghostRow.id);
            })();
          }
        } catch (e) { console.warn('[workdir] could not remove ghost row:', e.message); }
        return;
      }
      if (!msg.error && msg.path && msg.requested && msg.path !== msg.requested) {
        try {
          const requestedRow = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.requested);
          if (requestedRow) {
            const existingResolved = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.path);
            if (existingResolved && existingResolved.id !== requestedRow.id) {
              // Canonical row already exists — repoint rooms and drop the duplicate tilde row (atomic)
              db.transaction(() => {
                db.prepare('UPDATE rooms SET workdir_id=? WHERE workdir_id=?').run(existingResolved.id, requestedRow.id);
                db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(requestedRow.id);
              })();
            } else {
              db.prepare('UPDATE agent_workdirs SET path=? WHERE id=?').run(msg.path, requestedRow.id);
            }
          }
        } catch (e) {
          console.warn('[workdir] could not canonicalize path:', e.message);
        }
      }
      return;
    }

    if (msg.type === 'proxy_file_list_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_list', error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_list', root: msg.root, tree: msg.tree, modified: msg.modified || [] }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_read_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, error: msg.error }));
        else if (msg.base64) op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, base64: msg.base64 }));
        else op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, content: msg.content }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_git_diff_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'git_diff', error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'git_diff', files: msg.files || [] }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_write_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_write_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_write_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_create_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_create_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_create_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_delete_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_delete_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_delete_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_rename_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_rename_result', path: op.originalPath, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_rename_result', path: op.originalPath, new_path: op.newPath, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'reauth_url' && agentActorId) {
      if (reauthRoomId) {
        const url = msg.url || '';
        const bubbleContent = `Please authenticate by clicking this link: [Authenticate with Claude](${url})\n\nThen paste the code here as: \`REAUTH:<code>\``;
        reauthLinkBubble(reauthRoomId, bubbleContent);
      }
      return;
    }

    if (msg.type === 'reauth_complete' && agentActorId) {
      clearTimeout(reauthTimer);
      const rid = reauthRoomId;
      reauthProcess = null; reauthRoomId = null; reauthAgentActorId = null; reauthTimer = null;
      if (rid) {
        if (msg.success) reauthBubble(rid, 'Re-authenticated successfully');
        else reauthBubble(rid, `Re-auth failed (exit ${msg.code ?? '?'}) — try /reauth again`);
      }
      return;
    }

    // ── Agent stream reset (OAuth expired auto-retry — discard streamed tokens and clear stale session)
    if (msg.type === 'agent_stream_reset' && agentActorId) {
      const mRow = db.prepare('SELECT participant_id, room_id FROM messages WHERE id=?').get(msg.message_id);
      const pid = mRow?.participant_id;
      const rid = mRow?.room_id || msg.room_id;
      console.log(`[server] stream reset for msg=${msg.message_id} room=${rid} participant=${pid} (OAuth expired, agent retrying)`);
      db.prepare("UPDATE messages SET content='', state='streaming' WHERE id=?").run(msg.message_id);
      if (pid) db.prepare('DELETE FROM ai_sessions WHERE participant_id=? AND room_id=?').run(pid, rid);
      broadcast(rid, { type: 'message_stream_reset', message_id: msg.message_id });
    }

    // ── Agent error
    if (msg.type === 'agent_error' && agentActorId) {
      db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msg.message_id);
      broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: 'error' });
      // R15: agent reported error cleanly — reset session to idle so it isn't
      // flagged as indeterminate on the next restart.
      try {
        const errRow = db.prepare('SELECT participant_id, sub_agent_id FROM messages WHERE id=?').get(msg.message_id);
        if (errRow) {
          if (errRow.sub_agent_id) {
            db.prepare("UPDATE ai_sessions SET status='idle' WHERE participant_id=? AND sub_agent_id=? AND status='active'").run(errRow.participant_id, errRow.sub_agent_id);
          } else {
            db.prepare("UPDATE ai_sessions SET status='idle' WHERE participant_id=? AND sub_agent_id IS NULL AND status='active'").run(errRow.participant_id);
          }
        }
      } catch {}
      pendingAgents.get(msg.message_id)?.reject(new Error(msg.error));
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }

    if (msg.type === 'usage_report' && agentActorId) {
      const u = msg.usage || {};
      // Default-model turns arrive with model 'unknown'/null, but modelUsage (from the Claude CLI
      // result event) is keyed by the real model name. Derive from it so usage_log stores the
      // actual model. Multi-model turns can have >1 key -> pick dominant by cost (tie-break output
      // tokens). Field names are camelCase (costUSD/outputTokens) per the CLI result event.
      let model = (msg.model && msg.model !== 'unknown') ? msg.model : null;
      if (!model && msg.modelUsage && typeof msg.modelUsage === 'object') {
        const top = Object.entries(msg.modelUsage)
          .sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0)
                       || (b[1].outputTokens || 0) - (a[1].outputTokens || 0))[0];
        if (top) model = top[0];
      }
      model = model || 'unknown'; // last-resort fallback if modelUsage is empty too
      // Phase 4: attribute spend to the sub-agent that incurred it. The report
      // carries its message_id; the message row snapshots which sub-agent ran.
      let subAgentId = null, subAgentLabel = null;
      if (msg.message_id) {
        const mr = db.prepare('SELECT sub_agent_id, sub_agent_label FROM messages WHERE id=?').get(msg.message_id);
        if (mr) { subAgentId = mr.sub_agent_id || null; subAgentLabel = mr.sub_agent_label || null; }
      }
      try {
        db.prepare(`
          INSERT INTO usage_log (actor_id, room_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, sub_agent_id, sub_agent_label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          agentActorId,
          msg.room_id || null,
          model,
          u.input_tokens || 0,
          u.output_tokens || 0,
          u.cache_read_input_tokens || 0,
          u.cache_creation_input_tokens || 0,
          msg.totalCostUsd || 0,
          subAgentId,
          subAgentLabel
        );
      } catch (e) {
        console.error('[usage_report] insert failed:', e.message);
      }
      // Context window tracking: total input tokens ≈ current context fill
      const contextTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (contextTokens > 0 && msg.room_id) {
        const sess = db.prepare('SELECT id FROM ai_sessions WHERE room_id=? AND participant_id IN (SELECT id FROM room_participants WHERE actor_id=?) AND sub_agent_id IS NULL ORDER BY id DESC LIMIT 1').get(msg.room_id, agentActorId);
        if (sess) {
          db.prepare('UPDATE ai_sessions SET context_tokens_used=? WHERE id=?').run(contextTokens, sess.id);
          const contextLimit = getContextLimit(model);
          const actorRow = db.prepare('SELECT name FROM actors WHERE id=?').get(agentActorId);
          broadcast(msg.room_id, { type: 'context_update', room_id: msg.room_id, actor_id: agentActorId, actor_name: actorRow?.name, context_tokens_used: contextTokens, context_limit: contextLimit, model });
        }
      }
    }

    // ── File operations (workspace panel) ──────────────────────────────────
    if (msg.type === 'file_list' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_list', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_list', error: 'workdir not found' })); return; }
      const targetPath = msg.abs_path || wd.path;
      const isLocal = fs.existsSync(targetPath);
      const isBounded = !msg.abs_path || path.resolve(targetPath).startsWith(path.resolve(wd.path) + path.sep) || path.resolve(targetPath) === path.resolve(wd.path);
      if (isLocal && isBounded) {
        const tree = buildFileTree(targetPath, targetPath, 0, 3);
        let modified = [];
        try {

          const status = execSync('git status --porcelain', { cwd: targetPath, encoding: 'utf8', maxBuffer: 512 * 1024, windowsHide: true, timeout: 10000 });
          modified = status.split('\n').filter(Boolean).map(l => l.slice(3).trim());
        } catch {}
        ws.send(JSON.stringify({ type: 'file_list', root: targetPath, tree, modified }));
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_list', clientWs: ws });
          agentWs.send(JSON.stringify({ type: 'proxy_file_list', request_id: rid, workdir: targetPath }));
        } else { ws.send(JSON.stringify({ type: 'file_list', error: 'agent offline' })); }
      }
    }

    if (msg.type === 'file_read' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_read', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_read', error: 'workdir not found' })); return; }
      if (msg.absolute) {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_read', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_read', request_id: rid, workdir: path.dirname(msg.path), path: path.basename(msg.path), binary: !!msg.binary }));
        } else { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'agent offline' })); }
        return;
      }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(filePath)) {
        try {
          if (msg.binary) {
            const data = fs.readFileSync(filePath);
            ws.send(JSON.stringify({ type: 'file_read', path: msg.path, base64: data.toString('base64') }));
          } else {
            const content = fs.readFileSync(filePath, 'utf8');
            const mtime = fs.statSync(filePath).mtimeMs;
            ws.send(JSON.stringify({ type: 'file_read', path: msg.path, content, mtime }));
          }
        } catch (e) { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_read', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_read', request_id: rid, workdir: wd.path, path: msg.path, binary: !!msg.binary }));
        } else { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'agent offline' })); }
      }
    }

    if (msg.type === 'git_diff' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'git_diff', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'git_diff', error: 'workdir not found' })); return; }
      if (fs.existsSync(wd.path)) {
        try {

          const diff = execSync('git diff', { cwd: wd.path, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true, timeout: 10000 });
          const parsed = parseGitDiff(diff);
          ws.send(JSON.stringify({ type: 'git_diff', files: parsed }));
        } catch (e) { ws.send(JSON.stringify({ type: 'git_diff', error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'git_diff', clientWs: ws });
          agentWs.send(JSON.stringify({ type: 'proxy_git_diff', request_id: rid, workdir: wd.path }));
        } else { ws.send(JSON.stringify({ type: 'git_diff', error: 'agent offline' })); }
      }
    }

    // ── file_write ──────────────────────────────────────────────────────────
    if (msg.type === 'file_write' && subscribedRoom) {
      const BINARY_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp','woff','woff2','ttf','otf','eot','exe','dll','so','bin','zip','tar','gz','7z','mp3','mp4','avi','mov']);
      const ext = (msg.path.match(/\.(\w+)$/) || [])[1] || '';
      if (BINARY_EXTS.has(ext)) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'binary files cannot be edited' })); return; }
      if (typeof msg.content !== 'string' || msg.content.length > 1024 * 1024) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'content too large (max 1MB)' })); return; }
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_write_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_write_result', error: 'workdir not found' })); return; }
      if (msg.absolute) {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_write', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_write', request_id: rid, workdir: path.dirname(msg.path), path: path.basename(msg.path), content: msg.content }));
        } else { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'agent offline' })); }
        return;
      }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (msg.expected_mtime && fs.existsSync(filePath)) {
            const currentMtime = fs.statSync(filePath).mtimeMs;
            if (Math.abs(currentMtime - msg.expected_mtime) > 100) {
              ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'conflict', current_mtime: currentMtime }));
              return;
            }
          }
          fs.writeFileSync(filePath, msg.content, 'utf8');
          const newMtime = fs.statSync(filePath).mtimeMs;
          ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, ok: true, mtime: newMtime }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_write', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_write', request_id: rid, workdir: wd.path, path: msg.path, content: msg.content }));
        } else { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_create ─────────────────────────────────────────────────────────
    if (msg.type === 'file_create' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_create_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_create_result', error: 'workdir not found' })); return; }
      if (/[<>"|?*]/.test(msg.path)) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'invalid characters in path' })); return; }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (msg.is_dir) { fs.mkdirSync(filePath, { recursive: true }); }
          else {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(filePath)) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'already exists' })); return; }
            fs.writeFileSync(filePath, '', 'utf8');
          }
          ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_create', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_create', request_id: rid, workdir: wd.path, path: msg.path, is_dir: !!msg.is_dir }));
        } else { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_delete ─────────────────────────────────────────────────────────
    if (msg.type === 'file_delete' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_delete_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_delete_result', error: 'workdir not found' })); return; }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (!fs.existsSync(filePath)) { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'not found' })); return; }
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) { fs.rmdirSync(filePath); }
          else { fs.unlinkSync(filePath); }
          ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_delete', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_delete', request_id: rid, workdir: wd.path, path: msg.path }));
        } else { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_rename ─────────────────────────────────────────────────────────
    if (msg.type === 'file_rename' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_rename_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_rename_result', error: 'workdir not found' })); return; }
      if (/[<>"|?*]/.test(msg.path) || /[<>"|?*]/.test(msg.new_path)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'invalid characters in path' })); return; }
      const oldPath = path.resolve(wd.path, msg.path);
      const newPath = path.resolve(wd.path, msg.new_path);
      if (!isPathSafe(oldPath, wd.path) || !isPathSafe(newPath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (!fs.existsSync(oldPath)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'source not found' })); return; }
          if (fs.existsSync(newPath)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'target already exists' })); return; }
          const dir = path.dirname(newPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.renameSync(oldPath, newPath);
          ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, new_path: msg.new_path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_rename', clientWs: ws, originalPath: msg.path, newPath: msg.new_path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_rename', request_id: rid, workdir: wd.path, path: msg.path, new_path: msg.new_path }));
        } else { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    if (msg.type === 'set_room_model' && subscribedRoom) {
      if (msg.model !== null && msg.model !== undefined && (typeof msg.model !== 'string' || !msg.model.trim() || msg.model.length > 200)) {
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_model', message: 'invalid model value' }));
        return;
      }
      if (msg.model && !msg.model.startsWith('claude-')) {
        // Non-Anthropic model must exist in a platform's enabled_models list
        let known = false;
        try {
          const platforms = getParsedSetting('ai_platforms');
          if (platforms) {
            for (const p of platforms) {
              if (!p.enabled) continue;
              const cachedNames = Array.isArray(p.cached_models) ? p.cached_models.map(m => typeof m === 'string' ? m : m.model) : [];
              const enabledSet = Array.isArray(p.enabled_models) ? new Set(p.enabled_models) : null;
              const inCached = cachedNames.includes(msg.model);
              if (inCached && (!enabledSet || enabledSet.has(msg.model))) { known = true; break; }
            }
          }
        } catch {}
        if (!known) {
          ws.send(JSON.stringify({ type: 'error', code: 'invalid_model', message: 'model not in enabled list' }));
          return;
        }
      }
      const model = msg.model || null;
      let modelConfig = null;
      if (msg.model_config && typeof msg.model_config === 'object') {
        // Only persist known safe fields — never trust client-provided base_url as authoritative
        // base_url is stored for display but platform lookup always re-fetches from server settings
        const { platform_id, base_url } = msg.model_config;
        if (platform_id !== undefined || base_url !== undefined) {
          if (base_url) {
            try { new URL(base_url); } catch { ws.send(JSON.stringify({ type: 'error', message: 'invalid model_config: bad base_url' })); return; }
          }
          modelConfig = JSON.stringify({ ...(platform_id !== undefined ? { platform_id } : {}), ...(base_url ? { base_url } : {}) });
        }
      }
      db.prepare("UPDATE rooms SET model=?, model_config=? WHERE id=?").run(model, modelConfig, subscribedRoom);
      const clients = roomClients.get(subscribedRoom);
      if (clients) {
        for (const c of clients) {
          if (c.readyState === 1) c.send(JSON.stringify({ type: 'room_model_changed', model, model_config: modelConfig, room_id: subscribedRoom }));
        }
      }
      console.log(`[room] model set to ${model || '(default)'} for room ${subscribedRoom}`);
    }

    // ── Room settings (R23) ────────────────────────────────────────────────
    if (msg.type === 'set_room_setting' && subscribedRoom) {
      const { key, value } = msg;
      if (!ALLOWED_ROOM_SETTINGS.has(key)) {
        console.warn(`[settings] unknown room setting key "${key}" from client — ignored`);
        ws.send(JSON.stringify({ type: 'room_setting_error', key, error: `unknown key: ${key}` }));
        return;
      }
      const allowed = ROOM_SETTING_VALUES[key];
      if (value !== null && allowed && !allowed.has(value)) {
        ws.send(JSON.stringify({ type: 'room_setting_error', key, error: `invalid value "${value}" for ${key}` }));
        return;
      }
      setRoomSetting(subscribedRoom, key, value ?? null);
      // Push update to all agents in this room
      const agentIds = db.prepare("SELECT a.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai'").all(subscribedRoom).map(r => r.id);
      for (const aId of agentIds) {
        const aw = agentClients.get(aId);
        if (aw?.readyState === 1) aw.send(JSON.stringify({ type: 'room_setting', room_id: subscribedRoom, key, value: value ?? null }));
      }
      ws.send(JSON.stringify({ type: 'room_setting_ack', room_id: subscribedRoom, key, value: value ?? null }));
    }

    // ── Connector Action API ────────────────────────────────────────────────

    if (msg.type === 'connector_list') {
      // List connected connectors with DB metadata
      const running = connectionManager.listRunning();
      const ids = running.map(r => r.connId);
      const rows = ids.length
        ? db.prepare(`SELECT id, name, provider, status FROM automation_connections WHERE id IN (${ids.map(() => '?').join(',')})`)
            .all(...ids)
        : [];
      const byId = Object.fromEntries(rows.map(r => [r.id, r]));
      const connectors = running.map(r => ({
        id: r.connId,
        provider: r.provider,
        name: byId[r.connId]?.name || String(r.connId),
        status: byId[r.connId]?.status || 'connected',
      }));
      ws.send(JSON.stringify({ type: 'connector_list_result', connectors }));
    }

    if (msg.type === 'connector_send') {
      // Send message via connector
      // msg: { connector_id, chat_id, text }
      const connId2 = parseInt(msg.connector_id, 10);
      const chatId2 = String(msg.chat_id || '').trim();
      const text2   = String(msg.text || '').trim();
      if (!connId2 || !chatId2 || !text2) {
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: false, error: 'connector_id, chat_id, and text are required' }));
        return;
      }
      // chat_id format validation per provider
      const connRow = db.prepare('SELECT provider FROM automation_connections WHERE id=?').get(connId2);
      if (!connRow) {
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: false, error: 'connector not found' }));
        return;
      }
      if (connRow.provider === 'whatsapp' && !/^[\d+]+@(s\.whatsapp\.net|g\.us)$/.test(chatId2)) {
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: false, error: 'invalid chat_id for whatsapp (expected JID like 628xxx@s.whatsapp.net)' }));
        return;
      }
      if (connRow.provider === 'slack' && !/^[A-Z0-9]+$/.test(chatId2)) {
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: false, error: 'invalid chat_id for slack (expected channel ID like C0B6Q16RNTH)' }));
        return;
      }
      try {
        // Rate-limit for WA: 1.5s delay to avoid triggering spam detection
        if (connRow.provider === 'whatsapp') await new Promise(r => setTimeout(r, 1500));
        await connectionManager.connectorSend(connId2, chatId2, text2);
        // Store outgoing message for WA connectors
        if (connRow.provider === 'whatsapp') {
          try {
            db.prepare(`
              INSERT OR IGNORE INTO wa_incoming_messages
                (connection_id, chat_id, sender, text, msg_key, direction)
              VALUES (?, ?, 'bot', ?, ?, 'out')
            `).run(connId2, chatId2, text2, `out-${crypto.randomUUID()}`);
          } catch {}
        }
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: true }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'connector_send_result', ok: false, error: e.message }));
      }
    }

    if (msg.type === 'connector_read') {
      // Read conversation history via connector
      // msg: { connector_id, chat_id, limit? }
      const connId3  = parseInt(msg.connector_id, 10);
      const chatId3  = String(msg.chat_id || '').trim();
      const limit3   = Math.min(parseInt(msg.limit, 10) || 50, 200);
      if (!connId3 || !chatId3) {
        ws.send(JSON.stringify({ type: 'connector_read_result', ok: false, error: 'connector_id and chat_id are required' }));
        return;
      }
      const connRow3 = db.prepare('SELECT provider FROM automation_connections WHERE id=?').get(connId3);
      if (!connRow3) {
        ws.send(JSON.stringify({ type: 'connector_read_result', ok: false, error: 'connector not found' }));
        return;
      }
      try {
        let messages3 = [];
        if (connRow3.provider === 'whatsapp') {
          const rows3 = db.prepare(`
            SELECT sender, text, direction, media_path, media_type, created_at
            FROM wa_incoming_messages
            WHERE connection_id=? AND chat_id=?
            ORDER BY created_at DESC LIMIT ?
          `).all(connId3, chatId3, limit3);
          messages3 = rows3.reverse().map(r => ({
            sender:     r.direction === 'out' ? 'bot' : r.sender,
            text:       r.text,
            direction:  r.direction,
            media_type: r.media_type || null,
            media_url:  r.media_path || null,
            timestamp:  r.created_at,
          }));
        } else if (connRow3.provider === 'slack') {
          const slackConn = connectionManager.getSlackConnection(connId3);
          if (!slackConn) throw new Error('slack connector not running');
          const result = await slackConn.getHistory(chatId3, limit3);
          messages3 = (result.messages || []).reverse().map(m => ({
            sender:    m.user || m.bot_id || 'unknown',
            text:      m.text || '',
            direction: 'in',
            timestamp: m.ts,
          }));
        }
        ws.send(JSON.stringify({ type: 'connector_read_result', ok: true, messages: messages3 }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'connector_read_result', ok: false, error: e.message }));
      }
    }

   } catch (err) { console.error('[ws] unhandled message error:', err); }
  });

  ws.on('close', () => {
    if (subscribedRoom) roomClients.get(subscribedRoom)?.delete(ws);
    if (isHumanClient) globalClients.delete(ws);
    if (agentActorId) {
      agentClients.delete(agentActorId);
      agentVersions.delete(agentActorId);
      const cleaned = db.prepare(
        "UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — agent disconnected)' ELSE content END WHERE state IN ('streaming','requesting') AND participant_id IN (SELECT rp.id FROM room_participants rp WHERE rp.actor_id=?)"
      ).run(agentActorId);
      if (cleaned.changes) console.log(`[agent] Cleaned ${cleaned.changes} orphaned message(s) from Actor #${agentActorId}`);
      // Reject all pending promises for this actor so caller sequences can continue/unblock
      for (const [mId, pending] of [...pendingAgents]) {
        const meta = pendingActorMeta.get(mId);
        if (meta?.actor_id === agentActorId) {
          pendingAgents.delete(mId);
          pendingActorMeta.delete(mId);
          if (meta.room_id) broadcast(meta.room_id, { type: 'message_state', message_id: mId, state: 'error' });
          pending.reject(new Error('agent_disconnected'));
        }
      }
      // Clean up pendingCompacts — remove only this agent; if no agents remain, unstick UI
      for (const [roomId, cs] of pendingCompacts) {
        const idx = cs.agents.indexOf(agentActorId);
        if (idx !== -1) {
          cs.agents.splice(idx, 1);
          cs.total = Math.max(cs.total - 1, cs.completed); // won't complete — clamp to already-done count
          if (cs.agents.length === 0 || cs.completed >= cs.total) {
            pendingCompacts.delete(roomId);
            setRecentCompact(roomId); // prevent compact_complete (if agent reconnects) from sending a redundant compact_done
            // Write compact marker for agents that successfully completed before disconnect
            if (cs.completed > 0 && cs.names?.length > 0) {
              const completedActorId = cs.completedAgentIds?.[0] ?? agentActorId;
              const participant = db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1').get(roomId, completedActorId);
              if (participant) {
                const content = `${cs.names.join(', ')} · session compacted`;
                const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(roomId, participant.id, content);
                broadcast(roomId, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: roomId, content, state: 'system_event', created_at: new Date().toISOString() } });
              }
            }
            broadcast(roomId, { type: 'compact_done', room_id: roomId });
            console.log(`[agent] Cleared pendingCompact room=${roomId} (agent #${agentActorId} disconnected mid-compact)`);
          } else {
            console.log(`[agent] Agent #${agentActorId} disconnected mid-compact room=${roomId}, ${cs.agents.length} agent(s) still pending`);
          }
        }
      }
      console.log(`[agent] Actor #${agentActorId} disconnected`);
      broadcastGlobal({ type: 'actor_status', actor: { id: agentActorId, online: false } });
    }
  });
});

// ─── Workspace helpers ──────────────────────────────────────────────────────

function isPathSafe(filePath, workdir) {
  const resolved = path.resolve(filePath);
  const wdResolved = path.resolve(workdir);
  const norm = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
  if (!norm(resolved).startsWith(norm(wdResolved + path.sep)) && norm(resolved) !== norm(wdResolved)) return false;
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) return false;
      const real = fs.realpathSync(filePath);
      if (!norm(real).startsWith(norm(wdResolved + path.sep)) && norm(real) !== norm(wdResolved)) return false;
    }
  } catch {}
  return true;
}

const WS_IGNORE = new Set(['.git', 'node_modules', '.next', '__pycache__', '.venv', 'dist', 'build']);

function buildFileTree(dirPath, rootPath, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  const result = [];
  const dirs = entries.filter(e => e.isDirectory() && !WS_IGNORE.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const children = buildFileTree(path.join(dirPath, d.name), rootPath, depth + 1, maxDepth);
    result.push({ t: 'folder', name: d.name, depth, open: depth < 1, children });
  }
  for (const f of files) {
    const ext = path.extname(f.name).slice(1);
    result.push({ t: ext || 'file', name: f.name, depth });
  }
  return result;
}

function parseGitDiff(raw) {
  if (!raw.trim()) return [];
  const files = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/);
      current = { name: match ? match[1] : '?', hunks: [], add: 0, del: 0 };
      files.push(current);
    } else if (line.startsWith('@@') && current) {
      current.hunks.push({ k: 'hunk', text: line });
    } else if (current && current.hunks.length) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.hunks.push({ k: 'add', text: line.slice(1) });
        current.add++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.hunks.push({ k: 'del', text: line.slice(1) });
        current.del++;
      } else if (line.startsWith(' ')) {
        current.hunks.push({ k: 'ctx', text: line.slice(1) });
      }
    }
  }
  return files;
}

// ─── Message handling ─────────────────────────────────────────────────────────

function resolveAgentOrder(content, agents, roomId) {
  const mentions = [];
  for (const agent of agents) {
    const idx = content.indexOf('@' + agent.name);
    if (idx !== -1) mentions.push({ agent: { ...agent, sub_agent: null }, idx });
  }

  // Check sub-agent label mentions (@probe, @reviewer) — linked to this room
  if (roomId) {
    const linkedSubs = db.prepare(`
      SELECT sa.*, a.name AS parent_name FROM room_sub_agents rsa
      JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      JOIN actors a ON a.id=sa.parent_actor_id
      WHERE rsa.room_id=? AND sa.enabled=1
    `).all(roomId);
    for (const sa of linkedSubs) {
      const idx = content.indexOf('@' + sa.label);
      if (idx === -1) continue;
      const parent = agents.find(a => a.actor_id === sa.parent_actor_id);
      if (!parent) continue;
      // Sub-agent mention overrides parent mention (@Parent @label → sub-agent wins)
      const existingIdx = mentions.findIndex(m => m.agent.actor_id === sa.parent_actor_id);
      if (existingIdx !== -1) {
        mentions[existingIdx] = { agent: { ...parent, sub_agent: sa }, idx };
        continue;
      }
      mentions.push({ agent: { ...parent, sub_agent: sa }, idx });
    }
  }

  if (mentions.length > 0) {
    mentions.sort((a, b) => a.idx - b.idx);
    return mentions.map(m => m.agent);
  }
  // No mentions → shuffle all agents (no sub-agent)
  const shuffled = [...agents].map(a => ({ ...a, sub_agent: null }));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const activeSequences = new Map(); // roomId → { cancelled: bool }
const roomIdleBus = new (require('events').EventEmitter)();
roomIdleBus.setMaxListeners(0); // unbounded — one listener per queued room

// R28: drain one queued message per idle event
roomIdleBus.on('idle', (roomId) => {
  const next = db.prepare('SELECT * FROM room_message_queue WHERE room_id=? ORDER BY position, id LIMIT 1').get(roomId);
  if (!next) return;
  db.prepare('DELETE FROM room_message_queue WHERE id=?').run(next.id);
  const remaining = db.prepare('SELECT COUNT(*) as n FROM room_message_queue WHERE room_id=?').get(roomId).n;
  broadcast(roomId, { type: 'queue_updated', room_id: roomId, queued: remaining });
  const attachments = next.attachments ? JSON.parse(next.attachments) : [];
  handleHumanMessage(roomId, next.content, attachments, next.reply_to ?? null, null, next.event_id ?? null).catch(e => {
    console.error('[queue] drain error, re-queuing:', e.message);
    // Re-insert at front so the failed message retries on next idle, queue drain continues
    db.prepare('INSERT INTO room_message_queue (room_id, content, attachments, reply_to, event_id, position) VALUES (?,?,?,?,?,?)').run(
      next.room_id, next.content, next.attachments ?? null, next.reply_to ?? null, next.event_id ?? null, -1
    );
    const requeued = db.prepare('SELECT COUNT(*) as n FROM room_message_queue WHERE room_id=?').get(roomId).n;
    broadcast(roomId, { type: 'queue_updated', room_id: roomId, queued: requeued });
  });
});

async function triggerAgentsSequential(roomId, agents, content, replyTo, attachments, initialFiredSubAgentIds = new Set()) {
  const maxTurns = parseInt(process.env.MAX_AI_TURNS || '5');
  const seq = { cancelled: false };
  activeSequences.set(roomId, seq);
  let turnCount = 0;

  try {
    // Immutable during sequence: prefetch once
    const wdRow = db.prepare(
      'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
    ).get(roomId);
    const repliedMsg = replyTo ? db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo) : null;
    // Mutable during sequence: prepare once, execute per-iteration
    const participantsStmt = db.prepare(`
      SELECT rp.id as participant_id, a.id as actor_id, a.name, a.type
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=?
    `);
    const allAiStmt = db.prepare(`
      SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
    `);

    // Pre-populate with sub-agents already fired by initial parallel dispatch (prevents double-firing)
    const firedSubAgentIds = new Set(initialFiredSubAgentIds);

    for (let i = 0; i < Math.min(agents.length, maxTurns); i++) {
      if (seq.cancelled) break;
      turnCount++;
      const currentAgent = agents[i];
      const prefetchedCtx = { allParticipants: participantsStmt.all(roomId), wdRow, repliedMsg };
      try {
        await triggerAiResponse(roomId, currentAgent, content, replyTo, attachments, prefetchedCtx);
      } catch (e) {
        // Disconnect or timeout — DB + UI already updated by the rejection path; continue to next agent
        console.log(`[trigger] ${currentAgent.sub_agent ? currentAgent.sub_agent.label : currentAgent.name} failed (${e.message}), continuing sequence`);
      }
      if (seq.cancelled) break;

      const lastMsg = db.prepare(`
        SELECT m.content FROM messages m
        JOIN room_participants rp ON rp.id=m.participant_id
        WHERE rp.actor_id=? AND m.room_id=? AND m.state='complete' AND m.completed_at IS NOT NULL
        ORDER BY m.id DESC LIMIT 1
      `).get(currentAgent.actor_id, roomId);

      if (lastMsg?.content) {
        const allAiInRoom = allAiStmt.all(roomId);
        for (const other of allAiInRoom) {
          if (other.actor_id !== currentAgent.actor_id && mentionBoundary(other.name).test(lastMsg.content)) {
            const alreadyQueued = agents.slice(i + 1).some(a => a.actor_id === other.actor_id);
            if (!alreadyQueued) agents.push({ ...other, sub_agent: null });
          }
        }

        // Sub-agent mentions in responses fire in parallel (task-based, independent of conversation flow)
        const linkedSubs = db.prepare(`
          SELECT sa.*, a.name AS parent_name FROM room_sub_agents rsa
          JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
          JOIN actors a ON a.id=sa.parent_actor_id
          WHERE rsa.room_id=? AND sa.enabled=1
        `).all(roomId);
        for (const sa of linkedSubs) {
          if (mentionBoundary(sa.label).test(lastMsg.content) && !firedSubAgentIds.has(sa.id)) {
            const parent = allAiInRoom.find(a => a.actor_id === sa.parent_actor_id);
            if (parent) {
              firedSubAgentIds.add(sa.id);
              triggerAiResponse(roomId, { ...parent, sub_agent: sa }, lastMsg.content, replyTo, attachments, prefetchedCtx)
                .catch(e => console.error('[sub-agent parallel] dispatch error:', e));
            }
          }
        }

        const agentName = currentAgent.sub_agent ? `${currentAgent.name}/${currentAgent.sub_agent.label}` : currentAgent.name;
        if (i < agents.length - 1) {
          content = content + '\n\n' + `[${agentName} sudah merespons: ${lastMsg.content}]`;
        }
      }

      if (turnCount >= maxTurns) break;
    }
  } finally {
    activeSequences.delete(roomId);
    roomIdleBus.emit('idle', roomId);
  }
}

async function handleHumanMessage(roomId, content, attachments, replyTo, senderWs, eventId) {
  // Get Ahmad's participant ID
  const parts = db.prepare(
    "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
  ).all(roomId);
  if (!parts.length) return;
  const humanParticipantId = parts[0].id;

  // Idempotent insert: if client supplied event_id and it already exists, return the original message
  if (eventId) {
    const existing = db.prepare(
      'SELECT id, content FROM messages WHERE room_id=? AND client_event_id=?'
    ).get(roomId, eventId);
    if (existing) {
      if (existing.content !== content) {
        if (senderWs?.readyState === 1) {
          senderWs.send(JSON.stringify({ type: 'send_error', error: 'event_id conflict: content mismatch', code: 409 }));
        }
        return;
      }
      if (senderWs?.readyState === 1) {
        senderWs.send(JSON.stringify({ type: 'message_ack', message_id: existing.id, idempotent: true }));
      }
      return;
    }
  }

  // Backward compat: extract first image/file for legacy columns
  const images = (attachments || []).filter(a => a.type === 'image');
  const files  = (attachments || []).filter(a => a.type === 'file');
  const imageUrl = images[0]?.url || null;
  const fileUrl  = files[0]?.url || null;
  const fileName = files[0]?.name || null;
  const attachJson = attachments?.length ? JSON.stringify(attachments) : null;

  // Save human message
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, image_url, file_url, file_name, attachments, reply_to, client_event_id, state) VALUES (?,?,?,?,?,?,?,?,?,'complete')`
  ).run(roomId, humanParticipantId, content, imageUrl, fileUrl, fileName, attachJson, replyTo || null, eventId || null);
  const messageId = result.lastInsertRowid;

  // Get message with actor info for broadcast
  const row = db.prepare(`
    SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
    FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
    WHERE m.id=?`).get(messageId);
  if (row.reply_to) {
    const replied = db.prepare(`SELECT m.id, m.content, m.image_url, m.file_url, m.file_name, m.attachments, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id=?`).get(row.reply_to);
    if (replied) row.reply_msg = replied;
  }
  broadcast(roomId, { type: 'message_new', message: row });
  broadcastGlobal({ type: 'room_activity', room_id: roomId });

  // R28: if a sequence is already running, apply busy_input_mode before triggering agents
  const busyMode = getSetting('busy_input_mode', roomId) || 'interrupt';
  if (busyMode !== 'interrupt' && activeSequences.has(roomId)) {
    if (busyMode === 'queue') {
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1)+1 as p FROM room_message_queue WHERE room_id=?').get(roomId).p;
      db.prepare('INSERT INTO room_message_queue (room_id, content, attachments, reply_to, event_id, position) VALUES (?,?,?,?,?,?)').run(
        roomId, content, attachJson || null, replyTo || null, eventId || null, pos
      );
      const queued = db.prepare('SELECT COUNT(*) as n FROM room_message_queue WHERE room_id=?').get(roomId).n;
      broadcast(roomId, { type: 'queue_updated', room_id: roomId, queued });
      return;
    }
    if (busyMode === 'steer') {
      const agentIds = db.prepare("SELECT a.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai'").all(roomId).map(r => r.id);
      for (const aId of agentIds) {
        const aw = agentClients.get(aId);
        if (aw?.readyState === 1) aw.send(JSON.stringify({ type: 'steer_message', room_id: roomId, content, message_id: messageId }));
      }
      return;
    }
  }

  const allAiParts = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
  `).all(roomId);

  if (allAiParts.length > 0) {
    const ordered = resolveAgentOrder(content, allAiParts, roomId);
    const subAgentMentions = ordered.filter(a => a.sub_agent);
    const parentMentions   = ordered.filter(a => !a.sub_agent);

    // Sub-agents fire in parallel — independent of conversation flow
    const initialFiredSubAgentIds = new Set(subAgentMentions.map(a => a.sub_agent.id));
    if (subAgentMentions.length > 0) {
      const maxParallel = parseInt(process.env.MAX_PARALLEL_SUB_AGENTS || '4');
      (async () => {
        for (let i = 0; i < subAgentMentions.length; i += maxParallel) {
          const batch = subAgentMentions.slice(i, i + maxParallel);
          await Promise.allSettled(batch.map(a => triggerAiResponse(roomId, a, content, messageId, attachments || [])));
        }
      })().catch(e => console.error('[trigger] parallel sub-agent error:', e));
    }

    // Parent agents run sequentially; pass fired sub-agent IDs to prevent double-firing from cascade
    if (parentMentions.length > 0) {
      triggerAgentsSequential(roomId, parentMentions, content, messageId, attachments || [], initialFiredSubAgentIds).catch(e => console.error('[trigger] sequence error:', e));
    }
  }
}

async function handleSkillCommand(roomId, rawCommand, senderWs) {
  // Parse: /skill-name [ai-name]
  const parts = rawCommand.slice(1).trim().split(/\s+/);
  const skillName = parts[0].toLowerCase();
  const targetName = parts.slice(1).join(' ').trim().toLowerCase() || null;

  // Cari AI target di room
  const allAis = targetName
    ? db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai' AND LOWER(a.name)=?
      `).all(roomId, targetName)
    : db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai'
      `).all(roomId);

  if (!allAis.length) return false;

  // Check skill exists — scoped to room's workdir
  const room = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
  const aiIds = allAis.map(a => a.actor_id);
  const placeholders = aiIds.map(() => '?').join(',');
  const matchedSkills = db.prepare(
    `SELECT actor_id FROM agent_skills WHERE name=? AND actor_id IN (${placeholders})
     AND ((scope IN ('project','local') AND workdir_id = ?) OR scope = 'global')`
  ).all(skillName, ...aiIds, room?.workdir_id);

  if (!matchedSkills.length) return false;

  // Only trigger agents that own the matched skill
  const matchedIds = new Set(matchedSkills.map(s => s.actor_id));
  const filteredAis = allAis.filter(a => matchedIds.has(a.actor_id));

  // Broadcast notice bahwa skill dipanggil
  broadcast(roomId, {
    type: 'skill_invoked',
    skill_name: skillName,
    targets: filteredAis.map(a => a.name),
  });

  // Send skill invocation as prompt — agent's Claude Code session handles the skill
  const promptText = `/${skillName}`;

  for (const ai of filteredAis) {
    await triggerSkillResponse(roomId, ai, promptText);
  }
  return true;
}

async function triggerSkillResponse(roomId, ai, prompt) {
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,'','streaming')`
  ).run(roomId, ai.participant_id);
  const msgId = result.lastInsertRowid;

  // Single source for the participant's workdir (see resolveParticipantWorkdir). NULL is safe:
  // the trigger sends `workdir || undefined` so the agent falls back to its own cwd.
  const workdir = resolveParticipantWorkdir(ai.participant_id);
  const sessionId = getSession(ai.participant_id);

  broadcast(roomId, {
    type: 'message_state',
    message_id: msgId,
    actor_name: ai.name,
    avatar_color: ai.avatar_color,
    avatar_symbol: ai.avatar_symbol,
    avatar_url: ai.avatar_url || null,
    state: 'streaming',
  });

  const agentWs = agentClients.get(ai.actor_id);

  if (agentWs && agentWs.readyState === 1) {
    const skillRunTimeoutMs = parseInt(process.env.AGENT_RUN_TIMEOUT_MS || String(15 * 60 * 1000));
    await new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        if (!pendingAgents.has(msgId)) return;
        pendingAgents.delete(msgId);
        pendingActorMeta.delete(msgId);
        db.prepare("UPDATE messages SET state='error', content=? WHERE id=?")
          .run(`(timeout — ${ai.name} did not respond in ${Math.round(skillRunTimeoutMs / 60000)} minutes)`, msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
        reject(new Error('agent_timeout'));
      }, skillRunTimeoutMs);
      pendingAgents.set(msgId, {
        resolve: (v) => { clearTimeout(timeoutTimer); resolve(v); },
        reject:  (e) => { clearTimeout(timeoutTimer); reject(e); },
      });
      pendingActorMeta.set(msgId, { actor_id: ai.actor_id, room_id: roomId, actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      agentWs.send(JSON.stringify({
        type: 'agent_trigger',
        room_id: roomId,
        message_id: msgId,
        participant_id: ai.participant_id,
        claude_session_id: sessionId,
        prompt,
        workdir: workdir || undefined,
      }));
    });
  } else {
    const meta = { actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null };
    let fullContent = '';
    {
      const session = getFallbackSession(ai.participant_id, workdir);
      try {
        const result = await session.send({
          prompt,
          onToken: token => {
            fullContent += token;
            broadcast(roomId, { type: 'message_token', message_id: msgId, token });
          },
          onState: state => {
            const displayState = typeof state === 'string' ? state.replace(/Please run \/login\b/g, 'Please run /reauth') : state;
            broadcast(roomId, { type: 'message_state', message_id: msgId, state: displayState, ...meta });
          },
          onTool: tool => {
            broadcast(roomId, { type: 'message_tool', message_id: msgId, tool });
          },
        });
        if (!fullContent.trim()) {
          db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
          broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
          return;
        }
        if (result.sessionId) saveSession(ai.participant_id, result.sessionId, workdir);
        fullContent = fullContent.replace(/Please run \/login\b/g, 'Please run /reauth');
        db.prepare("UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?").run(fullContent, msgId);
        broadcast(roomId, { type: 'message_complete', message_id: msgId, content: fullContent });
      } catch {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
      }
    }
  }
}

function promptStrings(lang) {
  const t = {
    en: {
      identity: name => `You are ${name}. You are in a conversation on the Stoa platform.`,
      participants: names => `Other participants in this room: ${names}.`,
      timeContext: now => `Current time: ${now}. All message timestamps in the conversation history are in UTC.`,
      historyLabel: 'Conversation history',
      attachments: 'Attachments',
      attachmentsNote: 'files downloaded to .stoa-attachments/ in workdir if this is the latest message',
      sentImage: 'sent an image',
      attachedFile: 'attached file',
      replyTo: (name, content) => `[This message is a reply to ${name}'s message: "${content}"]`,
      replyInstruction: 'Reply to the last message naturally and directly. No need to mention humans (@name) as they will read it.',
      mentionInstruction: names => `To talk to another AI, use @TheirName (e.g. ${names.map(n => '@' + n).join(' or ')}). Mentions automatically trigger them to respond.`,
      sendFileInstruction: 'If asked to send a file, include the marker [send:path/to/file] in your response. Path must be absolute. You can send multiple files with multiple [send:...] markers. The system will automatically upload and display them in chat.',
    },
    id: {
      identity: name => `Kamu adalah ${name}. Kamu sedang dalam percakapan di platform Stoa.`,
      participants: names => `Peserta lain di room ini: ${names}.`,
      timeContext: now => `Waktu sekarang: ${now}. Semua timestamp di riwayat percakapan adalah UTC.`,
      historyLabel: 'Riwayat percakapan',
      attachments: 'Lampiran',
      attachmentsNote: 'file sudah didownload ke .stoa-attachments/ di workdir jika ini pesan terbaru',
      sentImage: 'mengirim gambar',
      attachedFile: 'melampirkan file',
      replyTo: (name, content) => `[Pesan ini adalah reply ke pesan ${name}: "${content}"]`,
      replyInstruction: 'Balas pesan terakhir secara natural dan langsung. Tidak perlu mention manusia (@nama) karena mereka pasti membaca.',
      mentionInstruction: names => `Jika ingin bicara ke AI lain, gunakan @NamaMereka (contoh: ${names.map(n => '@' + n).join(' atau ')}). Mention akan otomatis memicu mereka untuk merespons.`,
      sendFileInstruction: 'Jika diminta mengirim file, sertakan marker [send:path/to/file] di response. Path harus absolute. Bisa kirim beberapa file sekaligus dengan multiple marker [send:...]. Sistem akan otomatis upload dan menampilkan di chat.',
    },
    ja: {
      identity: name => `あなたは${name}です。Stoaプラットフォームで会話中です。`,
      participants: names => `このルームの他の参加者: ${names}。`,
      timeContext: now => `現在時刻: ${now}。会話履歴のタイムスタンプはすべてUTCです。`,
      historyLabel: '会話履歴',
      attachments: '添付ファイル',
      attachmentsNote: '最新メッセージの場合、ファイルはworkdirの.stoa-attachments/にダウンロード済み',
      sentImage: '画像を送信',
      attachedFile: 'ファイルを添付',
      replyTo: (name, content) => `[このメッセージは${name}のメッセージへの返信です: 「${content}」]`,
      replyInstruction: '最後のメッセージに自然に直接返信してください。人間への@メンションは不要です。',
      mentionInstruction: names => `他のAIに話しかけるには@名前を使ってください（例: ${names.map(n => '@' + n).join('、')}）。メンションで自動的に応答が起動します。`,
      sendFileInstruction: 'ファイル送信を求められた場合、レスポンスに[send:path/to/file]マーカーを含めてください。パスは絶対パスで指定。複数ファイルは複数の[send:...]マーカーで送信可能です。',
    },
    ko: {
      identity: name => `당신은 ${name}입니다. Stoa 플랫폼에서 대화 중입니다.`,
      participants: names => `이 방의 다른 참가자: ${names}.`,
      timeContext: now => `현재 시각: ${now}. 대화 기록의 모든 타임스탬프는 UTC입니다.`,
      historyLabel: '대화 기록',
      attachments: '첨부파일',
      attachmentsNote: '최신 메시지인 경우 파일이 workdir의 .stoa-attachments/에 다운로드됨',
      sentImage: '이미지 전송',
      attachedFile: '파일 첨부',
      replyTo: (name, content) => `[이 메시지는 ${name}의 메시지에 대한 답장입니다: "${content}"]`,
      replyInstruction: '마지막 메시지에 자연스럽고 직접적으로 답변하세요. 사람에게 @멘션할 필요 없습니다.',
      mentionInstruction: names => `다른 AI에게 말하려면 @이름을 사용하세요 (예: ${names.map(n => '@' + n).join(' 또는 ')}). 멘션하면 자동으로 응답합니다.`,
      sendFileInstruction: '파일 전송을 요청받으면 응답에 [send:path/to/file] 마커를 포함하세요. 경로는 절대 경로여야 합니다. 여러 파일은 여러 [send:...] 마커로 전송 가능합니다.',
    },
    zh: {
      identity: name => `你是${name}。你正在Stoa平台上进行对话。`,
      participants: names => `此房间的其他参与者：${names}。`,
      timeContext: now => `当前时间：${now}。对话历史中的所有时间戳均为UTC。`,
      historyLabel: '对话历史',
      attachments: '附件',
      attachmentsNote: '如果这是最新消息，文件已下载到workdir的.stoa-attachments/',
      sentImage: '发送了图片',
      attachedFile: '附加了文件',
      replyTo: (name, content) => `[此消息是对${name}消息的回复："${content}"]`,
      replyInstruction: '自然直接地回复最后一条消息。无需@提及人类，他们会看到的。',
      mentionInstruction: names => `要与其他AI对话，请使用@名字（例如：${names.map(n => '@' + n).join('、')}）。提及会自动触发他们回应。`,
      sendFileInstruction: '如果被要求发送文件，请在回复中包含[send:path/to/file]标记。路径必须是绝对路径。可以使用多个[send:...]标记发送多个文件。系统会自动上传并在聊天中显示。',
    },
  };
  return t[lang] || t.en;
}

async function triggerAiResponse(roomId, ai, prompt, replyTo, attachments = [], prefetchedCtx = null) {

  const agentWs = agentClients.get(ai.actor_id);

  if (!agentWs || agentWs.readyState !== 1) {
    const subLabel = ai.sub_agent?.label;
    const offlineMsg = subLabel
      ? `${ai.name} sedang offline — sub-agent "${subLabel}" tidak bisa dijalankan`
      : `${ai.name} sedang offline`;
    console.log(`[trigger] ${ai.name} is offline${subLabel ? ` (sub-agent: ${subLabel})` : ''}, saving system_event`);
    const sysResult = db.prepare(
      `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)`
    ).run(roomId, ai.participant_id, offlineMsg, 'system_event');
    broadcast(roomId, {
      type: 'message_new',
      message: {
        id: Number(sysResult.lastInsertRowid),
        room_id: roomId,
        actor_name: ai.name,
        actor_type: 'ai',
        avatar_color: ai.avatar_color,
        avatar_symbol: ai.avatar_symbol,
        avatar_url: ai.avatar_url || null,
        content: offlineMsg,
        state: 'system_event',
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

  const subAgent = ai.sub_agent || null;
  // parent_message_id marks a /sub-agent-trigger run for traceability. Auto-wake
  // fires for ALL sub-agent completions (including @mention-cascade), not just these.
  const parentMessageId = (subAgent && ai.parent_message_id) ? ai.parent_message_id : null;
  const result = subAgent
    ? db.prepare(
        `INSERT INTO messages (room_id, participant_id, content, state, reply_to, sub_agent_id, sub_agent_label, parent_message_id) VALUES (?,?,'','streaming',?,?,?,?)`
      ).run(roomId, ai.participant_id, replyTo, subAgent.id, subAgent.label, parentMessageId)
    : db.prepare(
        `INSERT INTO messages (room_id, participant_id, content, state, reply_to) VALUES (?,?,'','streaming',?)`
      ).run(roomId, ai.participant_id, replyTo);
  const msgId = result.lastInsertRowid;

  const displayName = subAgent ? `${ai.name}/${subAgent.label}` : ai.name;
  broadcast(roomId, {
    type: 'message_state',
    message_id: msgId,
    actor_name: ai.name,
    avatar_color: ai.avatar_color,
    avatar_symbol: ai.avatar_symbol,
    avatar_url: ai.avatar_url || null,
    sub_agent_label: subAgent?.label || null,
    state: 'streaming',
  });
  console.log(`[trigger] ${displayName} actor_id=${ai.actor_id} agentConnected=${!!agentWs} readyState=${agentWs?.readyState}`);

  if (EXPECTED_CLIENT_VERSION && agentWs && agentWs.readyState === 1) {
    const agentVer = agentVersions.get(ai.actor_id);
    if (agentVer && agentVer.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
      console.log(`[trigger] ${ai.name} outdated (v${agentVer} < v${EXPECTED_CLIENT_VERSION}), skipping trigger — sending restart`);
      agentWs.send(JSON.stringify({ type: 'restart' }));
      db.prepare("UPDATE messages SET state='error', content='(agent updating — please retry)' WHERE id=?").run(msgId);
      broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error', actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      return;
    }
  }

  // R15: tag session as active so a crash leaves a detectable in-flight marker.
  // No-op if the session row doesn't exist yet (first run — nothing to detect).
  if (subAgent) {
    db.prepare("UPDATE ai_sessions SET status='active', process_generation=? WHERE participant_id=? AND sub_agent_id=?").run(PROCESS_GEN, ai.participant_id, subAgent.id);
  } else {
    db.prepare("UPDATE ai_sessions SET status='active', process_generation=? WHERE participant_id=? AND sub_agent_id IS NULL").run(PROCESS_GEN, ai.participant_id);
  }

  // Build context-aware prompt (language-aware)
  const agentLang = (() => { try { return JSON.parse(ai.adapter_config || '{}').lang || 'en'; } catch { return 'en'; } })();
  const L = promptStrings(agentLang);

  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const historyLimit = subAgent
    ? ({ quick: 3, standard: 5, deep: 10 }[subAgent.tier] ?? 5)
    : 10;
  const history = db.prepare(`
    SELECT a.name, m.content, m.image_url, m.file_url, m.file_name, m.attachments, m.created_at, rp.actor_id FROM messages m
    JOIN room_participants rp ON rp.id=m.participant_id
    JOIN actors a ON a.id=rp.actor_id
    WHERE m.room_id=? AND m.state='complete' ORDER BY m.created_at DESC LIMIT ${historyLimit}
  `).all(roomId);
  const rawHistory = history.slice().reverse().map(r => ({
    role: r.actor_id === ai.actor_id ? 'assistant' : 'user',
    content: r.content || '',
  }));

  const ctx = history.reverse().map(r => {
    const ts = r.created_at
      ? new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : '';
    let line = `[${r.name}${ts ? ' @ ' + ts : ''}]: ${r.content || ''}`;
    let files = [];
    if (r.attachments) {
      try { files = JSON.parse(r.attachments); } catch {}
    }
    if (files.length) {
      line += '\n  ' + L.attachments + ': ' + files.map(f => f.name || 'file').join(', ') + ` (${L.attachmentsNote})`;
    } else {
      if (r.image_url) line += ` [${L.sentImage}]`;
      if (r.file_name) line += ` [${L.attachedFile}: ${r.file_name}]`;
    }
    return line;
  }).join('\n');

  const parts = prefetchedCtx?.allParticipants ?? db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.type
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=?
  `).all(roomId);
  const otherAINames = parts.filter(p => p.type === 'ai' && p.actor_id !== ai.actor_id).map(p => p.name);
  const allOtherNames = [...parts.filter(p => p.type === 'human').map(p => p.name), ...otherAINames];
  const othersLine = allOtherNames.length
    ? L.participants(allOtherNames.join(', '))
    : '';

  let replyCtx = '';
  if (replyTo) {
    const replied = prefetchedCtx?.repliedMsg ?? db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo);
    if (replied) replyCtx = '\n' + L.replyTo(replied.name, replied.content?.substring(0, 500)) + '\n';
  }

  const PROACTIVE_INSTRUCTIONS = `\n\n## Progress Reporting (MANDATORY for background tasks)\n\nFor any task that takes more than a few seconds, or involves file edits, commits, or multi-step work:\n1. After finishing your analysis, send a proactive message with what you found and your plan.\n2. After each significant step (commit, test run, major finding), send a brief update.\n3. At the end, always send a final summary of what was done.\n\nTo send a proactive message to the room:\n\`\`\`bash\nBASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")\ncurl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \\\n  -H "Content-Type: application/json" \\\n  -H "x-agent-id: $STOA_ACTOR_ID" \\\n  -H "x-agent-secret: $STOA_SECRET" \\\n  -d '{"content": "Your message here"}'\n\`\`\`\n\n$STOA_URL, $STOA_ACTOR_ID, $STOA_SECRET, and $STOA_ROOM_ID are available as environment variables.`;

  // Sub-agents are triggered from a caller room that may differ from their own room.
  // Use the literal caller roomId so reports go back to the right place.
  const PROACTIVE_INSTRUCTIONS_SUB_AGENT = `\n\n## Output\n\nYour final text response is automatically posted to the room as your result. Do NOT also send it via curl — it would appear twice.\n\nOnly use curl in two cases:\n1. **Long task (>1 min):** send a brief mid-task status update so the user knows you're working. Do NOT send the result via curl — write it in your text response.\n2. **Cascade trigger:** if you need to @mention another agent, put the @mention in a curl message body (plain text @mention is not guaranteed to trigger).\n\nFor quick tasks (single command, short lookup): just write the answer in your text response. No curl needed.\n\nYou were triggered from room ${roomId}. If you do use curl, send to that room.\n\nCurl pattern:\n\`\`\`bash\nBASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")\ncurl -s -X POST "$BASE_URL/api/rooms/${roomId}/message" \\\n  -H "Content-Type: application/json" \\\n  -H "x-agent-id: $STOA_ACTOR_ID" \\\n  -H "x-agent-secret: $STOA_SECRET" \\\n  -d '{"content": "Your update here"}'\n\`\`\`\n\n$STOA_URL, $STOA_ACTOR_ID, and $STOA_SECRET are available as environment variables.\nRoom ID: ${roomId}`;

  const identityLine = subAgent
    ? `${L.identity(ai.name)}\nYou are operating as sub-agent "${subAgent.label}" (tier: ${subAgent.tier}).${subAgent.system_prompt ? '\n\nSub-agent instructions:\n' + subAgent.system_prompt : ''}${PROACTIVE_INSTRUCTIONS_SUB_AGENT}`
    : `${L.identity(ai.name)}${PROACTIVE_INSTRUCTIONS}`;

  // ── Phase 2b: orchestration — issue a spawn token to the MAIN agent when it
  // owns sub-agents linked in this room, and tell it how to trigger them.
  // Sub-agents never get a token (depth = 1, hard-enforced server-side).
  let orchestrationLine = '';
  if (!subAgent) {
    const ownSubs = db.prepare(`
      SELECT sa.id, sa.label, sa.tier FROM room_sub_agents rsa
      JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.parent_actor_id=? AND sa.enabled=1
    `).all(roomId, ai.actor_id);
    if (ownSubs.length) {
      const list = ownSubs.map(s => `@${s.label} (${s.tier})`).join(', ');
      orchestrationLine =
        `\nYou can delegate to your sub-agents: ${list}.\n` +
        `To trigger one, mention @<label> in your response followed by the task — e.g. "@BE-Stoa implement the login endpoint".\n` +
        `The sub-agent runs automatically; you will be woken once to read its result and continue. You may mention multiple sub-agents in one response to run them in parallel.\n` +
        `Do NOT write @mention of a sub-agent unless you actually want to trigger it.\n\n` +
        `**IMPORTANT — reliable sub-agent triggering:** When delegating via a proactive message (curl to the room API), the @mention MUST be in the curl message body — @mention in plain text response is not guaranteed to trigger the cascade. Use the same curl pattern as in the Progress Reporting section above, with @<label> at the start of the content.`;
    }
  }

  // Inject frozen memory snapshot at session start
  let memorySection = '';
  {
    const memRows = db.prepare('SELECT file, content FROM agent_memory WHERE actor_id=? AND content != \'\'').all(ai.actor_id);
    const roomMem = db.prepare('SELECT content FROM room_memory WHERE room_id=? AND content != \'\'').get(roomId);
    const parts = [];
    for (const { file, content } of memRows) parts.push(`### ${file}\n${content}`);
    if (roomMem) parts.push(`### Room Memory\n${roomMem.content}`);
    if (parts.length) memorySection = `\n## Memory\n${parts.join('\n\n')}`;
  }

  const fullPrompt = [
    identityLine,
    `Room ID: ${roomId}`,
    L.timeContext(nowUtc),
    othersLine,
    memorySection,
    `\n${L.historyLabel}:\n${ctx}`,
    replyCtx,
    '\n' + L.replyInstruction,
    otherAINames.length ? L.mentionInstruction(otherAINames) : '',
    orchestrationLine,
    '\n' + L.sendFileInstruction,
  ].filter(Boolean).join('\n');

  const roomRow2 = db.prepare('SELECT model, model_config, model_tiers FROM rooms WHERE id=?').get(roomId);
  const roomModel = roomRow2?.model || null;
  let modelBaseUrl, modelApiKeys, modelToolsSupported;
  if (roomRow2?.model_config) {
    try {
      const cfg = JSON.parse(roomRow2.model_config);
      if (cfg.platform_id) {
        const platforms = getParsedSetting('ai_platforms');
        if (platforms) {
          const plat = platforms.find(p => p.id === cfg.platform_id && p.enabled);
          if (plat) {
            if (plat.vendor === 'ollama') {
              // Route through Stoa's own /v1/messages proxy — keys + rotation handled server-side.
              // Use getPublicUrl (not hardcoded 127.0.0.1): remote agents (e.g. Kira on another host)
              // resolve 127.0.0.1 to themselves, where nothing listens → ECONNREFUSED. The public/tailscale
              // URL is reachable by both local and remote agents (loopback cost is negligible for local).
              modelBaseUrl = getPublicUrl(`localhost:${PORT}`);
              modelApiKeys = [`stoa-proxy:${cfg.platform_id}`];
            } else {
              modelBaseUrl = plat.base_url || cfg.base_url || undefined;
              modelApiKeys = plat.api_keys?.length ? plat.api_keys : (plat.api_key ? [plat.api_key] : undefined);
            }
            if (Array.isArray(plat.cached_models) && roomModel) {
              const modelInfo = plat.cached_models.find(m => (typeof m === 'string' ? m : m.model) === roomModel);
              if (modelInfo && typeof modelInfo === 'object') modelToolsSupported = modelInfo.tools === true;
            }
          }
        }
      }
    } catch {}
  }
  if (roomModel && !roomModel.startsWith('claude-') && !modelBaseUrl) {
    const errContent = `⚠ Model "${roomModel}" tidak bisa digunakan — platform-nya sudah di-disable atau dihapus. Ubah model room di Settings.`;
    db.prepare("UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?").run(errContent, msgId);
    broadcast(roomId, { type: 'message_complete', message_id: msgId, content: errContent });
    return;
  }
  // Sub-agent workdir overrides parent workdir when set
  const baseWorkdir = resolveParticipantWorkdir(ai.participant_id, prefetchedCtx?.wdRow);
  const workdir = subAgent?.workdir || baseWorkdir;

  // Sub-agent model overrides room model when set. Phase 3: sub-agents also
  // resolve a tier → ordered fallback chain; the agent tries each in order.
  const modelChain = resolveModelChain(subAgent, roomModel, roomRow2?.model_tiers);
  const effectiveModel = modelChain[0] || null;

  if (agentWs && agentWs.readyState === 1) {
    // ── Route to connected agent client
    const sessionId = subAgent
      ? getSubAgentSession(ai.participant_id, subAgent.id)
      : getSession(ai.participant_id);
    const agentRunTimeoutMs = parseInt(process.env.AGENT_RUN_TIMEOUT_MS || String(15 * 60 * 1000));
    await new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        if (!pendingAgents.has(msgId)) return;
        pendingAgents.delete(msgId);
        pendingActorMeta.delete(msgId);
        db.prepare("UPDATE messages SET state='error', content=? WHERE id=?")
          .run(`(timeout — ${displayName} did not respond in ${Math.round(agentRunTimeoutMs / 60000)} minutes)`, msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
        reject(new Error('agent_timeout'));
      }, agentRunTimeoutMs);
      pendingAgents.set(msgId, {
        resolve: (v) => { clearTimeout(timeoutTimer); resolve(v); },
        reject:  (e) => { clearTimeout(timeoutTimer); reject(e); },
      });
      pendingActorMeta.set(msgId, { actor_id: ai.actor_id, room_id: roomId, actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null, sub_agent_label: subAgent?.label || null });
      const triggerBaseUrl = getPublicUrl(`localhost:${PORT}`);
      const fullAttachments = (attachments || []).map(a => ({
        ...a,
        url: a.url?.startsWith('/') ? triggerBaseUrl + a.url : a.url,
      }));
      agentWs.send(JSON.stringify({
        type: 'agent_trigger',
        room_id: roomId,
        message_id: msgId,
        reply_to: replyTo || undefined,
        participant_id: ai.participant_id,
        claude_session_id: sessionId,
        sub_agent: subAgent ? { id: subAgent.id, label: subAgent.label, tier: subAgent.tier } : undefined,
        prompt: fullPrompt,
        attachments: fullAttachments.length ? fullAttachments : undefined,
        imageUrl: fullAttachments.find(a => a.type === 'image')?.url || undefined,
        fileUrl:  fullAttachments.find(a => a.type === 'file')?.url || undefined,
        fileName: fullAttachments.find(a => a.type === 'file')?.name || undefined,
        workdir: workdir    || undefined,
        model: effectiveModel || undefined,
        models: modelChain.length > 1 ? modelChain : undefined,
        base_url: modelBaseUrl,
        api_keys: modelApiKeys,
        tools_supported: modelToolsSupported === false ? false : undefined,
        rawHistory: rawHistory.length ? rawHistory : undefined,
      }));
      console.log(`[trigger] sent to ${displayName} agent, msgId=${msgId}`);
    });

  } else {
    // Agent disconnected between the initial online check and here (race condition).
    // Update bubble to error so UI shows feedback, then throw so drainWake can retry.
    console.log(`[trigger] ${displayName} disconnected mid-trigger, msgId=${msgId} — marking error for retry`);
    db.prepare("UPDATE messages SET state='error', content=? WHERE id=?")
      .run(`(${displayName} terputus saat trigger — akan dicoba ulang otomatis)`, msgId);
    broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
    throw new Error('agent_disconnected_mid_trigger');
  }
}


async function handleInviteSuggest(roomId, byParticipantId, suggestedActorId, reason) {
  const result = db.prepare(
    'INSERT INTO invite_suggestions (room_id, suggested_by_participant_id, suggested_actor_id, reason) VALUES (?,?,?,?)'
  ).run(roomId, byParticipantId, suggestedActorId, reason);
  const actor = db.prepare('SELECT name, avatar_symbol, avatar_color FROM actors WHERE id=?').get(suggestedActorId);
  broadcast(roomId, {
    type: 'invite_suggestion',
    invite_id: result.lastInsertRowid,
    suggested_actor: actor,
    reason,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function enrichReply(rows) {
  const replyIds = [...new Set(rows.filter(r => r.reply_to).map(r => r.reply_to))];
  if (!replyIds.length) return rows;
  const ph = replyIds.map(() => '?').join(',');
  const repliedRows = db.prepare(`SELECT m.id, m.content, m.image_url, m.file_url, m.file_name, m.attachments, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id IN (${ph})`).all(...replyIds);
  const replied = {};
  for (const r of repliedRows) replied[r.id] = r;
  return rows.map(r => r.reply_to && replied[r.reply_to] ? { ...r, reply_msg: replied[r.reply_to] } : r);
}

function handleLogout(roomId) {
  // Same single-agent guard as /reauth — credentials are machine-global.
  const aiParticipants = db.prepare(
    'SELECT COUNT(*) as count FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type=\'ai\''
  ).get(roomId);
  if (aiParticipants.count !== 1) {
    broadcast(roomId, { type: 'system_event', status: '/logout can only be used in a room with exactly one AI agent.' });
    return;
  }
  const { spawn } = require('child_process');
  const proc = spawn('claude', ['auth', 'logout'], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.on('close', (code) => {
    if (code === 0) {
      reauthBubble(roomId, 'Logged out successfully');
    } else {
      reauthBubble(roomId, `Logout failed (exit ${code})`);
    }
  });
  proc.on('error', (err) => {
    reauthBubble(roomId, `Logout error: ${err.message}`);
  });
}

function reauthBubble(roomId, label) {
  // Persistent system_event — '· reauth' suffix matches WHERE filter so message survives refresh.
  const content = label + ' · reauth';
  const participant = db.prepare(
    'SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type=\'ai\' LIMIT 1'
  ).get(roomId);
  if (!participant) return;
  const result = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(roomId, participant.id, content);
  broadcast(roomId, { type: 'message_new', message: { id: Number(result.lastInsertRowid), room_id: roomId, content, state: 'system_event', created_at: new Date().toISOString() } });
}

function reauthLinkBubble(roomId, content) {
  // Regular chat bubble (state='complete') so markdown hyperlinks are clickable.
  const participant = db.prepare(
    'SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type=\'ai\' LIMIT 1'
  ).get(roomId);
  if (!participant) return;
  const result = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'complete')").run(roomId, participant.id, content);
  broadcast(roomId, { type: 'message_new', message: { id: Number(result.lastInsertRowid), room_id: roomId, content, state: 'complete', created_at: new Date().toISOString() } });
}

function handleReauth(roomId) {
  if (reauthProcess) {
    broadcast(roomId, { type: 'system_event', status: 'Re-auth already in progress. Paste the code as REAUTH:<code> to complete it.' });
    return;
  }
  // Find the single AI agent in the room — credentials live on the agent machine, not the server.
  const aiParticipant = db.prepare(
    "SELECT a.id as actor_id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai' LIMIT 1"
  ).get(roomId);
  if (!aiParticipant) {
    broadcast(roomId, { type: 'system_event', status: '/reauth can only be used in a room with an AI agent.' });
    return;
  }
  const agentWs = agentClients.get(aiParticipant.actor_id);
  if (!agentWs || agentWs.readyState !== 1) {
    broadcast(roomId, { type: 'system_event', status: 'Agent is not connected — cannot initiate re-auth.' });
    return;
  }
  reauthProcess = true;
  reauthRoomId = roomId;
  reauthAgentActorId = aiParticipant.actor_id;
  reauthBubble(roomId, 'Re-authentication started');
  agentWs.send(JSON.stringify({ type: 'reauth_request' }));
  reauthTimer = setTimeout(() => {
    if (reauthRoomId) {
      const rid = reauthRoomId;
      reauthProcess = null; reauthRoomId = null; reauthAgentActorId = null; reauthTimer = null;
      reauthBubble(rid, 'Re-auth timed out — no response in 5 minutes');
    }
  }, 5 * 60 * 1000);
}

async function extractAndSendWaReplies(content, roomId) {
  const re = /\[wa:reply(?:\s+to=([^\]]+))?\]([\s\S]*?)\[\/wa:reply\]/g;
  let match;
  const sent = [];
  while ((match = re.exec(content)) !== null) {
    const explicitJid = match[1]?.trim();
    const replyText = match[2].trim();
    if (!replyText) continue;
    const auto = db.prepare(`
      SELECT a.connection_id, a.id AS auto_id FROM automations a
      WHERE a.target_room_id=? AND a.reply_mode='reply_wa' AND a.enabled=1 LIMIT 1
    `).get(roomId);
    if (!auto) continue;
    const conn = db.prepare('SELECT id, provider FROM automation_connections WHERE id=?').get(auto.connection_id);
    if (!conn || conn.provider !== 'whatsapp') continue;
    const chatId = explicitJid || db.prepare(`
      SELECT chat_id FROM wa_incoming_messages WHERE connection_id=? ORDER BY id DESC LIMIT 1
    `).get(conn.id)?.chat_id;
    if (!chatId) continue;
    try {
      await new Promise(r => setTimeout(r, 1500));
      await connectionManager.connectorSend(conn.id, chatId, replyText);
      db.prepare(`INSERT OR IGNORE INTO wa_incoming_messages (connection_id,chat_id,sender,text,msg_key,direction) VALUES (?,?,'bot',?,?,'out')`)
        .run(conn.id, chatId, replyText, `out-${crypto.randomUUID()}`);
      sent.push({ connId: conn.id, chatId, text: replyText });
    } catch (e) {
      console.error(`[wa:reply] send failed (conn:${conn.id}, chat:${chatId}):`, e.message);
    }
  }
  return sent;
}

function stripWaReplyMarkers(content) {
  const replaced = content.replace(/\[wa:reply(?:\s+to=[^\]]+)?\]([\s\S]*?)\[\/wa:reply\]/g, (_, body) => {
    return `\n---\n[Sent to WhatsApp]\n${body.trim()}\n---\n`;
  }).trim();
  return replaced;
}

function broadcast(roomId, data) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', c => {
      bytes += c.length;
      if (bytes > maxBytes) { req.destroy(); reject(new Error('Request body too large')); return; }
      body += c;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJsonBody(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Idle session cleanup ─────────────────────────────────────────────────────

setInterval(() => {
  const timeout = parseInt(getSetting('idle_timeout_seconds') ?? '300');
  db.prepare(
    "UPDATE ai_sessions SET status='idle' WHERE status='active' AND pinned=0 AND last_active_at < datetime('now', '-' || ? || ' seconds')"
  ).run(timeout);
}, 60_000);

// On startup: orphaned streaming/requesting messages are dead — mark them as error
const orphaned = db.prepare("UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — server restart)' ELSE content END WHERE state IN ('streaming','requesting')").run();
if (orphaned.changes) console.log(`[startup] Cleaned ${orphaned.changes} orphaned message(s)`);

// Detect process manager once at startup — used by /api/server/process-manager and /api/server/restart
const detectedProcessManager = (() => {
  if (fs.existsSync('/.dockerenv')) return 'docker';
  if (process.env.PM2_HOME || process.env.PM2_PROCESS_NAME) return 'pm2';
  if (process.env.SUPERVISOR_ENABLED) return 'supervisord';
  try {
    const parent = execSync(`ps -p ${process.ppid} -o comm=`, { encoding: 'utf8', timeout: 2000 }).trim();
    if (parent.includes('launchd')) return 'launchd';
    if (parent.includes('systemd')) return 'systemd';
  } catch {}
  return 'unknown';
})();
console.log(`[startup] Process manager: ${detectedProcessManager}`);

server.listen(PORT, () => {
  // R15: any session left 'active' belongs to a prior process — mark indeterminate.
  const orphaned = db.prepare("UPDATE ai_sessions SET status='indeterminate' WHERE status='active'").run();
  if (orphaned.changes) console.log(`[startup] ${orphaned.changes} orphaned session(s) marked indeterminate`);

  console.log(`Stoa running → http://localhost:${PORT}`);
  // Phase 2b (R1): resume any sub-agent wakes left pending by a prior crash/restart.
  try { drainPendingWakesOnStartup(); } catch (e) { console.error('[wake] startup drain failed:', e.message); }
});

function waitForRoomIdle(roomId, timeoutMs = 300000) {
  return new Promise(resolve => {
    if (!activeSequences.has(roomId)) return resolve();
    const onIdle = (id) => {
      if (id !== roomId) return;
      roomIdleBus.removeListener('idle', onIdle);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      roomIdleBus.removeListener('idle', onIdle);
      console.warn(`[queue] room ${roomId} idle timeout after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);
    roomIdleBus.on('idle', onIdle);
  });
}

function extractSlackFullText(event) {
  const parts = [];
  if (event.text) parts.push(event.text);
  for (const att of (event.attachments || [])) {
    if (att.pretext) parts.push(att.pretext);
    if (att.text) parts.push(att.text);
    if (att.fallback && !att.text) parts.push(att.fallback);
    for (const block of (att.blocks || [])) {
      if (block.text?.text) parts.push(block.text.text);
      for (const el of (block.elements || [])) {
        if (el.text?.text) parts.push(el.text.text);
        for (const subEl of (el.elements || [])) {
          if (subEl.text) parts.push(subEl.text);
        }
      }
    }
  }
  for (const block of (event.blocks || [])) {
    if (block.text?.text) parts.push(block.text.text);
    for (const el of (block.elements || [])) {
      if (el.text?.text) parts.push(el.text.text);
    }
  }
  return parts.join('\n');
}

// ─── Slack automation listener ────────────────────────────────────────────────

const _slackProcessed = new Map(); // key → expiresAt, for dedup
connectionManager.on('slack_event', async ({ eventType, event, webClient, connId }) => {
  // Deduplicate: Slack may deliver the same event multiple times
  const isReaction = eventType === 'reaction_added';
  const dedupKey = isReaction
    ? `${event.event_ts}:${event.item?.channel}:${eventType}`
    : `${event.ts}:${event.channel}:${eventType}`;
  const now = Date.now();
  if (_slackProcessed.has(dedupKey)) return;
  _slackProcessed.set(dedupKey, now + 120_000);
  // Cleanup expired entries periodically
  if (_slackProcessed.size > 500) {
    for (const [k, exp] of _slackProcessed) { if (exp < now) _slackProcessed.delete(k); }
  }

  try {
    const automations = db.prepare(
      "SELECT * FROM automations WHERE enabled=1 AND trigger_type='slack' AND trigger_event=? AND (connection_id IS NULL OR connection_id=?)"
    ).all(eventType, connId || null);

    // Resolve event-level variables once (avoids N+1 Slack API calls per matched automation)
    const text = isReaction ? (event.reaction || '') : (event.text || '');
    const userId = event.user || '';
    const channelId = isReaction ? (event.item?.channel || '') : (event.channel || '');
    const workspace = connectionManager.getSlackConnection(connId)?.workspaceDomain || getSetting('slack_workspace_name') || '';
    const tsForLink = isReaction ? (event.item?.ts || '') : (event.ts || '');
    const messageLink = tsForLink
      ? `https://${workspace}.slack.com/archives/${channelId}/p${tsForLink.replace('.', '')}`
      : '';
    const extractedUrl = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
    const botId = event.bot_id || '';
    const fullText = isReaction ? '' : extractSlackFullText(event);
    const fieldValues = { message_text: text, slack_full_text: fullText, slack_bot_id: botId, slack_user: userId, slack_channel: channelId, reaction: text };

    let slackUser = userId;
    let slackChannel = channelId;
    if (automations.length > 0) {
      try {
        const userInfo = await webClient.users.info({ user: userId });
        slackUser = userInfo.user?.display_name || userInfo.user?.real_name || userId;
      } catch {}
      try {
        const chanInfo = await webClient.conversations.info({ channel: channelId });
        slackChannel = chanInfo.channel?.name || channelId;
      } catch {}
    }

    for (const auto of automations) {
      let conditions;
      try { conditions = JSON.parse(auto.trigger_conditions || '[]'); } catch {
        console.error(`[automation] id=${auto.id} has invalid trigger_conditions JSON, skipping`);
        continue;
      }
      if (!Array.isArray(conditions)) {
        console.error(`[automation] id=${auto.id} trigger_conditions is not an array, skipping`);
        continue;
      }

      // Evaluate ALL conditions (AND)
      const allMatch = conditions.every(c => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          console.warn(`[automation] id=${auto.id} skipping non-object condition element`);
          return false;
        }
        const val = (fieldValues[c.field] || '').toLowerCase();
        const target = (c.value || '').toLowerCase();
        switch (c.op) {
          case 'contains':      return val.includes(target);
          case 'not_contains':  return !val.includes(target);
          case 'starts_with':   return val.startsWith(target);
          case 'matches_regex': return safeRegexTest(c.value, (fieldValues[c.field] || '').slice(0, 5000));
          default: return true;
        }
      });

      if (!allMatch) continue;

      {
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
        console.log(`[${ts}] [automation:${auto.name}] condition_matched - event=${eventType} channel=${channelId} slack_ts=${event.ts || event.event_ts || '-'}`);
      }

      const prompt = auto.prompt_template
        .replace(/\{\{slack_message_text\}\}/g, text)
        .replace(/\{\{slack_message_link\}\}/g, messageLink)
        .replace(/\{\{slack_thread_ts\}\}/g, event.thread_ts || event.ts || '')
        .replace(/\{\{slack_user\}\}/g, slackUser)
        .replace(/\{\{slack_channel\}\}/g, slackChannel)
        .replace(/\{\{extracted_url\}\}/g, extractedUrl)
        .replace(/\{\{slack_full_text\}\}/g, fullText)
        .replace(/\{\{slack_bot_id\}\}/g, botId);

      // Queue automation — one at a time per room
      const _roomId = auto.target_room_id;
      const _prompt = prompt;
      const _autoName = auto.name;
      const _autoId = auto.id;
      {
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
        console.log(`[${ts}] [automation:${_autoName}] enqueued - room=${_roomId} pending=${automationQueue.pending(_roomId)}`);
      }
      automationQueue.enqueue(_roomId, async () => {
        {
          const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
          console.log(`[${ts}] [automation:${_autoName}] dequeued - room=${_roomId} waiting_idle`);
        }
        await waitForRoomIdle(_roomId);
        {
          const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
          console.log(`[${ts}] [automation:${_autoName}] sending_message - room=${_roomId}`);
        }
        await handleHumanMessage(_roomId, _prompt, null, null, null);
        {
          const ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
          console.log(`[${ts}] [automation:${_autoName}] message_sent - room=${_roomId}`);
        }
        await waitForRoomIdle(_roomId);
        db.prepare("UPDATE automations SET run_count=run_count+1, last_run_at=datetime('now') WHERE id=?").run(_autoId);
      }, { automation: _autoName }).catch(e =>
        console.error(`[automation] room ${_roomId} trigger error:`, e.message)
      );
      console.log(`[automation] "${_autoName}" queued → room ${_roomId} (pending: ${automationQueue.pending(_roomId)})`);
    }
  } catch (e) {
    console.error('[automation] slack_event handler error:', e.message);
  }
});

// ─── WhatsApp automation listener ────────────────────────────────────────────

connectionManager.on('wa_event', async ({ chatId, isGroup, sender, senderName, text, isMentioned, connId, msg, mediaType, mediaSizeBytes }) => {
  try {
    // ── Store incoming message to wa_incoming_messages
    const msgKey = msg?.key?.id || null;
    let mediaPath = null;
    if (msgKey) {
      // Download media if present and under per-connector size limit
      if (mediaType && mediaSizeBytes > 0) {
        let conn = null;
        try { conn = db.prepare('SELECT metadata FROM automation_connections WHERE id=?').get(connId); } catch {}
        let meta2 = {};
        try { meta2 = JSON.parse(conn?.metadata || '{}'); } catch {}
        const limitBytes = (meta2.maxMediaSizeMb || 100) * 1024 * 1024;
        if (mediaSizeBytes <= limitBytes) {
          try {
            const buf = await connectionManager.downloadWaMedia(connId, msg);
            if (buf) {
              const extMap = { image: '.jpg', audio: '.ogg', video: '.mp4', document: '.bin' };
              const ext = extMap[mediaType] || '.bin';
              const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              const safeKey = msgKey.replace(/[^a-zA-Z0-9_-]/g, '_');
              const dir = path.join(CONNECTOR_MEDIA_DIR, String(connId), dateStr);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const filePath = path.join(dir, safeKey + ext);
              fs.writeFileSync(filePath, buf);
              mediaPath = `/connector-media/${connId}/${dateStr}/${safeKey}${ext}`;
            }
          } catch (e) {
            console.error(`[wa] media download failed (conn:${connId}):`, e.message);
          }
        }
      }
      try {
        db.prepare(`
          INSERT OR IGNORE INTO wa_incoming_messages
            (connection_id, chat_id, sender, text, msg_key, media_path, media_type, direction)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'in')
        `).run(connId, chatId, sender, text || '', msgKey, mediaPath, mediaType || null);
      } catch (e) {
        console.error(`[wa] store message failed (conn:${connId}):`, e.message);
      }
    }

    // Determine which trigger_events this incoming message qualifies for
    const applicableEvents = ['message_any'];
    if (isGroup) {
      applicableEvents.push('group_message');
      if (isMentioned) applicableEvents.push('group_mention');
    } else {
      applicableEvents.push('message');
    }

    const placeholders = applicableEvents.map(() => '?').join(',');
    const automations = db.prepare(
      `SELECT * FROM automations WHERE enabled=1 AND trigger_type='whatsapp' AND trigger_event IN (${placeholders}) AND (connection_id IS NULL OR connection_id=?)`
    ).all(...applicableEvents, connId || null);

    if (!automations.length) return;

    const truncText = text.length > 4000 ? text.slice(0, 4000) + ' [truncated]' : text;
    const extractedUrl = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
    const fieldValues = { message_text: text, wa_sender: sender, wa_chat_id: chatId };

    for (const auto of automations) {
      let conditions;
      try { conditions = JSON.parse(auto.trigger_conditions || '[]'); } catch {
        console.error(`[automation] id=${auto.id} has invalid trigger_conditions JSON, skipping`);
        continue;
      }
      if (!Array.isArray(conditions)) {
        console.error(`[automation] id=${auto.id} trigger_conditions is not an array, skipping`);
        continue;
      }

      const allMatch = conditions.every(c => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          console.warn(`[automation] id=${auto.id} skipping non-object condition element`);
          return false;
        }
        const val = (fieldValues[c.field] || '').toLowerCase();
        const target = (c.value || '').toLowerCase();
        switch (c.op) {
          case 'contains':      return val.includes(target);
          case 'not_contains':  return !val.includes(target);
          case 'starts_with':   return val.startsWith(target);
          case 'matches_regex': return safeRegexTest(c.value, (fieldValues[c.field] || '').slice(0, 5000));
          default: return true;
        }
      });

      if (!allMatch) continue;

      let prompt = auto.prompt_template
        .replace(/\{\{wa_message_text\}\}/g, truncText)
        .replace(/\{\{wa_sender\}\}/g, sender)
        .replace(/\{\{wa_sender_name\}\}/g, senderName || sender)
        .replace(/\{\{wa_chat_id\}\}/g, chatId)
        .replace(/\{\{wa_chat_name\}\}/g, chatId)   // Phase 2: replace with group/contact name
        .replace(/\{\{wa_is_group\}\}/g, String(isGroup))
        .replace(/\{\{wa_is_mentioned\}\}/g, String(isMentioned))
        .replace(/\{\{extracted_url\}\}/g, extractedUrl);

      if ((auto.reply_mode || 'none') === 'reply_wa') {
        const baseUrl = getPublicUrl(`localhost:${PORT}`);
        prompt = `${prompt}\n\n---\n[WhatsApp Context]\nSender: ${senderName || sender} (${sender})\nChat: ${chatId}\nType: ${isGroup ? 'group' : 'direct_message'}\nConnection ID: ${connId}\n\nTo reply to this sender via WhatsApp, write:\n[wa:reply]Your message here[/wa:reply]\n\nTo read recent chat history:\ncurl ${baseUrl}/api/automations/connections/${connId}/messages?chatId=${encodeURIComponent(chatId)}&limit=20\n---`;
      }

      const _roomId = auto.target_room_id;
      const _prompt = prompt;
      const _autoName = auto.name;
      const _autoId = auto.id;
      const _replyMode = auto.reply_mode || 'none';
      const _connId = connId;
      const _chatId = chatId;
      automationQueue.enqueue(_roomId, async () => {
        await waitForRoomIdle(_roomId);
        await handleHumanMessage(_roomId, _prompt, null, null, null);
        await waitForRoomIdle(_roomId);
        db.prepare("UPDATE automations SET run_count=run_count+1, last_run_at=datetime('now') WHERE id=?").run(_autoId);
        if (_replyMode === 'reply_wa') {
          // Context injection active → agent has [wa:reply] markers instruction.
          // Marker replies already sent in agent_complete handler (extractAndSendWaReplies).
          // No fallback needed — agent decides whether to reply via markers.
        }
      }, { automation: _autoName }).catch(e =>
        console.error(`[automation] room ${_roomId} trigger error:`, e.message)
      );
      console.log(`[automation] "${_autoName}" queued → room ${_roomId} (wa:${connId}, sender: ${sender})`);
    }
  } catch (e) {
    console.error('[automation] wa_event handler error:', e.message);
  }
});

// ─── WhatsApp QR broadcast ────────────────────────────────────────────────────
connectionManager.on('wa_qr', ({ connId, qr }) => {
  broadcastGlobal({ type: 'wa_qr', connId, qr });
});

connectionManager.on('conn_status', ({ connId, status, error }) => {
  console.log(`[conn:${connId}] status → ${status} (broadcast to ${globalClients.size} browsers)`);
  broadcastGlobal({ type: 'conn_status', connId, status, error: error || null });
});

// Reconnect Slack on startup if previously connected
(async () => {
  const legacyConnected = getSetting('slack_connected') === '1';
  const legacyAppToken  = getSetting('slack_app_token');
  const legacyToken     = getSetting('slack_user_token') || null;
  if (legacyConnected && legacyAppToken && legacyToken) {
    const existing = db.prepare('SELECT id FROM automation_connections LIMIT 1').get();
    if (!existing) {
      console.log('[conn] migrating legacy Slack settings -> automation_connections');
      const creds = JSON.stringify({ appToken: legacyAppToken, token: legacyToken });
      const wname = getSetting('slack_workspace_name') || '';
      const bname = getSetting('slack_bot_name') || '';
      const meta  = JSON.stringify({ workspaceName: wname, botName: bname });
      db.prepare(
        'INSERT INTO automation_connections (name,provider,token_type,credentials,metadata,status) VALUES (?,?,?,?,?,?)'
      ).run('Slack — ' + (bname || 'default'), 'slack', 'user', creds, meta, 'disconnected');
    }
  }
  const conns = db.prepare("SELECT * FROM automation_connections WHERE status IN ('connected','connecting')").all();
  for (const conn of conns) {
    try {
      console.log(`[conn:${conn.id}] reconnecting on startup...`);
      await connectionManager.startConnection(conn, updateConnStatus);
    } catch (e) {
      console.error(`[conn:${conn.id}] startup reconnect failed:`, e.message);
    }
  }
})();
