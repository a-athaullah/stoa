#!/usr/bin/env node
// Stoa — generic client
// Human mode:  STOA_TYPE=human node stoa.js [room_id]
// Agent mode:  STOA_TYPE=ai    STOA_ACTOR_ID=2 node stoa.js

const CLIENT_VERSION = '0.4.178';

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { ClaudeSession } = require('./claude-session');
const { stripLeadingThinkingMarker, isThinkingSignatureError, matchThinkingBlock, replaceThinkingBlock, THINKING_MARKER_RE } = require('./lib/thinking-sanitizer');
const { findAnomalies, hasAnomalies, fixAnomalies, escalationLevel, formatNotice } = require('./lib/transcript-sanitizer');

let STOA_URL      = process.env.STOA_URL    || 'ws://localhost:3001';
const ACTOR_ID    = parseInt(process.env.STOA_ACTOR_ID || '1');
const ACTOR_TYPE  = process.env.STOA_TYPE   || 'human';
const STOA_SECRET = process.env.STOA_SECRET || '';
const ROOM_ID     = parseInt(process.argv[2] || process.env.STOA_ROOM_ID || '1');

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  white: '\x1b[97m', blue: '\x1b[94m', cyan: '\x1b[96m',
  yellow: '\x1b[93m', red: '\x1b[91m', gray: '\x1b[90m',
};

function colorFromHex(hex = '') {
  if (hex.toLowerCase().includes('4d9f')) return C.blue;
  if (hex.toLowerCase().includes('00d4')) return C.cyan;
  return C.white;
}

// ─── State ────────────────────────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let rl = null;

const activeStreams = {}; // message_id → { actor_name, started, color, symbol }
const triggerQueue = [];
const activeTriggers = new Map(); // message_id → { workdir, session }
const pendingRequests = new Map(); // request_id → { resolve }
let requestIdCounter = 0;
let pendingRestart = false;
let consecutiveFailures = 0;
let reauthProc = null;  // active claude auth login process for /reauth
let consecutiveTriggerErrors = 0;
const MAX_TRIGGER_ERRORS = 3;
const TRIGGER_TIMEOUT = 5 * 60_000;
let MAX_CONCURRENT = parseInt(process.env.STOA_MAX_CONCURRENT || '1');

// ─── Auto-update (agent mode only) ───────────────────────────────────────────
const UPDATE_INTERVAL = 120_000; // cek tiap 2 menit
const UPDATE_FILES = ['stoa.js', 'claude-session.js'];

const TREE_IGNORE = new Set(['.git', 'node_modules', '.next', '__pycache__', '.venv', 'dist', 'build', '.claude']);
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

function buildFileTreeAgent(dirPath, rootPath, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  const result = [];
  const dirs = entries.filter(e => e.isDirectory() && !TREE_IGNORE.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const children = buildFileTreeAgent(path.join(dirPath, d.name), rootPath, depth + 1, maxDepth);
    result.push({ t: 'folder', name: d.name, depth, open: depth < 1, children });
  }
  for (const f of files) {
    const ext = path.extname(f.name).slice(1);
    result.push({ t: ext || 'file', name: f.name, depth });
  }
  return result;
}

function buildLocalManifest() {
  const manifest = {};
  for (const name of UPDATE_FILES) {
    const fp = path.join(__dirname, name);
    if (fs.existsSync(fp))
      manifest[name] = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 12);
  }
  return manifest;
}

const localManifest = buildLocalManifest();
let updateChecker = null;

async function checkForUpdates() {
  const baseUrl = STOA_URL.replace(/^ws/, 'http');
  try {
    const body = await fetchText(`${baseUrl}/api/client/manifest`);
    const remote = JSON.parse(body).files || {};
    const changed = Object.entries(remote).filter(([name, hash]) =>
      localManifest[name] !== undefined && localManifest[name] !== hash
    );
    if (!changed.length) return;

    console.log(`[stoa:update] update detected: ${changed.map(([n]) => n).join(', ')}`);
    for (const [name, remoteHash] of changed) {
      const content = await fetchText(`${baseUrl}/api/client/file/${encodeURIComponent(name)}`);
      fs.writeFileSync(path.join(__dirname, name), content, 'utf8');
      localManifest[name] = remoteHash;
      console.log(`[stoa:update] ${name} updated`);
    }
    if (activeTriggers.size > 0 || triggerQueue.length > 0) {
      pendingRestart = true;
      console.log('[stoa:update] restart deferred — trigger in progress');
      return;
    }
    doRestart();
  } catch {
    // retry on next interval
  }
}

function doRestart() {
  console.log('[stoa:update] restarting to apply...');
  clearInterval(keepAlive);
  clearInterval(updateChecker);
  clearTimeout(reconnectTimer);
  for (const s of sessionPool.values()) s.shutdown();
  ws?.close();
  process.exit(0);
}

// ─── Session pool (agent mode only) ──────────────────────────────────────────
const sessionPool = new Map(); // `${workdir}::${room_id}` → ClaudeSession
const sessionIdleTimers = new Map(); // `${workdir}::${room_id}` → timeout id
let SESSION_IDLE_TTL = 5; // minutes, configurable via server

let AUTO_COMPACT_THRESHOLD = parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB || '500') * 1024; // KB, configurable
const compactsInFlight = new Set(); // workdir keys currently being compacted — prevents concurrent /compact on same session

