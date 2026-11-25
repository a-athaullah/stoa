'use strict';

// Repair for agents stuck in a stale macOS login session (task #47, detection in lib/env-canary.js).
// The cure is `pm2 update`: it saves the process list, kills the PM2 daemon (and with it every agent
// on this machine) and resurrects them from a healthy session. The server runs under launchd, so its
// own session is healthy — it runs pm2 itself, which is why only agents on the server's machine are
// repairable. The command is fixed: no request data ever reaches the argv.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RUN_TIMEOUT_MS = 120_000;
const RECONNECT_TIMEOUT_MS = 120_000;
const COOLDOWN_MS = 30_000;
const OUTPUT_CAP = 4096;

// launchd gives the server a minimal PATH, so the usual install locations are probed as well.
function pm2Candidates(env = process.env, home = os.homedir()) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(d => path.isAbsolute(d));
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'));
  return [...new Set(dirs)].map(d => path.join(d, process.platform === 'win32' ? 'pm2.cmd' : 'pm2'));
}

function resolvePm2({ env = process.env, home = os.homedir(), isExecutable = isExecutableFile } = {}) {
  return pm2Candidates(env, home).find(isExecutable) || null;
}

function isExecutableFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function capOutput(s) {
  const str = String(s || '');
  return str.length > OUTPUT_CAP ? '…' + str.slice(-OUTPUT_CAP) : str;
}

// Default runner. detached + a log file (not pipes) so pm2 survives the server dying mid-update: a
// child writing into a closed pipe would get EPIPE/SIGPIPE half way through killing the daemon.
// pm2 is a `#!/usr/bin/env node` script, so node's own directory goes on PATH too.
function spawnRunner(bin, args, { timeoutMs = RUN_TIMEOUT_MS, logFile, env = process.env } = {}) {
  return new Promise((resolve) => {
    const file = logFile || path.join(os.tmpdir(), `stoa-pm2-repair-${process.pid}.log`);
    let fd;
    try { fd = fs.openSync(file, 'w', 0o600); } catch (err) { return resolve({ code: null, error: `cannot open log: ${err.message}`, output: '' }); }
    const childEnv = { ...env, PATH: [path.dirname(bin), path.dirname(process.execPath), env.PATH || ''].filter(Boolean).join(path.delimiter) };
    let child;
    try {
      child = spawn(bin, args, { shell: false, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: childEnv });
    } catch (err) {
      fs.closeSync(fd);
      return resolve({ code: null, error: err.message, output: '' });
    }
    fs.closeSync(fd);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    }, timeoutMs);
    const finish = (code, error) => {
      clearTimeout(timer);
      let output = '';
      try { output = capOutput(fs.readFileSync(file, 'utf8')); } catch {}
      resolve({ code, error: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : error, output });
    };
    child.on('error', (err) => finish(null, err.message));
    child.on('exit', (code, signal) => finish(code, code === 0 ? null : `exited with ${signal || `code ${code}`}`));
  });
}

// Why an unhealthy agent cannot be repaired from here ('not_local' | 'not_supervised'), or null when
// it can — or when it is healthy, so there is nothing to block. Single source for the UI's
// repairable/repair_block and for the endpoint's 409s.
function envRepairBlock({ envUnhealthy, local, supervised }) {
  if (!envUnhealthy) return null;
  if (!local) return 'not_local';
  if (!supervised) return 'not_supervised';
  return null;
}

// Error code (409 body) that blocks a repair, or null. Order matters: the most basic reason wins.
function repairBlocker({ online, envUnhealthy, local, supervised, busy }) {
  if (!online) return 'agent_offline';
  if (!envUnhealthy) return 'not_unhealthy';
  const block = envRepairBlock({ envUnhealthy, local, supervised });
  if (block) return block;
  if (busy) return 'repair_in_progress';
  return null;
}

// machine = the identity the agent sent in agent_connect ({ hostname, platform }).
function isLocalMachine(machine, { hostname = os.hostname(), platform = process.platform } = {}) {
  if (!machine || typeof machine.hostname !== 'string' || !machine.hostname) return false;
  return machine.platform === platform && machine.hostname.toLowerCase() === String(hostname).toLowerCase();
}

// One repair at a time, globally (it restarts every agent of the machine). States per the agent
// that asked: requested → running → done (that agent came back with a new boot_id after pm2 exited
// 0) | failed (no pm2, pm2 failed or timed out, or the agent did not return in time). A cooldown
// after the end stops back-to-back daemon kills.
function createPm2Repair({ onState, resolveBinary = resolvePm2, run = spawnRunner, now = Date.now,
  cooldownMs = COOLDOWN_MS, runTimeoutMs = RUN_TIMEOUT_MS, reconnectTimeoutMs = RECONNECT_TIMEOUT_MS,
  log = () => {} }) {
  let job = null;
  let finishedAt = -Infinity;

  function finish(state, error) {
    if (!job) return;
    const { actorId } = job;
    clearTimeout(job.timer);
    job = null;
    finishedAt = now();
    onState(actorId, state, error ? { error } : {});
  }

  function busy() {
    return !!job || now() - finishedAt < cooldownMs;
  }

  async function execute(current) {
    const bin = resolveBinary();
    if (job !== current) return;
    if (!bin) {
      log('[pm2-repair] pm2 binary not found on PATH, /opt/homebrew/bin, /usr/local/bin or ~/.npm-global/bin');
      return finish('failed', 'pm2 not found on this machine');
    }
    current.state = 'running';
    onState(current.actorId, 'running', {});
    log(`[pm2-repair] running ${bin} update for Actor #${current.actorId}`);
    let result;
    try {
      result = await run(bin, ['update'], { timeoutMs: runTimeoutMs });
    } catch (err) {
      result = { code: null, error: err.message, output: '' };
    }
    if (job !== current) return;
    if (result?.output) log(`[pm2-repair] pm2 update output:\n${capOutput(result.output)}`);
    if (result?.code !== 0) {
      const error = String(result?.error || 'pm2 update failed').slice(0, 200);
      log(`[pm2-repair] pm2 update failed: ${error}`);
      return finish('failed', error);
    }
    current.runOk = true;
    if (current.reconnected) return finish('done');
    current.timer = setTimeout(() => {
      if (job === current) finish('failed', 'agent did not reconnect after pm2 update');
    }, reconnectTimeoutMs);
    current.timer.unref?.();
  }

  return {
    busy,
    state: (actorId) => (job && job.actorId === actorId ? job.state : null),
    // bootId = the agent's current boot id; a reconnect with any other id proves the restart.
    start(actorId, bootId) {
      if (busy()) return false;
      const current = { actorId, bootId: bootId ?? null, state: 'requested', runOk: false, reconnected: false, timer: null };
      job = current;
      onState(actorId, 'requested', {});
      setImmediate(() => execute(current).catch((err) => {
        log(`[pm2-repair] unexpected error: ${err.message}`);
        if (job === current) finish('failed', 'internal error');
      }));
      return true;
    },
    agentConnected(actorId, bootId) {
      if (!job || job.actorId !== actorId) return;
      if (bootId && bootId === job.bootId) return;
      job.reconnected = true;
      if (job.runOk) finish('done');
    },
  };
}

module.exports = { createPm2Repair, resolvePm2, isExecutableFile, pm2Candidates, spawnRunner, repairBlocker, envRepairBlock, isLocalMachine, capOutput,
  RUN_TIMEOUT_MS, RECONNECT_TIMEOUT_MS, COOLDOWN_MS, OUTPUT_CAP };
