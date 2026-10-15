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

module.exports = { createHarnessSession, supportsCompact, filesToUpdate };
