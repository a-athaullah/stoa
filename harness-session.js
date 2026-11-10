function createHarnessSession(harness, opts, deps) {
  if (harness === 'codex') {
    let CodexSession;
    try {
      CodexSession = require('./codex-session').CodexSession;
    } catch {
      throw new Error('codex-session.js not installed on this agent — will arrive on next auto-update');
    }
    return new CodexSession(opts);
  }
  const CS = deps?.ClaudeSession;
  if (CS) return new CS(opts);
  throw new Error('ClaudeSession not provided — pass via deps when calling outside stoa.js');
}

function supportsCompact(harness) {
  return !harness || harness === 'claude';
}

function buildResumeArgs(msg, { targetDir, sessionKey, harness }) {
  return {
    targetDir,
    toolsSupported: msg.tools_supported,
    sessionKey,
    thirdParty: !!msg.base_url,
    systemPrompt: msg.system_prompt || null,
    systemPromptHash: msg.system_prompt_hash || null,
    harness: harness || 'claude',
  };
}

const KNOWN_HARNESSES = ['claude', 'codex'];

function parseClaudeAuthStatus(stdout) {
  try {
    const data = JSON.parse(stdout);
    return typeof data.loggedIn === 'boolean' ? data.loggedIn : null;
  } catch {
    return null;
  }
}

function parseCodexLoginStatus(exitCode) {
  if (exitCode === 0) return true;
  if (exitCode === 1) return false;
  return null;
}

const MODEL_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_MODELS = 50;

function parseCodexModels(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data.models)) return null;
    const listed = data.models
      .filter(m => m && m.visibility === 'list' && typeof m.slug === 'string')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    if (!listed.length) return null;
    return listed.map((m, i) => ({
      id: m.slug,
      label: typeof m.display_name === 'string' ? m.display_name : m.slug,
      is_default: i === 0,
    }));
  } catch {
    return null;
  }
}

// Claude CLI has no model-listing command, but its binary embeds the model IDs it knows.
// Strict pattern: family + major (+ minor) (+ date). The minor must not be followed by another digit,
// so a legacy dated ID like claude-opus-4-20250514 parses as major 4 + date, never minor=20. The
// tail lookahead drops codenames (claude-fable-5-mythos-5: "-" + two letters) and IDs that run on
// into more digits or word characters; a Bedrock suffix (-v1) is cut off, keeping the base ID.
const CLAUDE_MODEL_SCAN_RE = /\bclaude-(haiku|sonnet|opus|fable)-(\d{1,2})(?:-(\d{1,2})(?!\d))?(?:-(\d{8}))?(?![\w]|-[a-z]{2}|-\d)/g;
const CLAUDE_MODEL_ID_RE = /^claude-(haiku|sonnet|opus|fable)-(\d{1,2})(?:-(\d{1,2}))?(?:-(\d{8}))?$/;
const CLAUDE_SCAN_CHUNK = 1 << 20;
const CLAUDE_SCAN_OVERLAP = 64;
const CLAUDE_SCAN_MAX_BYTES = 1 << 30;
const MAX_CLAUDE_CANDIDATES = 50;

function extractClaudeModelIds(text, into = new Set()) {
  for (const m of text.matchAll(CLAUDE_MODEL_SCAN_RE)) into.add(m[0]);
  return into;
}

// { base, family, ver, date } for a Claude model ID; a dated snapshot shares the base of its alias.
function claudeModelKey(id) {
  const m = typeof id === 'string' ? CLAUDE_MODEL_ID_RE.exec(id) : null;
  if (!m) return null;
  const base = m[3] === undefined ? `claude-${m[1]}-${m[2]}` : `claude-${m[1]}-${m[2]}-${m[3]}`;
  return { base, family: m[1], major: +m[2], minor: m[3] === undefined ? null : +m[3], ver: +m[2] * 100 + (m[3] === undefined ? 0 : +m[3]), date: m[4] || null };
}

// claude-opus-5-5 → "Opus 5.5", claude-haiku-4-5-20251001 → "Haiku 4.5", claude-opus-6 → "Opus 6".
function claudeModelLabel(id) {
  const k = claudeModelKey(id);
  if (!k) return null;
  return `${k.family[0].toUpperCase()}${k.family.slice(1)} ${k.major}${k.minor === null ? '' : '.' + k.minor}`;
}

// One ID per base (the undated alias wins over a dated snapshot), newest first.
function rankClaudeModelIds(ids) {
  const byBase = new Map();
  for (const id of ids) {
    const k = claudeModelKey(id);
    if (!k) continue;
    const prev = byBase.get(k.base);
    if (!prev || (prev.date && !k.date) || (prev.date && k.date && k.date > prev.date)) byBase.set(k.base, { id, ...k });
  }
  return [...byBase.values()]
    .sort((a, b) => b.ver - a.ver || a.family.localeCompare(b.family))
    .slice(0, MAX_CLAUDE_CANDIDATES)
    .map(e => e.id);
}

function resolveCommandPath(cmd, env = process.env) {
  const fs = require('fs');
  const path = require('path');
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD').split(';') : [''];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext.toLowerCase());
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.realpathSync(candidate);
      } catch {}
    }
  }
  return null;
}