function sessionFilePath(workdir, sessionId) {
  if (!workdir || !sessionId) return null;
  const encoded = workdir.replace(/\//g, '-').replace(/\\/g, '-').replace(/:/g, '');
  return path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

async function getSessionFileSize(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return 0;
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch { return 0; }
}

function deleteSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    fs.unlinkSync(filePath);
    console.log(`[stoa] cleanup: deleted session file ${sessionId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`[stoa] cleanup: delete error: ${err.message}`);
  }
}

function truncateSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let lastBoundary = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      try { if (JSON.parse(lines[i]).subtype === 'compact_boundary') { lastBoundary = i; break; } } catch {}
    }
    if (lastBoundary <= 0) return;
    fs.writeFileSync(filePath, lines.slice(lastBoundary).join('\n') + '\n', 'utf8');
    console.log(`[stoa] compact: truncated ${lastBoundary} old entries from session file`);
  } catch (err) {
    console.error(`[stoa] compact: truncate error: ${err.message}`);
  }
}

// Recursively replace any content block matching matchFn with the value from makeReplacement.
// Used to sanitize session entries (images, unsigned thinking blocks) before the CLI re-reads them.
function stripBlocksFromEntry(obj, matchFn, makeReplacement) {
  if (!obj || typeof obj !== 'object') return false;
  let stripped = false;
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i--) {
      if (obj[i] && typeof obj[i] === 'object' && matchFn(obj[i])) {
        const replacement = makeReplacement(obj[i]);
        if (replacement === null) { obj.splice(i, 1); } else { obj[i] = replacement; }
        stripped = true;
      } else if (stripBlocksFromEntry(obj[i], matchFn, makeReplacement)) {
        stripped = true;
      }
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (stripBlocksFromEntry(obj[key], matchFn, makeReplacement)) stripped = true;
    }
  }
  return stripped;
}

// Shared async scaffold: rewrite a session jsonl, replacing blocks that match. `needles` are raw
// substrings used as a cheap early-exit (whole file, then per-line) before JSON.parse. Async fs
// (not readFileSync) so it never blocks the event loop even when called inline before a resume.
async function sanitizeSession(workdir, sessionId, needles, matchFn, makeReplacement, label) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return;
  try {
    let raw;
    try { raw = await fs.promises.readFile(filePath, 'utf8'); } catch { return; }
    if (!needles.some(n => raw.includes(n))) return;
    const lines = raw.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || !needles.some(n => line.includes(n))) continue;
      try {
        const entry = JSON.parse(line);
        if (stripBlocksFromEntry(entry, matchFn, makeReplacement)) {
          lines[i] = JSON.stringify(entry);
          changed = true;
        }
      } catch {}
    }
    if (changed) {
      await fs.promises.writeFile(filePath, lines.join('\n'), 'utf8');
      console.log(`[stoa] ${label} in session ${sessionId.slice(0, 8)}...`);
    }
  } catch (err) {
    console.error(`[stoa] sanitize (${label}) error: ${err.message}`);
  }
}

// Strip base64 image data so models without image support don't choke on a resumed session.
function stripSessionImages(workdir, sessionId) {
  return sanitizeSession(workdir, sessionId, ['"type":"image"', '"type": "image"'],
    b => b.type === 'image' && b.source,
    () => ({ type: 'text', text: '[image]' }),
    'stripped image data');
}

function sanitizeThinking(workdir, sessionId, opts = {}) {
  const { thirdParty = false, aggressive = false } = opts;
  const stripAll = thirdParty || aggressive;
  const blockOpts = { stripAll };
  return sanitizeSession(workdir, sessionId,
    ['"type":"thinking"', '"type": "thinking"', '"type":"redacted_thinking"', '"type": "redacted_thinking"', '[thinking]'],
    b => matchThinkingBlock(b, blockOpts),
    b => replaceThinkingBlock(b, blockOpts),
    stripAll ? 'stripped all thinking (third-party/recovery)' : 'sanitized thinking residue');
}

const transcriptNoticeEmitted = new Set();

async function sanitizeTranscript(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return null;
  try {
    let raw;
    try { raw = await fs.promises.readFile(filePath, 'utf8'); } catch { return null; }
    if (!raw.includes('"tool_use"') && !raw.includes('"tool_result"') && !raw.includes('"content":[]')) return null;
    const lines = raw.split('\n');
    const entries = [];
    const lineMap = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        entries.push(JSON.parse(lines[i]));
        lineMap.push(i);
      } catch {
        entries.push(null);
        lineMap.push(i);
      }
    }
    const anomalies = findAnomalies(entries);
    if (!hasAnomalies(anomalies)) return null;
    const fixed = fixAnomalies(entries, anomalies);
    if (fixed === 0) return null;
    for (let j = 0; j < entries.length; j++) {
      if (entries[j] && lineMap[j] !== undefined) {
        lines[lineMap[j]] = JSON.stringify(entries[j]);
      }
    }
    if (entries.length > lineMap.length) {
      for (let j = lineMap.length; j < entries.length; j++) {
        lines.push(JSON.stringify(entries[j]));
      }
    }
    await fs.promises.writeFile(filePath, lines.join('\n'), 'utf8');
    const level = escalationLevel(anomalies);
    const notice = formatNotice(anomalies, fixed);
    console.log(`[stoa] ${notice}`);
    return { level, notice, anomalies, fixed };
  } catch (err) {
    console.error(`[stoa] transcript sanitizer error: ${err.message}`);
    return null;
  }
}

async function backupSessionFile(workdir, sessionId) {
  const filePath = sessionFilePath(workdir, sessionId);
  if (!filePath) return null;
  const backupPath = filePath + '.sig-bak';
  try {
    await fs.promises.copyFile(filePath, backupPath);
    console.log(`[stoa] backed up session ${sessionId.slice(0, 8)}... → .sig-bak`);
    return backupPath;
  } catch (err) {
    console.error(`[stoa] backup error: ${err.message}`);
    return null;
  }
}

async function prepareResume({ targetDir, rid, targetModel, toolsSupported, env, sessionKey, thirdParty = false, aggressive = false }) {
  if (rid && !compactsInFlight.has(targetDir)) {
    await sanitizeThinking(targetDir, rid, { thirdParty, aggressive });
    const tsResult = await sanitizeTranscript(targetDir, rid);
    if (tsResult && (tsResult.level === 'warning' || tsResult.level === 'error') && !transcriptNoticeEmitted.has(sessionKey)) {
      transcriptNoticeEmitted.add(sessionKey);
      try { send({ type: 'agent_system_event', status: `[${tsResult.level.toUpperCase()}] ${tsResult.notice}` }); } catch {}
    }
  }
  const flags = rid ? ['--resume', rid] : [];
  if (targetModel) flags.push('--model', targetModel);
  if (toolsSupported === false) flags.push('--tools', '');
  const session = new ClaudeSession({ workDir: targetDir, flags, resumeId: rid || null, env });
  sessionPool.set(sessionKey, session);
  return session;
}

function getSession(workdir, roomId, env, subAgentId) {
  const workdirResolved = path.resolve(workdir);
  const key = subAgentId
    ? `${workdirResolved}::${roomId || 'default'}::sub:${subAgentId}`
    : `${workdirResolved}::${roomId || 'default'}`;
  clearSessionIdleTimer(key);
  let session = sessionPool.get(key);
  if (!session) {
    session = new ClaudeSession({ workDir: workdirResolved, env: env || null });
    sessionPool.set(key, session);
    console.log(`[stoa] claude session started for ${key}`);
    startSessionIdleTimer(key);
  }
  return session;
}

function startSessionIdleTimer(workdir) {
  const key = path.resolve(workdir);
  clearSessionIdleTimer(key);
  const timer = setTimeout(() => {
    const session = sessionPool.get(key);
    if (session && !session.busy) {
      session.shutdown();
      sessionPool.delete(key);
      sessionIdleTimers.delete(key);
      console.log(`[stoa] session closed (idle ${SESSION_IDLE_TTL}m): ${key}`);
    }
  }, SESSION_IDLE_TTL * 60_000);
  sessionIdleTimers.set(key, timer);
}

function clearSessionIdleTimer(workdir) {
  const timer = sessionIdleTimers.get(workdir);
  if (timer) { clearTimeout(timer); sessionIdleTimers.delete(workdir); }
}

// ─── Auto-compact background worker ──────────────────────────────────────────
setInterval(async () => {
  if (ACTOR_TYPE !== 'ai') return;
  const busyWorkdirs = new Set([...activeTriggers.values()].map(t => t.workdir));
  for (const [sessionKey, session] of sessionPool) {
    const workdir = sessionKey.split('::')[0]; // extract bare workdir from compound key
    if (busyWorkdirs.has(workdir)) continue; // skip workdirs with an active trigger
    const sessionId = session.resumeId;
    if (!sessionId) continue;
    const fileSize = await getSessionFileSize(workdir, sessionId);
    if (fileSize <= AUTO_COMPACT_THRESHOLD) continue;
    if (compactsInFlight.has(workdir)) continue;
    compactsInFlight.add(workdir);
    console.log(`[stoa] worker: auto-compacting ${sessionId.slice(0, 8)}... (${(fileSize / 1024).toFixed(0)}KB)`);
    send({ type: 'auto_compact_start', claude_session_id: sessionId });
    session.send({ prompt: '/compact', onState: () => {} }).then(result => {
      compactsInFlight.delete(workdir);
      if (result?.sessionId) session.resumeId = result.sessionId;
      send({ type: 'compact_complete', claude_session_id: result?.sessionId || sessionId, orig_session_id: sessionId, result: result?.content || '' });
      setTimeout(() => {
        truncateSessionFile(workdir, sessionId);
        if (result?.sessionId && result.sessionId !== sessionId) truncateSessionFile(workdir, result.sessionId);
      }, 3000);
    }).catch(err => {
      compactsInFlight.delete(workdir);
      console.error(`[stoa] worker auto-compact error: ${err.message}`);
      send({ type: 'compact_error', orig_session_id: sessionId, error: err.message });
    });
  }
}, 60 * 60_000); // every 60 minutes

// ─── Connect ──────────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(STOA_URL);

  ws.on('open', () => {
    if (ACTOR_TYPE === 'ai') {
      getSession(process.env.STOA_WORK_DIR || os.homedir(), 'default');
      ws.send(JSON.stringify({ type: 'agent_connect', actor_id: ACTOR_ID, secret: STOA_SECRET, client_version: CLIENT_VERSION }));
      console.log(`[stoa] Agent #${ACTOR_ID} v${CLIENT_VERSION} connected to ${STOA_URL} (max_concurrent=${MAX_CONCURRENT})`);
    } else {
      ws.send(JSON.stringify({ type: 'join_room', room_id: ROOM_ID }));
      printHeader();
      startPrompt();
    }
  });

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (ACTOR_TYPE === 'ai') {
      handleAgentMessage(msg);
    } else {
      handleHumanMessage(msg);
    }
  });

  ws.on('close', () => {
    if (ACTOR_TYPE === 'ai') {
      consecutiveFailures++;
      const delay = Math.min(5000 * Math.pow(2, consecutiveFailures - 1), 60000);
      console.log(`[stoa] Disconnected (attempt ${consecutiveFailures}), reconnecting in ${delay/1000}s...`);
      reconnectTimer = setTimeout(connect, delay);
    } else {
      process.stdout.write('\n' + C.gray + 'Disconnected.' + C.reset + '\n');
      process.exit(0);
    }
  });

  ws.on('error', err => {
    if (ACTOR_TYPE !== 'ai') {
      process.stdout.write(C.red + 'Connection error: ' + err.message + C.reset + '\n');
    }
  });
}

