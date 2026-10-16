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

module.exports = { createHarnessSession, supportsCompact, buildResumeArgs, KNOWN_HARNESSES, parseClaudeAuthStatus, parseCodexLoginStatus, parseCodexModels, validateHarnessStatus, validateModels, filesToUpdate };
