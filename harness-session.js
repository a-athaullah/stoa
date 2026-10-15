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
  return exitCode === 0;
}

function validateHarnessStatus(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(s =>
    s && KNOWN_HARNESSES.includes(s.id) &&
    typeof s.installed === 'boolean' &&
    (s.logged_in === null || typeof s.logged_in === 'boolean') &&
    (s.version === null || typeof s.version === 'string')
  ).map(s => ({ id: s.id, installed: s.installed, logged_in: s.logged_in ?? null, version: s.version ?? null }));
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

module.exports = { createHarnessSession, supportsCompact, buildResumeArgs, KNOWN_HARNESSES, parseClaudeAuthStatus, parseCodexLoginStatus, validateHarnessStatus, filesToUpdate };