// ─── Agent mode ───────────────────────────────────────────────────────────────
function expandHome(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function handleAgentMessage(msg) {
  // Normalize tilde in workdir for every proxy/file op (handles legacy DB rows too)
  if (msg && typeof msg.workdir === 'string') msg.workdir = expandHome(msg.workdir);

  if (msg.type === 'auth_error') {
    console.error(`[stoa] Auth failed: ${msg.message}. Set STOA_SECRET correctly and restart.`);
    process.exit(1);
  }

  if (msg.type === 'agent_ready') {
    consecutiveFailures = 0;
    console.log('[stoa] Ready, waiting for triggers...');
    (async () => {
      try {
        const scanResult = scanForWorkdirs();
        console.log(`[stoa] Scanned: ${scanResult.workdirs.length} workdirs, ${scanResult.globalSkills.length} global skills`);
        send({ type: 'agent_scan_result', ...scanResult });
      } catch (err) {
        console.error('[stoa] Scan failed:', err.message);
      }
    })();
  }

  if (msg.type === 'set_config') {
    if (msg.max_concurrent !== undefined) {
      const prev = MAX_CONCURRENT;
      MAX_CONCURRENT = Math.max(1, Math.min(10, parseInt(msg.max_concurrent) || 1));
      if (prev !== MAX_CONCURRENT) console.log(`[stoa] max_concurrent: ${prev} → ${MAX_CONCURRENT}`);
      drainQueue();
    }
    if (msg.session_idle_ttl !== undefined) {
      const prev = SESSION_IDLE_TTL;
      SESSION_IDLE_TTL = Math.max(1, Math.min(60, parseInt(msg.session_idle_ttl) || 5));
      if (prev !== SESSION_IDLE_TTL) console.log(`[stoa] session_idle_ttl: ${prev} → ${SESSION_IDLE_TTL}m`);
    }
    if (msg.auto_compact_threshold_kb !== undefined) {
      const prev = AUTO_COMPACT_THRESHOLD;
      AUTO_COMPACT_THRESHOLD = Math.max(100, Math.min(5000, parseInt(msg.auto_compact_threshold_kb) || 500)) * 1024;
      if (prev !== AUTO_COMPACT_THRESHOLD) console.log(`[stoa] auto_compact_threshold: ${prev/1024}KB → ${AUTO_COMPACT_THRESHOLD/1024}KB`);
    }
  }

  if (msg.type === 'force_update') {
    console.log('[stoa] Force update requested');
    checkForUpdates();
  }

  if (msg.type === 'request_scan') {
    try {
      const scanResult = scanForWorkdirs();
      console.log(`[stoa] Rescan: ${scanResult.workdirs.length} workdirs, ${scanResult.globalSkills.length} global skills`);
      send({ type: 'agent_scan_result', ...scanResult });
    } catch (err) {
      console.error('[stoa] Rescan failed:', err.message);
    }
  }

  if (msg.type === 'restart') {
    console.log('[stoa] Server requested restart (version outdated)');
    pendingRestart = true;
    if (activeTriggers.size === 0 && triggerQueue.length === 0) doRestart();
    return;
  }

  if (msg.type === 'server_restart') {
    console.log(`[stoa] Server restarting on new port → ${msg.new_ws_url}`);
    STOA_URL = msg.new_ws_url;
    clearTimeout(reconnectTimer);
    ws?.close();
    return;
  }

  if (msg.type === 'cancel_generation') {
    console.log(`[stoa] Cancel requested for message ${msg.message_id}`);
    const qIdx = triggerQueue.findIndex(t => t.message_id === msg.message_id);
    if (qIdx !== -1) {
      triggerQueue.splice(qIdx, 1);
      send({ type: 'agent_complete', room_id: msg.room_id, message_id: msg.message_id, content: '(cancelled before processing)' });
      console.log(`[stoa] Cancelled queued msg=${msg.message_id}`);
    } else {
      const active = activeTriggers.get(msg.message_id);
      if (active?.session) active.session.abort();
    }
  }

  if (msg.type === 'create_workdir') {
    try {
      const resolved = path.resolve(expandHome(msg.path));
      fs.mkdirSync(resolved, { recursive: true });
      // Write CLAUDE.md so Claude Code trusts this directory without interactive prompt
      const claudeMd = path.join(resolved, 'CLAUDE.md');
      if (!fs.existsSync(claudeMd)) fs.writeFileSync(claudeMd, '', 'utf8');
      console.log(`[stoa] Created workdir: ${resolved}`);
      // Report the resolved absolute path so the server stores the canonical path (not "~/...")
      send({ type: 'workdir_created', requested: msg.path, path: resolved });
    } catch (err) {
      console.error('[stoa] Failed to create workdir:', err.message);
      send({ type: 'workdir_created', requested: msg.path, error: err.message });
    }
  }

  if (msg.type === 'proxy_file_list') {
    try {
      const tree = buildFileTreeAgent(msg.workdir, msg.workdir, 0, 3);
      let modified = [];
      try {
        const status = spawnSync('git', ['status', '--porcelain'], { cwd: msg.workdir, encoding: 'utf8', maxBuffer: 512 * 1024, windowsHide: true, timeout: 10000 });
        if (status.stdout) modified = status.stdout.split('\n').filter(Boolean).map(l => l.slice(3).trim());
      } catch {}
      send({ type: 'proxy_file_list_result', request_id: msg.request_id, root: msg.workdir, tree, modified });
    } catch (e) {
      send({ type: 'proxy_file_list_result', request_id: msg.request_id, error: e.message });
    }
  }

  if (msg.type === 'proxy_file_read') {
    try {
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: 'proxy_file_read_result', request_id: msg.request_id, error: 'path traversal blocked' });
        return;
      }
      if (msg.binary) {
        const data = fs.readFileSync(filePath);
        send({ type: 'proxy_file_read_result', request_id: msg.request_id, path: msg.path, base64: data.toString('base64') });
      } else {
        const content = fs.readFileSync(filePath, 'utf8');
        send({ type: 'proxy_file_read_result', request_id: msg.request_id, path: msg.path, content });
      }
    } catch (e) {
      send({ type: 'proxy_file_read_result', request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }

  if (msg.type === 'proxy_git_diff') {
    try {
      const status = spawnSync('git', ['diff'], { cwd: msg.workdir, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true, timeout: 10000 });
      const raw = status.stdout || '';
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
          if (line.startsWith('+') && !line.startsWith('+++')) { current.hunks.push({ k: 'add', text: line.slice(1) }); current.add++; }
          else if (line.startsWith('-') && !line.startsWith('---')) { current.hunks.push({ k: 'del', text: line.slice(1) }); current.del++; }
          else if (line.startsWith(' ')) { current.hunks.push({ k: 'ctx', text: line.slice(1) }); }
        }
      }
      send({ type: 'proxy_git_diff_result', request_id: msg.request_id, files });
    } catch (e) {
      send({ type: 'proxy_git_diff_result', request_id: msg.request_id, error: e.message });
    }
  }

  if (msg.type === 'proxy_file_write') {
    try {
      const BINARY_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp','woff','woff2','ttf','otf','eot','exe','dll','so','bin','zip','tar','gz','7z','mp3','mp4','avi','mov']);
      const ext = (msg.path.match(/\.(\w+)$/) || [])[1] || '';
      if (BINARY_EXTS.has(ext)) { send({ type: 'proxy_file_write_result', request_id: msg.request_id, error: 'binary files cannot be edited' }); return; }
      if (typeof msg.content !== 'string' || msg.content.length > 1024 * 1024) { send({ type: 'proxy_file_write_result', request_id: msg.request_id, error: 'content too large (max 1MB)' }); return; }
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: 'proxy_file_write_result', request_id: msg.request_id, error: 'path traversal blocked' });
        return;
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, msg.content, 'utf8');
      send({ type: 'proxy_file_write_result', request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: 'proxy_file_write_result', request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }

  if (msg.type === 'proxy_file_create') {
    try {
      if (/[<>"|?*]/.test(msg.path)) { send({ type: 'proxy_file_create_result', request_id: msg.request_id, error: 'invalid characters in path' }); return; }
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: 'proxy_file_create_result', request_id: msg.request_id, error: 'path traversal blocked' });
        return;
      }
      if (msg.is_dir) { fs.mkdirSync(filePath, { recursive: true }); }
      else {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(filePath)) { send({ type: 'proxy_file_create_result', request_id: msg.request_id, path: msg.path, error: 'already exists' }); return; }
        fs.writeFileSync(filePath, '', 'utf8');
      }
      send({ type: 'proxy_file_create_result', request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: 'proxy_file_create_result', request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }

  if (msg.type === 'proxy_file_delete') {
    try {
      const filePath = path.resolve(msg.workdir, msg.path);
      if (!isPathSafe(filePath, msg.workdir)) {
        send({ type: 'proxy_file_delete_result', request_id: msg.request_id, error: 'path traversal blocked' });
        return;
      }
      if (!fs.existsSync(filePath)) { send({ type: 'proxy_file_delete_result', request_id: msg.request_id, path: msg.path, error: 'not found' }); return; }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) { fs.rmdirSync(filePath); }
      else { fs.unlinkSync(filePath); }
      send({ type: 'proxy_file_delete_result', request_id: msg.request_id, path: msg.path, ok: true });
    } catch (e) {
      send({ type: 'proxy_file_delete_result', request_id: msg.request_id, path: msg.path, error: e.message });
    }
  }

  if (msg.type === 'proxy_file_rename') {
    try {
      if (/[<>"|?*]/.test(msg.path) || /[<>"|?*]/.test(msg.new_path)) { send({ type: 'proxy_file_rename_result', request_id: msg.request_id, error: 'invalid characters in path' }); return; }
      const oldPath = path.resolve(msg.workdir, msg.path);
      const newPath = path.resolve(msg.workdir, msg.new_path);
      if (!isPathSafe(oldPath, msg.workdir) || !isPathSafe(newPath, msg.workdir)) {
        send({ type: 'proxy_file_rename_result', request_id: msg.request_id, error: 'path traversal blocked' });
        return;
      }
      if (!fs.existsSync(oldPath)) { send({ type: 'proxy_file_rename_result', request_id: msg.request_id, error: 'source not found' }); return; }
      if (fs.existsSync(newPath)) { send({ type: 'proxy_file_rename_result', request_id: msg.request_id, error: 'target already exists' }); return; }
      const dir = path.dirname(newPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(oldPath, newPath);
      send({ type: 'proxy_file_rename_result', request_id: msg.request_id, path: msg.path, new_path: msg.new_path, ok: true });
    } catch (e) {
      send({ type: 'proxy_file_rename_result', request_id: msg.request_id, error: e.message });
    }
  }

  if (msg.type === 'search_result' || msg.type === 'get_message_result') {
    const pending = pendingRequests.get(msg.request_id);
    if (pending) { pendingRequests.delete(msg.request_id); pending.resolve(msg); }
  }

  if (msg.type === 'reauth_request') {
    if (reauthProc) {
      // Already in progress — server will timeout on its own
      return;
    }
    const { spawn } = require('child_process');
    const URL_REGEX = /https:\/\/claude\.com\/cai\/oauth\/[^\s]+/;
    let urlSent = false;
    reauthProc = spawn('claude', ['auth', 'login'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const onData = (chunk) => {
      if (urlSent) return;
      const match = chunk.toString().match(URL_REGEX);
      if (match) {
        urlSent = true;
        send({ type: 'reauth_url', url: match[0] });
      }
    };
    reauthProc.stdout.on('data', onData);
    reauthProc.stderr.on('data', onData);
    reauthProc.on('close', (code) => {
      reauthProc = null;
      send({ type: 'reauth_complete', success: code === 0, code });
    });
    reauthProc.on('error', (err) => {
      reauthProc = null;
      send({ type: 'reauth_complete', success: false, code: -1, error: err.message });
    });
    return;
  }

  if (msg.type === 'reauth_code') {
    if (reauthProc?.stdin?.writable) reauthProc.stdin.write((msg.code || '') + '\n');
    return;
  }

  if (msg.type === 'cleanup_session') {
    deleteSessionFile(msg.workdir, msg.claude_session_id);
    return;
  }

  if (msg.type === 'compact_trigger') {
    const workdir = msg.workdir || process.env.STOA_WORK_DIR || os.homedir();
    const workdirResolved = path.resolve(workdir);
    const key = `${workdirResolved}::${msg.room_id || 'default'}`;
    let session = sessionPool.get(key);
    if (!session) {
      if (msg.claude_session_id) {
        session = new ClaudeSession({ workDir: workdirResolved, flags: ['--resume', msg.claude_session_id], resumeId: msg.claude_session_id });
        sessionPool.set(key, session);
        startSessionIdleTimer(key);
        console.log(`[stoa] compact: resuming session ${msg.claude_session_id.slice(0, 8)}... for ${key}`);
      } else {
        console.log(`[stoa] compact: no session for ${key}`);
        send({ type: 'compact_error', room_id: msg.room_id, error: 'no active session' });
        return;
      }
    }
    console.log(`[stoa] compact: starting for ${key}`);
    session.send({
      prompt: '/compact',
      onState: state => {
        console.log(`[stoa] compact status: ${state}`);
      },
    }).then(result => {
      console.log(`[stoa] compact: done for ${key}`);
      send({ type: 'compact_complete', room_id: msg.room_id, result: result?.content || '', claude_session_id: result?.sessionId || null });
      // Delay truncate: Claude writes compact_boundary asynchronously after returning result
      setTimeout(() => {
        truncateSessionFile(key, msg.claude_session_id);
        if (result?.sessionId && result.sessionId !== msg.claude_session_id) {
          truncateSessionFile(key, result.sessionId);
        }
      }, 3000);
    }).catch(err => {
      console.error(`[stoa] compact error: ${err.message}`);
      send({ type: 'compact_error', room_id: msg.room_id, error: err.message });
    });
    return;
  }

  if (msg.type === 'agent_trigger') {
    const { room_id, message_id, prompt } = msg;
    console.log(`[stoa] trigger received room=${room_id} msg=${message_id} prompt="${prompt?.slice(0, 60)}..." (active=${activeTriggers.size}/${MAX_CONCURRENT})`);

    if (activeTriggers.size >= MAX_CONCURRENT) {
      triggerQueue.push(msg);
      console.log(`[stoa] queued msg=${message_id} (${triggerQueue.length} in queue)`);
      return;
    }

    processTrigger(msg).catch(err => {
      console.error(`[stoa] unhandled processTrigger error: ${err.message}`);
      activeTriggers.delete(message_id);
      drainQueue();
    });
  }
}

function wsRequest(type, payload, timeout = 10000) {
  const request_id = String(++requestIdCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingRequests.delete(request_id); reject(new Error('ws request timeout')); }, timeout);
    pendingRequests.set(request_id, { resolve: msg => { clearTimeout(timer); resolve(msg); } });
    send({ type, request_id, ...payload });
  });
}

