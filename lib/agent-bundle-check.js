'use strict';

// Guards the agent auto-update path (incident 2026-11-13: dist/stoa.js vanished while the
// server was live, the raw stoa.js source — which needs ./lib/* — was served, and every agent
// that pulled it crash-looped on MODULE_NOT_FOUND). Shared by server.js (before serving) and
// stoa.js (before overwriting itself), so both sides apply the same definition of "installable".

// The only relative modules the agent bundle may load at runtime: esbuild keeps them external
// because they ship as separate update files next to stoa.js.
const AGENT_EXTERNAL_MODULES = new Set(['./claude-session', './codex-session']);

const RELATIVE_REQUIRE_RE = /\brequire\s*\(\s*(['"])(\.\.?\/[^'"\n]+)\1\s*\)/g;

function relativeRequires(src) {
  const out = new Set();
  for (const m of String(src).matchAll(RELATIVE_REQUIRE_RE)) out.add(m[2]);
  return [...out];
}

// Relative modules stoa.js would need that are not shipped with it. Non-empty = unbundled
// source (or a broken build): installing it crashes the agent before any of its code runs.
function unshippedAgentRequires(src) {
  return relativeRequires(src).filter(spec => !AGENT_EXTERNAL_MODULES.has(spec.replace(/\.js$/, '')));
}

module.exports = { AGENT_EXTERNAL_MODULES, relativeRequires, unshippedAgentRequires };
