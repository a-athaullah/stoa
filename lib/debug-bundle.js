const fs = require('fs');
const path = require('path');
const os = require('os');

const ENVELOPE_FORMAT = 1;
const HOME_RE = new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

function forceRedact(input) {
  if (input == null) return input;
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map(forceRedact);
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (/^(adapter_config|secret|api_key|apiKey)$/i.test(k)) { out[k] = '[REDACTED]'; continue; }
      out[k] = forceRedact(v);
    }
    return out;
  }
  if (typeof input !== 'string') return input;
  let s = input;
  s = s.replace(HOME_RE, '~');
  s = s.replace(/(?:sk-|anthropic-|key-|token-|Bearer )[A-Za-z0-9_\-]{20,}/g, '[REDACTED]');
  s = s.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[REDACTED-EMAIL]');
  s = s.replace(/(?:password|secret|token|apiKey|api_key)\s*[:=]\s*\S+/gi, m => m.split(/[:=]/)[0] + ': [REDACTED]');
  s = s.replace(/\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED-IP]');
  return s;
}

function collectDiagnostics(db) {
  const health = {};
  try {
    health.page_count = db.pragma('page_count', { simple: true });
    health.page_size = db.pragma('page_size', { simple: true });
    health.size_bytes = health.page_count * health.page_size;
    health.freelist_pages = db.pragma('freelist_count', { simple: true });
    health.journal_mode = db.pragma('journal_mode', { simple: true });
    const walPath = db.name + '-wal';
    try { health.wal_size_bytes = fs.statSync(walPath).size; } catch { health.wal_size_bytes = 0; }
  } catch (e) { health.error = e.message; }

  let rooms = [];
  try {
    rooms = db.prepare(`SELECT id, title, created_at, archived_at, max_ai_turns, model FROM rooms`).all();
  } catch {}

  let agents = [];
  try {
    agents = db.prepare(`SELECT id, name, type, adapter FROM actors WHERE type='ai'`).all();
  } catch {}

  let sessions = [];
  try {
    sessions = db.prepare(`SELECT id, room_id, status, last_active_at, compact_failure_error, pinned FROM ai_sessions`).all();
  } catch {}

  let settings = [];
  try {
    settings = db.prepare(`SELECT key, value, scope FROM settings`).all()
      .map(s => ({ key: s.key, value: forceRedact(s.value), scope: s.scope }));
  } catch {}

  const counts = {};
  try {
    counts.rooms = db.prepare('SELECT COUNT(*) as n FROM rooms WHERE archived_at IS NULL').get().n;
    counts.messages = db.prepare('SELECT COUNT(*) as n FROM messages').get().n;
    counts.ai_sessions = db.prepare('SELECT COUNT(*) as n FROM ai_sessions').get().n;
    counts.agents = db.prepare("SELECT COUNT(*) as n FROM actors WHERE type='ai'").get().n;
  } catch {}

  const logDir = path.join(path.dirname(db.name), 'logs');
  const serverLog = readLogTail(path.join(logDir, 'stoa.log'), 200);
  const errorLog = readLogTail(path.join(logDir, 'stoa.err'), 100);

  return {
    health,
    rooms_summary: rooms.map(r => ({ ...r, title: forceRedact(r.title) })),
    agents_summary: agents,
    sessions,
    settings,
    counts,
    server_log_tail: serverLog,
    error_log_tail: errorLog,
  };
}

function readLogTail(filepath, lines) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const arr = content.split('\n');
    return arr.slice(-lines).join('\n');
  } catch { return null; }
}

function buildEnvelope(diagnostics) {
  const pkg = (() => { try { return require('../package.json'); } catch { return {}; } })();
  return forceRedact({
    format: ENVELOPE_FORMAT,
    redacted: true,
    created: new Date().toISOString(),
    stoa_version: pkg.version || 'unknown',
    node_version: process.version,
    platform: process.platform,
    uptime_seconds: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    data: diagnostics,
  });
}

function gcDebugBundles(db) {
  let cleaned = 0;
  try {
    const expired = db.prepare(
      "SELECT id, file_path FROM debug_bundles WHERE expires_at <= datetime('now') OR read_count >= max_reads"
    ).all();
    for (const bundle of expired) {
      try { fs.unlinkSync(bundle.file_path); } catch {}
      db.prepare('DELETE FROM debug_bundles WHERE id=?').run(bundle.id);
      cleaned++;
    }
  } catch {}
  return cleaned;
}

module.exports = { forceRedact, collectDiagnostics, buildEnvelope, gcDebugBundles, ENVELOPE_FORMAT };