async function searchMessages(query, roomId, limit = 20) {
  const res = await wsRequest('agent_search', { query, room_id: roomId, limit });
  return res.results || [];
}

async function getMessage(messageId) {
  const res = await wsRequest('agent_get_message', { message_id: messageId });
  return res.message || null;
}

// Phase 3 (R7) — classify a failed model attempt to decide fallback scope:
//   'provider' — auth/quota/billing: the whole provider is unusable right now,
//                so trying its other models would fail the same way.
//   'model'    — rate-limit/overload/timeout/capacity: just this model is busy;
//                the next model in the chain is worth trying.
//   'other'    — unrelated failure; not a fallback trigger.
function classifyModelError(m = '') {
  if (/401|403|unauthorized|invalid[ _-]?api[ _-]?key|authentication|quota|payment|billing|insufficient|credit/i.test(m)) return 'provider';
  if (/429|rate[ _-]?limit|overloaded|too many requests|529|503|capacity|timeout|timed out/i.test(m)) return 'model';
  return 'other';
}

async function processTrigger(msg) {
  const { room_id, message_id } = msg;
  const workdir = msg.workdir || process.env.STOA_WORK_DIR || os.homedir();
  const subAgent = msg.sub_agent || null;

  if (!fs.existsSync(workdir)) {
    const label = subAgent?.label || 'agent';
    console.error(`[trigger] workdir does not exist on this machine: ${workdir}`);
    send({ type: 'agent_complete', room_id, message_id, content: `Workdir tidak ditemukan di mesin ini: \`${workdir}\``, ai_model: undefined, result_meta: { exit_reason: 'error' } });
    return;
  }

  activeTriggers.set(message_id, { workdir, session: null });
  const baseUrl = STOA_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  const TEXT_EXTS = new Set(['.md','.txt','.json','.csv','.html','.js','.ts','.py','.yaml','.yml','.sh','.css']);
  const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg']);

  let finalPrompt = msg.prompt;

  // Fetch full reply chain so agent sees complete context (not just 500-char truncation)
  if (msg.reply_to) {
    try {
      const replied = await getMessage(msg.reply_to);
      if (replied && replied.content) {
        const chain = [];
        if (replied.reply_to) {
          const parent = await getMessage(replied.reply_to);
          if (parent && parent.content) chain.push(`[${parent.actor_name}]: ${parent.content}`);
        }
        chain.push(`[${replied.actor_name}]: ${replied.content}`);
        finalPrompt += `\n\n--- Replied message (full) ---\n${chain.join('\n')}\n---`;
      }
    } catch (err) {
      console.error('[stoa] failed to fetch reply chain:', err.message);
    }
  }

  const allAttachments = msg.attachments || [];

  if (!allAttachments.length) {
    if (msg.imageUrl) allAttachments.push({ url: msg.imageUrl, name: '', type: 'image' });
    if (msg.fileUrl) allAttachments.push({ url: msg.fileUrl, name: msg.fileName || '', type: 'file' });
  }

  const localFiles = [];
  const tempDir = path.join(workdir, '.stoa-attachments');

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (allAttachments.length) {
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch {}
  }

  for (const att of allAttachments) {
    const url = att.url?.startsWith('http') ? att.url : baseUrl + att.url;
    const ext = path.extname(att.name || att.url || '').toLowerCase();
    const safeName = (att.name || path.basename(att.url || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');

    if (att.type === 'image' || IMAGE_EXTS.has(ext)) {
      try {
        const localPath = path.join(tempDir, safeName);
        await fetchToFile(url, localPath);
        localFiles.push({ name: att.name || safeName, path: localPath, type: 'image' });
      } catch (err) {
        console.error('[stoa] image download failed:', att.url, err.message);
      }
    } else if (TEXT_EXTS.has(ext)) {
      try {
        const text = await fetchText(url);
        finalPrompt = `${finalPrompt}\n\n---\nIsi file \`${att.name}\`:\n\`\`\`\n${text}\n\`\`\``;
      } catch (err) {
        console.error('[stoa] file fetch failed:', att.url, err.message);
      }
    } else {
      try {
        const localPath = path.join(tempDir, safeName);
        await fetchToFile(url, localPath);
        localFiles.push({ name: att.name || safeName, path: localPath, type: 'file' });
      } catch (err) {
        console.error('[stoa] file download failed:', att.url, err.message);
      }
    }
  }

  if (localFiles.length) {
    const fileList = localFiles.map(f => `- ${f.name}: ${f.path}`).join('\n');
    if (msg.tools_supported === false) {
      finalPrompt += `\n\n---\nFile yang dilampirkan:\n${fileList}`;
    } else {
      finalPrompt += `\n\n---\nFile yang dilampirkan (sudah didownload ke lokal, gunakan Read tool untuk membaca/melihat):\n${fileList}`;
    }
  }

  let sessionRef = null;
  let statusHandler = null;
  const targetDir = path.resolve(workdir);
  const sessionKey = subAgent
    ? `${targetDir}::${room_id}::sub:${subAgent.id}`
    : `${targetDir}::${room_id}`;
  try {
    const rid = msg.claude_session_id || null;

    if (msg.workdir) {
      try {
        fs.mkdirSync(msg.workdir, { recursive: true });
        const claudeMd = path.join(msg.workdir, 'CLAUDE.md');
        if (!fs.existsSync(claudeMd)) {
          const proactiveInstructions = '# Stoa Agent Context\n\n## Proactive Message\n\nKamu bisa mengirim pesan ke room Stoa secara proaktif tanpa menunggu user bertanya.\nGunakan ini saat background task selesai atau ada info penting.\n\n```bash\nBASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")\ncurl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \\\\\n  -H "Content-Type: application/json" \\\\\n  -H "x-agent-id: $STOA_ACTOR_ID" \\\\\n  -H "x-agent-secret: $STOA_SECRET" \\\\\n  -d \\\'{"content": "Pesan kamu di sini"}\\\'\n```\n\n`$STOA_URL`, `$STOA_ACTOR_ID`, `$STOA_SECRET`, dan `$STOA_ROOM_ID` tersedia sebagai env var.';
          fs.writeFileSync(claudeMd, proactiveInstructions, 'utf8');
        }
      } catch {}
    }

    const apiKeys = msg.api_keys || (msg.api_key ? [msg.api_key] : []);
    const platformEnv = { STOA_ROOM_ID: String(room_id) };
    if (msg.base_url) platformEnv.ANTHROPIC_BASE_URL = msg.base_url;
    if (apiKeys[0]) platformEnv.ANTHROPIC_AUTH_TOKEN = apiKeys[0];
    const envToUse = platformEnv;

    let session = getSession(targetDir, room_id, envToUse, subAgent?.id);
    const needsResume = rid && session.resumeId !== rid;
    const needsFreshSession = !rid && session.resumeId;
    let targetModel = msg.model || null;
    // Phase 3: ordered model fallback chain. The server sends `models` only when a
    // tier resolved to more than one model; otherwise we run the single `model`.
    // targetModel === modelChain[0] (server sets model = chain[0]).
    const modelChain = Array.isArray(msg.models) && msg.models.length ? msg.models.slice() : (targetModel ? [targetModel] : []);
    let modelIdx = 0;
    const currentModel = session.flags.find((f, i, arr) => arr[i - 1] === '--model') || null;
    const needsModelChange = targetModel && currentModel !== targetModel;
    const currentEnv = JSON.stringify(session.env || {});
    const newEnv = JSON.stringify(envToUse || {});
    const needsEnvChange = currentEnv !== newEnv;

    if (needsResume || needsFreshSession || needsModelChange || needsEnvChange) {
      session.shutdown();
      session = await prepareResume({ targetDir, rid, targetModel, toolsSupported: msg.tools_supported, env: envToUse, sessionKey, thirdParty: !!msg.base_url });
      console.log(`[stoa] Session restarted: workdir=${targetDir} room=${room_id}${rid ? ' resume=' + rid.slice(0, 8) + '...' : ' (fresh)'}${targetModel ? ' model=' + targetModel : ''}${msg.base_url ? ' base_url=' + msg.base_url : ''}${msg.tools_supported === false ? ' tools=disabled' : ''}`);
    }
    activeTriggers.set(message_id, { workdir: targetDir, session });
    let fullContent = '';
    let lastActivity = Date.now();
    let abortReason = null;
    let thinkingSigRetried = false;
    statusHandler = status => {
      lastActivity = Date.now();
      send({ type: 'agent_system_event', room_id, message_id, status });
    };
    sessionRef = session;
    session.on('status', statusHandler);
    const FIRST_TOKEN_TIMEOUT = 10 * 60_000;
    const hangWatchdog = setInterval(() => {
      const timeout = fullContent ? TRIGGER_TIMEOUT : FIRST_TOKEN_TIMEOUT;
      if (Date.now() - lastActivity > timeout) {
        clearInterval(hangWatchdog);
        abortReason = 'timeout';
        console.error(`[stoa] trigger timeout (${timeout/1000}s ${fullContent ? 'idle' : 'no first token'}), aborting`);
        session.abort();
      }
    }, 10_000);

    const sendOpts = {
      prompt: finalPrompt,
      history: msg.rawHistory || null,
      onToken: token => {
        lastActivity = Date.now();
        fullContent += token;
        send({ type: 'agent_token', room_id, message_id, token });
      },
      onState: state => {
        lastActivity = Date.now();
        send({ type: 'agent_state', room_id, message_id, state });
      },
      onTool: tool => {
        lastActivity = Date.now();
        send({ type: 'agent_tool', room_id, message_id, tool });
      },
    };

    let result;
    try {
      result = await session.send(sendOpts);
    } catch (retryErr) {
      const isAuthOrQuota = /auth|unauthorized|quota|rate.limit|429|401|403/i.test(retryErr.message);
      // Phase 3: model-scoped failure (rate-limit/overload/timeout) with fallback
      // models left in the chain → advance to the next model and retry. Provider-
      // scoped failures fall through to the existing key-rotation/OAuth handling
      // below (in v1 every chain model shares the room's provider/base_url).
      if (classifyModelError(retryErr.message) === 'model' && !fullContent && modelIdx < modelChain.length - 1) {
        let advanced = false;
        let lastErr = retryErr;
        while (modelIdx < modelChain.length - 1) {
          const failed = modelChain[modelIdx];
          modelIdx++;
          targetModel = modelChain[modelIdx];
          console.log(`[stoa] model "${failed}" unavailable (${lastErr.message}), falling back to "${targetModel}"`);
          // Discard any partial tokens the just-failed attempt streamed before it
          // errored, so the next model's stream replaces (not appends to) them —
          // same reset-on-retry contract as the key-rotation/OAuth/crash paths.
          send({ type: 'agent_stream_reset', room_id, message_id });
          fullContent = '';
          session.shutdown();
          session = await prepareResume({ targetDir, rid, targetModel, toolsSupported: msg.tools_supported, env: envToUse, sessionKey, thirdParty: !!msg.base_url });
          activeTriggers.set(message_id, { workdir: targetDir, session });
          sessionRef = session;
          session.on('status', statusHandler);
          try {
            lastActivity = Date.now();
            result = await session.send(sendOpts);
            advanced = true;
            break;
          } catch (e2) {
            lastErr = e2;
            if (classifyModelError(e2.message) !== 'model') break; // provider/other → stop chain
          }
        }
        if (!advanced) throw lastErr;
      } else if (isAuthOrQuota && apiKeys.length > 1 && !fullContent) {
        let rotated = false;
        for (let ki = 1; ki < apiKeys.length; ki++) {
          console.log(`[stoa] API key #1 failed (${retryErr.message}), rotating to key #${ki + 1}...`);
          const rotatedEnv = { ...platformEnv, ANTHROPIC_AUTH_TOKEN: apiKeys[ki] };
          session.shutdown();
          session = await prepareResume({ targetDir, rid, targetModel, toolsSupported: msg.tools_supported, env: rotatedEnv, sessionKey, thirdParty: !!msg.base_url });
          activeTriggers.set(message_id, { workdir: targetDir, session });
          sessionRef = session;
          session.on('status', statusHandler);
          try {
            lastActivity = Date.now();
            result = await session.send(sendOpts);
            rotated = true;
            break;
          } catch (e2) {
            if (ki === apiKeys.length - 1) throw new Error(`All ${apiKeys.length} API keys exhausted. Last error: ${e2.message}`);
          }
        }
        if (!rotated) throw retryErr;
      } else if (isAuthOrQuota && !fullContent) {
        console.log(`[stoa] OAuth/auth error (${retryErr.message}), killing session and retrying fresh...`);
        send({ type: 'agent_stream_reset', room_id, message_id });
        session.shutdown();
        sessionPool.delete(sessionKey);
        await new Promise(r => setTimeout(r, 2000));
        fullContent = '';
        session = getSession(targetDir, room_id, envToUse, subAgent?.id);
        activeTriggers.set(message_id, { workdir: targetDir, session });
        if (statusHandler) session.on('status', statusHandler);
        sessionRef = session;
        lastActivity = Date.now();
        result = await session.send(sendOpts);
      } else if (retryErr.message.includes('exited unexpectedly') && !fullContent) {
        console.log(`[stoa] session crashed before output, retrying in 4s...`);
        await new Promise(r => setTimeout(r, 4000));
        session = getSession(targetDir, room_id, envToUse, subAgent?.id);
        activeTriggers.set(message_id, { workdir: targetDir, session });
        lastActivity = Date.now();
        result = await session.send(sendOpts);
      } else if (isThinkingSignatureError(retryErr.message) && !fullContent && !thinkingSigRetried) {
        thinkingSigRetried = true;
        console.log(`[stoa] thinking-signature 400 detected (exception): ${retryErr.message.slice(0, 120)}`);
        send({ type: 'agent_stream_reset', room_id, message_id });
        fullContent = '';
        session.shutdown();
        await backupSessionFile(targetDir, rid);
        session = await prepareResume({ targetDir, rid, targetModel, toolsSupported: msg.tools_supported, env: envToUse, sessionKey, aggressive: true });
        activeTriggers.set(message_id, { workdir: targetDir, session });
        sessionRef = session;
        session.on('status', statusHandler);
        lastActivity = Date.now();
        result = await session.send(sendOpts);
      } else {
        throw retryErr;
      }
    }
    let { content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype } = result;
    // Defensive: a model with a poisoned history may still prefix its reply with a literal
    // "[thinking]" marker. Strip it from the visible output (the resumed history is cleaned
    // separately by sanitizeThinking, which eventually stops the model from producing it).
    content = stripLeadingThinkingMarker(content);

    // OAuth expired: intercept "Not logged in" before user sees it, auto-restart and retry
    const AUTH_EXPIRED_RE = /not logged in|please run \/(reauth|login)/i;
    if (!aborted && AUTH_EXPIRED_RE.test(content) && content.length < 200) {
      console.log(`[stoa] OAuth expired detected in room=${room_id} msg=${message_id}, content="${content.slice(0, 100)}"`);
      console.log(`[stoa] Killing session and retrying...`);
      send({ type: 'agent_stream_reset', room_id, message_id });
      session.shutdown();
      sessionPool.delete(sessionKey);
      await new Promise(r => setTimeout(r, 2000));
      fullContent = '';
      session = getSession(targetDir, room_id, envToUse, subAgent?.id);
      activeTriggers.set(message_id, { workdir: targetDir, session });
      if (statusHandler) session.on('status', statusHandler);
      sessionRef = session;
      lastActivity = Date.now();
      result = await session.send(sendOpts);
      ({ content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype } = result);
      content = stripLeadingThinkingMarker(content);
      console.log(`[stoa] OAuth retry completed for room=${room_id} msg=${message_id}, content=${content.length} chars`);
    }

    if (!aborted && !thinkingSigRetried && isThinkingSignatureError(content)) {
      thinkingSigRetried = true;
      console.log(`[stoa] thinking-signature 400 detected (content): ${content.slice(0, 120)}`);
      send({ type: 'agent_stream_reset', room_id, message_id });
      fullContent = '';
      session.shutdown();
      await backupSessionFile(targetDir, rid);
      session = await prepareResume({ targetDir, rid, targetModel, toolsSupported: msg.tools_supported, env: envToUse, sessionKey, aggressive: true });
      activeTriggers.set(message_id, { workdir: targetDir, session });
      if (statusHandler) session.on('status', statusHandler);
      sessionRef = session;
      lastActivity = Date.now();
      result = await session.send(sendOpts);
      ({ content, sessionId, aborted, usage, modelUsage, totalCostUsd, durationMs, subtype } = result);
      content = stripLeadingThinkingMarker(content);
      console.log(`[stoa] thinking-signature recovery ${isThinkingSignatureError(content) ? 'FAILED' : 'ok'} for room=${room_id} msg=${message_id}`);
    }

    clearInterval(hangWatchdog);

    consecutiveTriggerErrors = 0;
    if (aborted) {
      const partial = stripLeadingThinkingMarker(fullContent) || content || '';
      const fallback = abortReason === 'timeout' ? '(timed out — session not responding)' : '(stopped by user)';
      // Phase 4: the abort path resolves without usage/duration (the CLI never
      // emitted a result event), so the chip carries only the exit reason.
      const result_meta = { exit_reason: abortReason === 'timeout' ? 'timeout' : 'stopped', tokens: null, duration_ms: null };
      send({ type: 'agent_complete', room_id, message_id, content: partial || fallback, ai_model: targetModel || undefined, result_meta });
      console.log(`[stoa] Aborted message ${message_id}, reason=${abortReason || 'user'}, partial=${partial.length} chars`);
    } else {
      const { text: cleanContent, attachments } = await extractAndUploadFiles(content, msg.workdir);
      const actualModel = targetModel || (modelUsage && Object.keys(modelUsage).find(k => k !== 'total')) || undefined;
      // Phase 4: structured run result for the cost chip + orchestrator summary.
      // A non-'success' subtype (e.g. error_max_turns) marks a non-clean finish.
      const result_meta = {
        exit_reason: (subtype && subtype !== 'success') ? 'error' : 'completed',
        tokens: usage ? { input: usage.input_tokens || 0, output: usage.output_tokens || 0 } : null,
        duration_ms: durationMs || null,
      };
      const completeMsg = { type: 'agent_complete', room_id, message_id, content: cleanContent || (attachments.length ? '📎' : cleanContent), claude_session_id: sessionId, ai_model: actualModel, result_meta };
      if (attachments.length === 1) {
        completeMsg.file_url = attachments[0].url;
        completeMsg.file_name = attachments[0].name;
      } else if (attachments.length > 1) {
        completeMsg.attachments = attachments;
      }
      send(completeMsg);

      // Report token usage to server for tracking
      if (usage || modelUsage) {
        send({ type: 'usage_report', room_id, message_id, actor_id: ACTOR_ID, model: targetModel || 'unknown', usage: usage || {}, modelUsage: modelUsage || {}, totalCostUsd: totalCostUsd || 0 });
      }

      // Strip base64 image data from the session file so a later resume by a model without image
      // support doesn't choke. Awaited (not fire-and-forget) so it finishes before the finally block
      // runs drainQueue() — otherwise the next queued trigger could resume and read the file while
      // sanitizeSession is still mid-write. sanitizeSession uses async fs, so awaiting here keeps the
      // ordering guarantee without blocking the event loop.
      if (sessionId && targetDir && !compactsInFlight.has(targetDir)) {
        await stripSessionImages(targetDir, sessionId);
      }

      // Auto-compact: check session file size and compact if needed.
      // Runs inside setImmediate so the finally block (activeTriggers.delete + drainQueue) is not delayed by the stat() call.
      const sessionIdForCompact = sessionId;
      if (sessionIdForCompact && targetDir) {
        setImmediate(async () => {
          const fileSize = await getSessionFileSize(targetDir, sessionIdForCompact);
          if (fileSize <= AUTO_COMPACT_THRESHOLD) return;
          if (compactsInFlight.has(targetDir)) return;
          const sess = sessionPool.get(sessionKey);
          if (!sess) return;
          console.log(`[stoa] session ${sessionIdForCompact.slice(0, 8)}... is ${(fileSize / 1024).toFixed(0)}KB > ${AUTO_COMPACT_THRESHOLD / 1024}KB threshold, auto-compacting`);
          compactsInFlight.add(targetDir);
          send({ type: 'auto_compact_start', room_id, claude_session_id: sessionIdForCompact });
          sess.send({ prompt: '/compact', onState: () => {} }).then(result => {
            compactsInFlight.delete(targetDir);
            if (result?.sessionId) sess.resumeId = result.sessionId;
            send({ type: 'compact_complete', room_id, result: result?.content || '', claude_session_id: result?.sessionId || sessionIdForCompact, orig_session_id: sessionIdForCompact });
            setTimeout(() => {
              truncateSessionFile(targetDir, sessionIdForCompact);
              if (result?.sessionId && result.sessionId !== sessionIdForCompact) truncateSessionFile(targetDir, result.sessionId);
            }, 3000);
          }).catch(err => {
            compactsInFlight.delete(targetDir);
            console.error(`[stoa] auto-compact error: ${err.message}`);
            send({ type: 'compact_error', room_id, error: err.message });
          });
        });
      }
    }

  } catch (err) {
    consecutiveTriggerErrors++;
    console.error(`[stoa] trigger error (${consecutiveTriggerErrors}/${MAX_TRIGGER_ERRORS}): ${err.message}`);
    send({ type: 'agent_error', room_id, message_id, error: err.message });
    if (consecutiveTriggerErrors >= MAX_TRIGGER_ERRORS) {
      console.log('[stoa] too many trigger errors, restarting clean...');
      for (const s of sessionPool.values()) s.shutdown();
      process.exit(0);
    }
  } finally {
    if (sessionRef && statusHandler) sessionRef.removeListener('status', statusHandler);
    activeTriggers.delete(message_id);
    if (targetDir) startSessionIdleTimer(`${targetDir}::${room_id}`);
    drainQueue();
  }
}

async function extractAndUploadFiles(content, workdir) {
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
  const matches = [...content.matchAll(/\[send:([^\]]+)\]/g)];
  if (!matches.length) return { text: content, attachments: [] };

  let text = content;
  for (const m of matches) text = text.replace(m[0], '');
  text = text.trim();

  const baseUrl = STOA_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  const mimeMap = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
    '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python', '.html': 'text/html', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.sh': 'text/x-shellscript', '.sql': 'text/x-sql', '.xml': 'application/xml' };

  const attachments = [];
  for (const m of matches) {
    const filePath = m[1].trim();
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workdir || '.', filePath);
    if (!fs.existsSync(resolved)) {
      console.log(`[stoa] send file not found: ${resolved}`);
      continue;
    }
    try {
      const fileData = fs.readFileSync(resolved);
      const fileName = path.basename(resolved);
      const ext = path.extname(fileName).toLowerCase();
      const mime = mimeMap[ext] || 'application/octet-stream';
      const res = await fetch(`${baseUrl}/api/upload/raw`, {
        method: 'POST',
        headers: {
          'Content-Type': mime,
          'X-File-Name': encodeURIComponent(fileName),
          'X-Agent-Id': String(ACTOR_ID),
          'X-Agent-Secret': STOA_SECRET,
        },
        body: fileData,
      });
      const result = await res.json();
      console.log(`[stoa] uploaded file: ${fileName} → ${result.url}`);
      attachments.push({ url: result.url, name: result.name, type: IMAGE_EXTS.has(ext) ? 'image' : 'file' });
    } catch (err) {
      console.error(`[stoa] file upload failed: ${err.message}`);
    }
  }
  return { text, attachments };
}