// Streams the file in 1 MB chunks (never the whole 250 MB binary in memory) with a small
// overlap so an ID split across a chunk boundary is still found. latin1 maps bytes 1:1.
function scanClaudeBinaryForModels(filePath) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const found = new Set();
    let tail = '';
    let bytes = 0;
    const stream = fs.createReadStream(filePath, { encoding: 'latin1', highWaterMark: CLAUDE_SCAN_CHUNK });
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > CLAUDE_SCAN_MAX_BYTES) { stream.destroy(); reject(new Error('binary too large')); return; }
      const text = tail + chunk;
      extractClaudeModelIds(text, found);
      tail = text.slice(-CLAUDE_SCAN_OVERLAP);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(rankClaudeModelIds(found)));
  });
}

let _claudeScanCache = null; // { key, candidates } — one entry: rescans only when the CLI binary changes

// After a CLI update: an in-place reinstall can keep size and mtime, so the next detect rescans.
function resetClaudeScanCache() {
  _claudeScanCache = null;
}

async function detectClaudeModelCandidates(env = process.env) {
  const fs = require('fs');
  const binPath = resolveCommandPath('claude', env);
  if (!binPath) return null;
  const st = fs.statSync(binPath);
  const key = `${binPath}:${st.size}:${st.mtimeMs}`;
  if (_claudeScanCache?.key === key) return _claudeScanCache.candidates;
  const candidates = await scanClaudeBinaryForModels(binPath);
  _claudeScanCache = { key, candidates };
  return candidates;
}

function validateModels(models) {
  if (!Array.isArray(models)) return null;
  const seen = new Set();
  const valid = [];
  for (const m of models) {
    if (!m || typeof m.id !== 'string' || !MODEL_ID_RE.test(m.id)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const label = typeof m.label === 'string' ? m.label.slice(0, 100) : m.id;
    valid.push({ id: m.id, label, is_default: m.is_default === true });
    if (valid.length >= MAX_MODELS) break;
  }
  if (!valid.length) return null;
  if (!valid.some(m => m.is_default)) valid[0].is_default = true;
  return valid;
}

function validateHarnessStatus(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.filter(s =>
    s && KNOWN_HARNESSES.includes(s.id) &&
    !seen.has(s.id) && (seen.add(s.id), true) &&
    typeof s.installed === 'boolean' &&
    (s.logged_in === null || typeof s.logged_in === 'boolean') &&
    (s.version === null || typeof s.version === 'string')
  ).map(s => ({ id: s.id, installed: s.installed, logged_in: s.logged_in ?? null, version: s.version ? s.version.slice(0, 100) : null, models: validateModels(s.models) }));
}

// A run that failed because the CLI or API does not know the requested model (Claude CLI:
// "There's an issue with the selected model"; API: not_found_error on model; Codex: "model ...
// does not exist / is not supported"). Only error text is passed in, so assistant prose about
// models never reaches this; auth, quota and capacity errors are excluded explicitly.
const MODEL_UNAVAILABLE_RES = [
  /issue with the selected model/i,
  /not_found_error[^\n]{0,120}\bmodel\b/i,
  /\bmodel_not_found\b/i,
  /\bmodel\b[^\n]{0,120}\b(?:does not exist|not found|is not supported|isn't supported|is not available|not available for)/i,
  /\b(?:unknown|invalid|unsupported) model\b/i,
];
const NOT_A_MODEL_ERROR_RE = /\b(?:401|403|429|529)\b|unauthori[sz]ed|authenticat|api[ _-]?key|quota|rate[ _-]?limit|overloaded|capacity|billing|credit/i;

function isModelUnavailableError(text) {
  if (typeof text !== 'string' || !text || text.length > 2000) return false;
  if (NOT_A_MODEL_ERROR_RE.test(text)) return false;
  return MODEL_UNAVAILABLE_RES.some(re => re.test(text));
}

// Fixed per-harness update commands: the server only ever names the harness, never a command.
// Both CLIs pick the right path for their install method (native installer, npm, Homebrew).
const HARNESS_UPDATE_ARGS = { claude: ['update'], codex: ['update'] };
const UPDATE_ERROR_MAX = 300;

// CLI output shown in the UI: no ANSI codes or control characters, home directory masked as "~",
// absolute user paths masked, token-looking strings redacted, last UPDATE_ERROR_MAX chars kept.
function sanitizeUpdateError(text, home) {
  if (typeof text !== 'string') return null;
  let s = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');
  if (typeof home === 'string' && home.length > 1) s = s.split(home).join('~');
  s = s.replace(/(?:\/Users|\/home)\/[^\s/'"]+/g, '~').replace(/[A-Za-z]:\\Users\\[^\s\\'"]+/gi, '~');
  s = s.replace(/\b(?:sk|ghp|gho|xox[abpr]|github_pat)[-_][A-Za-z0-9_-]{10,}/g, '[redacted]');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > UPDATE_ERROR_MAX ? '\u2026' + s.slice(-(UPDATE_ERROR_MAX - 1)) : s;
}

function filesToUpdate(remote, local, allowed) {
  const names = [];
  for (const [name, hash] of Object.entries(remote)) {
    if (!allowed.includes(name)) continue;
    if (name.includes('/') || name.includes('\\') || name.includes('..')) continue;
    if (local[name] === hash) continue;
    names.push(name);
  }
  return names;
}

module.exports = { createHarnessSession, supportsCompact, buildResumeArgs, KNOWN_HARNESSES, parseClaudeAuthStatus, parseCodexLoginStatus, parseCodexModels, validateHarnessStatus, validateModels, filesToUpdate, extractClaudeModelIds, rankClaudeModelIds, claudeModelKey, claudeModelLabel, resolveCommandPath, scanClaudeBinaryForModels, detectClaudeModelCandidates, resetClaudeScanCache, isModelUnavailableError, HARNESS_UPDATE_ARGS, sanitizeUpdateError };
