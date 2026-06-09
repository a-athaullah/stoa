// config.js — non-secret server settings, stored in config.yaml.
// Secrets (STOA_SECRET, STOA_PASSWORD, tokens) stay in .env; data stays in the DB.
//
// Resolution order (lowest → highest precedence):
//   built-in DEFAULTS  <  config.yaml  <  environment variables
// The env layer is for ops overrides and backward-compat with older .env setups.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const paths = require('./paths');

const DEFAULTS = {
  port: 3030,
  public_url: null,                 // null → auto-detect from the request host
  human_name: 'Human',
  max_ai_turns: 5,
  max_concurrent: 1,
  session_idle_ttl: 5,              // minutes
  auto_compact_threshold_kb: 500,
  idle_timeout_seconds: 300,
  cleanup: { cron_hour: 10, max_age_hours: 24 },
};

function configPath() { return path.join(paths.serverDir(), 'config.yaml'); }

function readFile() {
  try { return yaml.load(fs.readFileSync(configPath(), 'utf8')) || {}; }
  catch { return {}; }
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

const int = (v, fallback) => { const n = parseInt(v); return Number.isFinite(n) ? n : fallback; };

// Effective config (defaults < config.yaml < env).
function load() {
  const cfg = deepMerge(DEFAULTS, readFile());
  const E = process.env;
  if (E.PORT)                      cfg.port = int(E.PORT, cfg.port);
  if (E.STOA_PUBLIC_URL)           cfg.public_url = E.STOA_PUBLIC_URL;
  if (E.HUMAN_NAME)                cfg.human_name = E.HUMAN_NAME;
  if (E.MAX_AI_TURNS)              cfg.max_ai_turns = int(E.MAX_AI_TURNS, cfg.max_ai_turns);
  if (E.MAX_CONCURRENT)            cfg.max_concurrent = int(E.MAX_CONCURRENT, cfg.max_concurrent);
  if (E.SESSION_IDLE_TTL)          cfg.session_idle_ttl = int(E.SESSION_IDLE_TTL, cfg.session_idle_ttl);
  if (E.AUTO_COMPACT_THRESHOLD_KB) cfg.auto_compact_threshold_kb = int(E.AUTO_COMPACT_THRESHOLD_KB, cfg.auto_compact_threshold_kb);
  if (E.CLEANUP_CRON_HOUR)         cfg.cleanup.cron_hour = int(E.CLEANUP_CRON_HOUR, cfg.cleanup.cron_hour);
  if (E.CLEANUP_MAX_AGE_HOURS)     cfg.cleanup.max_age_hours = int(E.CLEANUP_MAX_AGE_HOURS, cfg.cleanup.max_age_hours);
  return cfg;
}

// Deep-merge a patch into config.yaml and persist. Returns the new effective config.
function update(patch) {
  const merged = deepMerge(readFile(), patch);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), yaml.dump(merged, { lineWidth: 100 }), 'utf8');
  return load();
}

// Create config.yaml with defaults (+ optional seed) if it doesn't exist yet.
function ensureFile(seed = {}) {
  if (fs.existsSync(configPath())) return;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), yaml.dump(deepMerge(DEFAULTS, seed), { lineWidth: 100 }), 'utf8');
}

module.exports = { DEFAULTS, configPath, load, update, ensureFile };