async function sendProactiveMessage(roomId, content) {
  const baseUrl = STOA_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    const res = await fetch(`${baseUrl}/api/rooms/${roomId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': String(ACTOR_ID),
        'X-Agent-Secret': STOA_SECRET,
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[stoa] proactive message failed: ${err.error || res.status}`);
    }
  } catch (e) {
    console.error(`[stoa] proactive message error: ${e.message}`);
  }
}

function drainQueue() {
  while (activeTriggers.size < MAX_CONCURRENT && triggerQueue.length > 0) {
    const next = triggerQueue.shift();
    console.log(`[stoa] dequeued msg=${next.message_id} (${triggerQueue.length} remaining, active=${activeTriggers.size}/${MAX_CONCURRENT})`);
    processTrigger(next);
  }
  if (activeTriggers.size === 0 && triggerQueue.length === 0 && pendingRestart) doRestart();
}

function fetchToFile(url, destPath) {
  const http = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(destPath); });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

function fetchText(url) {
  const http = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => text += c);
      res.on('end', () => resolve(text));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Workdir scanner ──────────────────────────────────────────────────────────

const SCAN_EXCLUDE_SYSTEM = new Set([
  // Windows C:\ level
  'windows','program files','program files (x86)','programdata',
  'system volume information','$recycle.bin','recovery','users','boot','efi','msocache',
  // Windows USERPROFILE level (default folders)
  'downloads','documents','music','pictures','videos','desktop',
  'appdata','onedrive','contacts','favorites','links',
  'saved games','searches','3d objects',
  // Unix/common
  'node_modules','.git','dist','build','.next','__pycache__',
]);

