'use strict';
// better-sqlite3 is a native addon: after a Node upgrade (or when the process manager runs a different
// Node than the one that ran npm install) loading it fails with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION
// and a long stack that does not say what to do. Server-side console only, so paths are fine here.

function isNativeAbiError(e) {
  return !!e && (e.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(String(e.message)));
}

function nativeAbiHint(e, proc = process) {
  return [
    `[db] better-sqlite3 cannot load in this Node.js (${proc.version}, ${proc.execPath}): it was built for another Node version.`,
    `[db] Fix: in the Stoa folder run "npm rebuild better-sqlite3" with this same Node (node -v must print ${proc.version}), then start Stoa again.`,
    `[db] Loader error: ${String(e.message).split('\n')[0]}`,
  ].join('\n');
}

// Runs open(); on a native ABI mismatch logs the hint and exits non-zero, anything else is rethrown.
function openSqliteOrExit(open, { log = console, exit = (code) => process.exit(code) } = {}) {
  try {
    return open();
  } catch (e) {
    if (!isNativeAbiError(e)) throw e;
    log.error(nativeAbiHint(e));
    return exit(1);
  }
}

module.exports = { isNativeAbiError, nativeAbiHint, openSqliteOrExit };
