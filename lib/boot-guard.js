'use strict';
// Boot guard for the in-app updater (lib/server-update.js). server.js requires this module FIRST, before
// migrations or any heavy require, so a version that cannot boot is still caught: every boot while an
// update is 'pending' counts an attempt, and attempt MAX_ATTEMPTS + 1 resets the tree to the previous
// HEAD and exits, so the process manager boots the old version. Without a pending state file it is a
// no-op. Everything here is synchronous on purpose: it runs before the event loop does anything else.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_ATTEMPTS = 3;
const HEALTHY_AFTER_MS = 60_000;
const SHA_RE = /^[0-9a-f]{40}$/;

// Next to the DB (db/ by default, same rule as db/index.js) so an isolated DB_PATH never shares the
// live install's file. Gitignored: an untracked file here would read as a dirty tree to the updater.
function stateFilePath(env = process.env) {
  if (env.STOA_UPDATE_STATE_FILE) return path.resolve(env.STOA_UPDATE_STATE_FILE);
  const dir = env.DB_PATH ? path.dirname(path.resolve(env.DB_PATH)) : path.join(__dirname, '..', 'db');
  return path.join(dir, 'update-state.json');
}

function repoDirPath(env = process.env) {
  return env.STOA_UPDATE_REPO_DIR ? path.resolve(env.STOA_UPDATE_REPO_DIR) : path.resolve(__dirname, '..');
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch { return null; }
}

// tmp + rename: a crash mid-write must never leave a half-written file the next boot misreads.
function writeState(file, state) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function npmBin() {
  const local = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return fs.existsSync(local) ? local : 'npm';
}

function gitSync(repoDir, args, timeout = 60_000) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}

function lockChangedSync(repoDir, from, to) {
  try { gitSync(repoDir, ['diff', '--quiet', from, to, '--', 'package-lock.json']); return false; }
  catch (e) { if (e.status === 1) return true; throw e; }
}

// → 'none' (no pending update), 'stale' (HEAD is not the update's head: someone changed the tree by hand,
// so the guard steps aside), 'counted' (boot continues), 'rolled_back' / 'rollback_failed' (exit called).
function runBootGuard({ file = stateFilePath(), repoDir = repoDirPath(), exit = (code) => process.exit(code), log = console } = {}) {
  const state = readState(file);
  if (!state || state.status !== 'pending') return 'none';
  if (!SHA_RE.test(state.prev_head || '') || !SHA_RE.test(state.new_head || '')) {
    writeState(file, { ...state, status: 'stale' });
    return 'stale';
  }
  let head = null;
  try { head = gitSync(repoDir, ['rev-parse', 'HEAD']); } catch {}
  if (head !== state.new_head) {
    log.warn(`[boot-guard] pending update ${state.new_head.slice(0, 7)} but HEAD is ${head ? head.slice(0, 7) : 'unknown'} — guard disabled`);
    writeState(file, { ...state, status: 'stale' });
    return 'stale';
  }
  const attempts = (Number(state.attempts) || 0) + 1;
  if (attempts <= MAX_ATTEMPTS) {
    writeState(file, { ...state, attempts });
    log.log(`[boot-guard] update ${state.new_head.slice(0, 7)} boot attempt ${attempts}/${MAX_ATTEMPTS}`);
    return 'counted';
  }
  const result = { ok: false, rolled_back: true, from: state.prev_head, to: state.new_head, at: new Date().toISOString(),
    error: `server failed to stay up ${MAX_ATTEMPTS} times after the update — rolled back` };
  let status = 'rolled_back';
  try {
    const reinstall = lockChangedSync(repoDir, state.prev_head, state.new_head);
    gitSync(repoDir, ['reset', '--hard', state.prev_head]);
    if (reinstall) execFileSync(npmBin(), ['ci', '--no-audit', '--no-fund'], { cwd: repoDir, timeout: 10 * 60_000, stdio: 'ignore' });
    log.error(`[boot-guard] ${result.error}: ${state.new_head.slice(0, 7)} → ${state.prev_head.slice(0, 7)}`);
  } catch (e) {
    status = 'rollback_failed';
    result.rolled_back = false;
    result.error = `rollback failed: ${e.message}`.slice(0, 500);
    log.error(`[boot-guard] ${result.error}`);
  }
  writeState(file, { ...state, attempts, status, last_result: result });
  exit(1);
  return status;
}

// Called once the server listens: if it is still up after HEALTHY_AFTER_MS the update is final.
function scheduleHealthyMark({ file = stateFilePath(), delayMs = HEALTHY_AFTER_MS, log = console } = {}) {
  const state = readState(file);
  if (!state || state.status !== 'pending') return null;
  const timer = setTimeout(() => {
    const cur = readState(file);
    if (!cur || cur.status !== 'pending' || cur.new_head !== state.new_head) return;
    const last_result = { ok: true, rolled_back: false, from: cur.prev_head, to: cur.new_head, error: null, at: new Date().toISOString() };
    try { writeState(file, { ...cur, status: 'ok', last_result }); log.log(`[boot-guard] update ${cur.new_head.slice(0, 7)} healthy`); }
    catch (e) { log.error('[boot-guard] could not mark update healthy:', e.message); }
  }, delayMs);
  timer.unref();
  return timer;
}

module.exports = { MAX_ATTEMPTS, HEALTHY_AFTER_MS, stateFilePath, repoDirPath, readState, writeState, npmBin, lockChangedSync, runBootGuard, scheduleHealthyMark };