function scanForWorkdirs() {
  const home = os.homedir();
  const isWindows = process.platform === 'win32';

  const results = [];

  function hasClaudeMarker(dir) {
    try {
      const entries = fs.readdirSync(dir);
      return entries.includes('.claude') || entries.includes('CLAUDE.md');
    } catch { return false; }
  }

  function parseJsonc(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return JSON.parse(stripped);
    } catch { return null; }
  }

  function readSkills(dir) {
    const skills = [];
    const commandsDir = path.join(dir, '.claude', 'commands');
    try {
      const files = fs.readdirSync(commandsDir);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const name = f.replace(/\.md$/, '');
        let description = null;
        try {
          const content = fs.readFileSync(path.join(commandsDir, f), 'utf8');
          const firstLine = content.split('\n').find(l => l.trim());
          description = firstLine?.replace(/^#\s*/, '').trim() || null;
        } catch {}
        skills.push({ name, description, scope: 'project' });
      }
    } catch {}
    return skills;
  }

  function scanDir(dir, depth, maxDepth, excludeSet) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (dir !== home && path.basename(dir) !== '.claude' && hasClaudeMarker(dir)) {
        const skills = readSkills(dir);
        results.push({ path: dir, skills, is_default: dir === home + '/stoa-workspace' || dir === path.join(home, 'stoa-workspace') });
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
        if (excludeSet.has(entry.name.toLowerCase())) continue;
        // Skip .claude/projects — Claude Code internal session state, not real workdirs
        if (path.basename(dir) === '.claude' && entry.name === 'projects') continue;
        scanDir(path.join(dir, entry.name), depth + 1, maxDepth, excludeSet);
      }
    } catch {}
  }

  // Scan home directory (3 levels)
  const homeExclude = new Set([...SCAN_EXCLUDE_SYSTEM]);
  scanDir(home, 0, 3, homeExclude);

  // On Windows, also scan C:\ (2 levels, excluding system dirs)
  if (isWindows) {
    const cDrive = 'C:\\';
    const cExclude = new Set([...SCAN_EXCLUDE_SYSTEM, 'users']); // skip Users since home already covered
    try {
      const topDirs = fs.readdirSync(cDrive, { withFileTypes: true });
      for (const entry of topDirs) {
        if (!entry.isDirectory()) continue;
        if (cExclude.has(entry.name.toLowerCase())) continue;
        scanDir(path.join(cDrive, entry.name), 0, 2, SCAN_EXCLUDE_SYSTEM);
      }
    } catch {}
  }

  // Always include STOA_WORK_DIR as default workdir if it exists and not already in list
  const defaultWorkDir = process.env.STOA_WORK_DIR;
  if (defaultWorkDir && fs.existsSync(defaultWorkDir)) {
    const normalized = path.resolve(defaultWorkDir);
    if (!results.find(r => path.resolve(r.path) === normalized)) {
      const skills = readSkills(normalized);
      results.unshift({ path: normalized, skills, is_default: true });
    } else {
      // Mark it as default if already found via scan
      const existing = results.find(r => path.resolve(r.path) === normalized);
      if (existing) existing.is_default = true;
    }
  }

  // Global skills from ~/.claude/commands/
  const globalSkills = [];
  const globalCommandsDir = path.join(home, '.claude', 'commands');
  try {
    const files = fs.readdirSync(globalCommandsDir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const name = f.replace(/\.md$/, '');
      let description = null;
      try {
        const content = fs.readFileSync(path.join(globalCommandsDir, f), 'utf8');
        const firstLine = content.split('\n').find(l => l.trim());
        description = firstLine?.replace(/^#\s*/, '').trim() || null;
      } catch {}
      globalSkills.push({ name, description, scope: 'global' });
    }
  } catch {}

  return { workdirs: results, globalSkills };
}

