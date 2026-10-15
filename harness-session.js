const { CodexSession } = require('./codex-session');

function createHarnessSession(harness, opts, deps) {
  if (harness === 'codex') return new CodexSession(opts);
  const CS = deps?.ClaudeSession;
  if (CS) return new CS(opts);
  throw new Error('ClaudeSession not provided — pass via deps when calling outside stoa.js');
}

function supportsCompact(harness) {
  return !harness || harness === 'claude';
}

module.exports = { createHarnessSession, supportsCompact };
