'use strict';

// Stale login session canary (task #47). After WindowServer dies and the macOS login session is
// replaced, PM2 and every agent it supervises keep running in the dead session: the WS link still
// works, but os.userInfo() throws "No user exists for uid 501" and /usr/bin/id fails, so harness
// CLIs, git over SSH and browsers break. The agent checks both periodically and reports the
// transition to the server (env_health), which offers Repair (`pm2 update`, lib/pm2-repair.js).

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const FAILURE_THRESHOLD = 3;
const MAX_REASON = 200;

function cleanReason(v) {
  const s = String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return (s || 'unknown error').slice(0, MAX_REASON);
}

function parseIntervalMs(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 100 && n <= 3_600_000 ? n : DEFAULT_INTERVAL_MS;
}

// deps: userInfo() (throws when the uid has no user), execFile(file, args, opts, cb), send(msg),
// platform. execFile runs /usr/bin/id only on POSIX — Windows has no stale-session failure mode.
function createEnvCanary({ userInfo, execFile, send, platform = process.platform,
  intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, threshold = FAILURE_THRESHOLD,
  log = () => {} } = {}) {
  let failures = 0;
  let unhealthy = false;
  let reason = null;
  let inFlight = null;
  let timer = null;

  function runId() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (err) => { if (!settled) { settled = true; clearTimeout(guard); resolve(err); } };
      // Own timer on top of execFile's: a hung fork/exec in a broken session must not stall the canary.
      const guard = setTimeout(() => done(`/usr/bin/id timed out after ${timeoutMs}ms`), timeoutMs);
      try {
        execFile('/usr/bin/id', ['-u'], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
          if (err) return done(`/usr/bin/id failed: ${err.message}`);
          if (!/^\d+\s*$/.test(String(stdout))) return done('/usr/bin/id returned no uid');
          done(null);
        });
      } catch (err) {
        done(`/usr/bin/id failed: ${err.message}`);
      }
    });
  }

  async function probe() {
    try { userInfo(); } catch (err) { return `os.userInfo() failed: ${err.message}`; }
    if (platform === 'win32') return null;
    return runId();
  }

  async function runOnce() {
    const err = await probe();
    if (err) {
      failures++;
      reason = cleanReason(err);
      if (!unhealthy && failures >= threshold) {
        unhealthy = true;
        log(`[env] login session looks stale (${failures} failed checks): ${reason}`);
        send({ type: 'env_health', healthy: false, reason });
      }
      return;
    }
    failures = 0;
    reason = null;
    if (unhealthy) {
      unhealthy = false;
      log('[env] login session healthy again');
      send({ type: 'env_health', healthy: true });
    }
  }

  function tick() {
    if (!inFlight) inFlight = runOnce().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    tick,
    // The server forgets env health on disconnect: repeat an unhealthy report on every (re)connect.
    connected() { if (unhealthy) send({ type: 'env_health', healthy: false, reason }); },
    start() {
      if (!timer) { timer = setInterval(tick, intervalMs); timer.unref?.(); }
    },
    stop() { clearInterval(timer); timer = null; },
    state: () => ({ unhealthy, failures, reason }),
  };
}

module.exports = { createEnvCanary, parseIntervalMs, cleanReason, DEFAULT_INTERVAL_MS, FAILURE_THRESHOLD, MAX_REASON };