// ─── Human (interactive) mode ─────────────────────────────────────────────────
function handleHumanMessage(msg) {
  if (msg.type === 'history') {
    if (msg.messages.length) {
      out(C.gray + `── ${msg.messages.length} pesan sebelumnya ──` + C.reset);
      msg.messages.forEach(renderMessage);
      out(C.gray + '── sekarang ──' + C.reset);
    }
    return;
  }

  if (msg.type === 'message_new') { renderMessage(msg.message); reprompt(); return; }

  if (msg.type === 'message_state' && msg.state === 'streaming') {
    const color = colorFromHex(msg.avatar_color);
    out('');
    process.stdout.write(color + C.bold + msg.avatar_symbol + ' ' + msg.actor_name + C.reset + '  ' + C.gray + '●●●' + C.reset);
    activeStreams[msg.message_id] = { actor_name: msg.actor_name, color, symbol: msg.avatar_symbol, started: false };
    return;
  }

  if (msg.type === 'message_token') {
    const s = activeStreams[msg.message_id];
    if (!s) return;
    if (!s.started) {
      process.stdout.write('\r\x1b[K' + s.color + C.bold + s.symbol + ' ' + s.actor_name + C.reset + '  ');
      s.started = true;
    }
    process.stdout.write(msg.token);
    return;
  }

  if (msg.type === 'message_complete') {
    if (activeStreams[msg.message_id]) {
      out('');
      delete activeStreams[msg.message_id];
      reprompt();
    }
    return;
  }

  if (msg.type === 'invite_suggestion') {
    const a = msg.suggested_actor;
    out(C.yellow +
      '┌─ Invite suggestion ──────────────────────\n' +
      `│  ${a.avatar_symbol} ${a.name} diusulkan masuk room ini\n` +
      `│  Alasan: ${msg.reason || '—'}\n` +
      `│  /approve ${msg.invite_id}  atau  /reject ${msg.invite_id}\n` +
      '└──────────────────────────────────────────' + C.reset);
    reprompt();
  }
}

