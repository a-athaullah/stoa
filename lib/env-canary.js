'use strict';

// Stale login session canary (task #47, #48). After WindowServer dies and the macOS login session is
// replaced, PM2 and every agent it supervises keep running in the dead session: the WS link still
// works, but NEW processes fail the passwd lookup ("No user exists for uid 501", uv_os_get_passwd
// ENOENT), so harness CLIs, git over SSH and browsers break. A process that was already running keeps
// answering os.userInfo() from its cached lookup, and /usr/bin/id -u still succeeds — checking only
// those (the #47 canary) never fails. So the probe spawns a fresh node process that calls
// os.userInfo(); the transition is reported to the server (env_health), which offers Repair
// (`pm2 update`, lib/pm2-repair.js).

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const FAILURE_THRESHOLD = 3;
const MAX_REASON = 200;

const CHILD_PROBE_SCRIPT = 'try{process.stdout.write(String(require("os").userInfo().uid))}catch(e){process.stderr.write(String(e&&e.message));process.exit(1)}';

function cleanReason(v) {
  const s = String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return (s || 'unknown error').slice(0, MAX_REASON);
}

function parseIntervalMs(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 100 && n <= 3_600_000 ? n : DEFAULT_INTERVAL_MS;
}

// The probe child must not inherit flags that make node do more than run the one-liner (an
// --inspect in NODE_OPTIONS would collide on the agent's debug port; --require could load anything).
function childProbeEnv(env) {
  const out = { ...env };
  for (const k of ['NODE_OPTIONS', 'NODE_INSPECT_RESUME_ON_START', 'NODE_REPL_EXTERNAL_MODULE']) delete out[k];
  return out;
}

// deps: userInfo() (throws when the uid has no user), execFile(file, args, opts, cb), send(msg),
// execPath (node binary for the fresh-process probe), env, platform. The child probes run only on
// POSIX — Windows has no stale-session failure mode.
function createEnvCanary({ userInfo, execFile, send, platform = process.platform,
  execPath = process.execPath, env = process.env,
  intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, threshold = FAILURE_THRESHOLD,
  log = () => {} } = {}) {
  let failures = 0;
  let unhealthy = false;
  let reason = null;
  let inFlight = null;
  let timer = null;

  // Resolves null when the child exits 0 and its stdout is a uid, else the failure text. Spawn errors
  // (sync throw or async 'error'), non-zero exits, signals and hangs all count as failures.
  function runChild(label, file, args, opts) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (err) => { if (!settled) { settled = true; clearTimeout(guard); resolve(err); } };
      // Own timer on top of execFile's: a hung fork/exec in a broken session must not stall the canary.
      const guard = setTimeout(() => done(`${label} timed out after ${timeoutMs}ms`), timeoutMs);
      try {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, ...opts }, (err, stdout, stderr) => {
          if (err) {
            const detail = String(stderr ?? '').trim() || err.message;
            return done(`${label} failed: ${detail}`);
          }
          if (!/^\d+\s*$/.test(String(stdout))) return done(`${label} returned no uid`);
          done(null);
        });
      } catch (err) {
        done(`${label} failed: ${err.message}`);
      }
    });
  }

  async function probe() {
    try { userInfo(); } catch (err) { return `os.userInfo() failed: ${err.message}`; }
    if (platform === 'win32') return null;
    const [fresh, id] = await Promise.all([
      runChild('new process os.userInfo()', execPath, ['-e', CHILD_PROBE_SCRIPT], { env: childProbeEnv(env) }),
      runChild('/usr/bin/id', '/usr/bin/id', ['-u'], {}),
    ]);
    return fresh || id;
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

module.exports = { createEnvCanary, parseIntervalMs, cleanReason, childProbeEnv, CHILD_PROBE_SCRIPT, DEFAULT_INTERVAL_MS, FAILURE_THRESHOLD, MAX_REASON };
