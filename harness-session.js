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
// Strict pattern: family + major + minor (+ optional date). Two-digit major/minor keeps
// legacy dated IDs like claude-opus-4-20250514 from parsing as minor=20250514; the trailing
// \b drops Bedrock suffixes (-v1) and rejects codenames like claude-fable-5-mythos-5.
const CLAUDE_MODEL_SCAN_RE = /\bclaude-(haiku|sonnet|opus|fable)-(\d{1,2})-(\d{1,2})(?:-(\d{8}))?\b/g;
const CLAUDE_SCAN_CHUNK = 1 << 20;
const CLAUDE_SCAN_OVERLAP = 64;
const CLAUDE_SCAN_MAX_BYTES = 1 << 30;
const MAX_CLAUDE_CANDIDATES = 50;

function extractClaudeModelIds(text, into = new Set()) {
  for (const m of text.matchAll(CLAUDE_MODEL_SCAN_RE)) into.add(m[0]);
  return into;
}

// One ID per family+major+minor (the undated alias wins over a dated snapshot), newest first.
function rankClaudeModelIds(ids) {
  const byBase = new Map();
  for (const id of ids) {
    const m = /^claude-(haiku|sonnet|opus|fable)-(\d{1,2})-(\d{1,2})(?:-(\d{8}))?$/.exec(id);
    if (!m) continue;
    const base = `claude-${m[1]}-${m[2]}-${m[3]}`;
    const prev = byBase.get(base);
    if (!prev || (prev.date && !m[4]) || (prev.date && m[4] && m[4] > prev.date)) {
      byBase.set(base, { id, major: +m[2], minor: +m[3], family: m[1], date: m[4] || null });
    }
  }
  return [...byBase.values()]
    .sort((a, b) => b.major - a.major || b.minor - a.minor || a.family.localeCompare(b.family))
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

module.exports = { createHarnessSession, supportsCompact, buildResumeArgs, KNOWN_HARNESSES, parseClaudeAuthStatus, parseCodexLoginStatus, parseCodexModels, validateHarnessStatus, validateModels, filesToUpdate, extractClaudeModelIds, rankClaudeModelIds, resolveCommandPath, scanClaudeBinaryForModels, detectClaudeModelCandidates };