function renderMessage(m) {
  const color = colorFromHex(m.avatar_color);
  const ts = m.created_at
    ? new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : '';
  out('\n' + color + C.bold + m.avatar_symbol + ' ' + m.actor_name + C.reset + C.gray + '  ' + ts + C.reset);
  out(m.content);
}

function startPrompt() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  reprompt();

  rl.on('line', async line => {
    const input = line.trim();
    if (!input) { reprompt(); return; }

    if (input === '/exit') { ws.close(); rl.close(); return; }

    const m = input.match(/^\/(approve|reject) (\d+)$/);
    if (m) {
      const approved = m[1] === 'approve';
      await fetch(`${STOA_URL.replace('ws://', 'http://')}/api/invites/${m[2]}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      out(C.gray + `[Invite ${approved ? 'approved' : 'rejected'}]` + C.reset);
      reprompt();
      return;
    }

    send({ type: 'send_message', room_id: ROOM_ID, content: input });
    reprompt();
  });
}

function reprompt() {
  if (rl) rl.setPrompt(C.white + '◉  ' + C.reset); rl?.prompt(true);
}

function printHeader() {
  out(C.gray +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '  STOA  —  Room #' + ROOM_ID + '\n' +
    '  /exit untuk keluar\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function send(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function out(line) {
  process.stdout.write('\n' + line + '\n');
}

process.on('SIGINT', () => {
  clearTimeout(reconnectTimer);
  for (const s of sessionPool.values()) s.shutdown();
  ws?.close();
  process.exit(0);
});

process.on('uncaughtException', err => {
  console.error('[stoa] uncaughtException:', err.message);
});

process.on('unhandledRejection', err => {
  console.error('[stoa] unhandledRejection:', err?.message || err);
});

// Keep event loop alive + WebSocket heartbeat
const keepAlive = setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.ping?.();
  } else if (ACTOR_TYPE === 'ai' && ws?.readyState === WebSocket.CLOSED) {
    // Safety net: reconnect if stuck in disconnected state (close event may not have fired)
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    connect();
  }
}, 20_000);

connect();

if (ACTOR_TYPE === 'ai') {
  updateChecker = setInterval(checkForUpdates, UPDATE_INTERVAL);
  setTimeout(checkForUpdates, 15_000); // cek awal setelah koneksi stabil
}
