'use strict';
// In-app updater: check origin/<default branch> for new commits, fast-forward, reinstall deps when the
// lockfile changed, smoke-boot the new code on a throwaway DB copy, then hand over to the existing restart
// path. Any failure before the restart resets the tree to the previous HEAD and leaves the live server
// running. The boot after the restart is watched by lib/boot-guard.js.
//
// Security: every git/npm call is execFile with a fixed argv and a timeout (no shell, nothing from the
// request). The remote is always 'origin' and the branch comes from git itself (origin/HEAD).
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { readState, writeState, npmCommand, NPM_CI_ARGS } = require('./boot-guard');

const REMOTE = 'origin';
const MAX_COMMITS = 50;
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 60_000;
const NPM_TIMEOUT_MS = 10 * 60_000;
const SMOKE_TIMEOUT_MS = 90_000;
const SMOKE_SETTLE_MS = 3_000;
const STATUS_ATTEMPTS = 5;
// Priority order: the first present blocker is the 409 code.
const BLOCKER_ORDER = ['update_running', 'not_default_branch', 'dirty_tree', 'diverged', 'up_to_date'];

function run(cmd, args, { cwd, timeout, env, label = `${path.basename(cmd)} ${args[0]}` }) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400);
        const e = new Error(err.killed ? `${label} timed out` : `${label} failed${detail ? `: ${detail}` : ''}`);
        e.code = err.code;
        return reject(e);
      }
      resolve(stdout.trim());
    });
  });
}

function runNpmCi(opts) {
  const npm = npmCommand(NPM_CI_ARGS);
  return run(npm.file, npm.args, { ...opts, label: 'npm ci' });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function httpUp(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    r.on('timeout', () => r.destroy());
    r.on('error', () => resolve(false));
  });
}

// checked_at / check_error survive a restart in their own file: the boot guard rewrites the whole state
// file, so fields stored there would be dropped. Anything that does not look like our own write → null.
function readCheck(file) {
  const c = readState(file);
  const at = c && typeof c.checked_at === 'string' ? c.checked_at : null;
  if (!at || Number.isNaN(Date.parse(at)) || new Date(at).toISOString() !== at) return { checkedAt: null, checkError: null };
  return { checkedAt: at, checkError: typeof c.check_error === 'string' ? c.check_error.slice(0, 1000) : null };
}

function createServerUpdate({
  repoDir, stateFile, checkFile = path.join(path.dirname(stateFile), 'update-check.json'), envFile, db, restartable, isDocker = false,
  countActiveRuns, broadcast, restart,
  smokeTimeoutMs = SMOKE_TIMEOUT_MS, smokeSettleMs = SMOKE_SETTLE_MS, log = console,
}) {
  // GIT_OPTIONAL_LOCKS=0: `git status` otherwise refreshes the index under index.lock, and a status poll
  // landing on that lock makes the update's own merge or rollback reset fail with "index.lock exists".
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  const git = (args, timeout = GIT_TIMEOUT_MS) => run('git', args, { cwd: repoDir, timeout, env: gitEnv });

  // last_result here only holds this process's own failure; lastResult() merges it with the state file.
  const progress = { state: 'idle', step: null, error: null, last_result: null };
  let { checkedAt, checkError } = readCheck(checkFile);
  let notifiedSha = null;
  let busy = false;
  let checkChain = Promise.resolve();
  let progressSeq = 0;

  function saveCheck() {
    try { writeState(checkFile, { checked_at: checkedAt, check_error: checkError }); }
    catch (e) { log.error('[update] could not write check file:', e.message); }
  }

  function setProgress(state, step, error = null) {
    progressSeq++;
    Object.assign(progress, { state, step, error });
    broadcast({ type: 'update_progress', state, step, error });
  }

  async function supportReason() {
    if (isDocker) return 'docker';
    try {
      const top = await git(['rev-parse', '--show-toplevel']);
      // realpath: macOS tmp dirs live behind the /var → /private/var symlink, and git reports the resolved path.
      if (fs.realpathSync(top) !== fs.realpathSync(repoDir)) return 'not_git';
    } catch { return 'not_git'; }
    if (!restartable) return 'no_process_manager';
    return null;
  }

  async function defaultBranch() {
    try {
      const ref = await git(['symbolic-ref', '--short', `refs/remotes/${REMOTE}/HEAD`]);
      if (ref.startsWith(`${REMOTE}/`)) return ref.slice(REMOTE.length + 1);
    } catch {}
    for (const b of ['main', 'master']) {
      try { await git(['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${b}`]); return b; } catch {}
    }
    return null;
  }

  async function versionAt(ref) {
    try { return JSON.parse(await git(['show', `${ref}:package.json`])).version || null; } catch { return null; }
  }

  // Local-only view (no network): what HEAD is, how far it is from the last fetched origin ref, and what blocks an update.
  async function inspect() {
    const reason = await supportReason();
    const base = { supported: !reason, reason, branch: null, current: null, latest: null, behind: 0, commits: [], blockers: [] };
    if (reason === 'not_git' || reason === 'docker') return base;
    const branch = await defaultBranch();
    const head = await git(['rev-parse', 'HEAD']);
    base.branch = branch;
    base.current = { sha: head.slice(0, 7), version: await versionAt('HEAD') };
    // A pending boot check means the restarted version has not proven itself yet; another update now
    // would overwrite the rollback target the boot guard relies on.
    if (readState(stateFile)?.status === 'pending') base.blockers.push('update_running');
    const current = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (current !== branch) base.blockers.push('not_default_branch');
    // Only changes to tracked files block. Untracked files survive both the fast-forward and the
    // rollback (reset --hard leaves them alone), and one that collides with an incoming path makes
    // `merge --ff-only` fail before HEAD moves.
    if (await git(['status', '--porcelain', '--untracked-files=no'])) base.blockers.push('dirty_tree');
    if (!branch) return base;
    const upstream = `${REMOTE}/${branch}`;
    const latest = await git(['rev-parse', upstream]);
    base.latest = { sha: latest.slice(0, 7), version: await versionAt(upstream) };
    const [ahead, behind] = (await git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).split(/\s+/).map(Number);
    base.behind = behind;
    if (ahead > 0 && behind > 0) base.blockers.push('diverged');
    if (behind === 0) base.blockers.push('up_to_date');
    if (behind > 0) {
      const out = await git(['log', `--max-count=${MAX_COMMITS}`, '--format=%h%x00%s', `HEAD..${upstream}`]);
      base.commits = out ? out.split('\n').map(l => { const [sha, subject] = l.split('\0'); return { sha, subject }; }) : [];
    }
    base.blockers.sort((a, b) => BLOCKER_ORDER.indexOf(a) - BLOCKER_ORDER.indexOf(b));
    return base;
  }

  // The state file is the source of truth: the boot guard rewrites it after this module loaded (healthy mark →
  // ok, crash-loop rollback → failed), so it is read per call instead of once at boot. A pending update has no
  // outcome yet. The in-memory failure wins only if it is newer — i.e. perform() could not write the file.
  function lastResult() {
    const s = readState(stateFile);
    const file = s && s.status !== 'pending' ? s.last_result || null : null;
    const mem = progress.last_result;
    return mem && (!file || String(mem.at) > String(file.at)) ? mem : file;
  }

  // perform() moves HEAD (merge, rollback reset) before it publishes the matching progress state, so an
  // inspect() that overlaps a progress change may have read the tree from the other side of it (e.g.
  // state 'failed' next to the pre-rollback HEAD). Re-inspect until no progress change landed mid-read.
  async function status() {
    let view, seq;
    for (let i = 0; i < STATUS_ATTEMPTS; i++) {
      seq = progressSeq;
      try { view = await inspect(); }
      catch (e) { view = { supported: false, reason: 'not_git', branch: null, current: null, latest: null, behind: 0, commits: [], blockers: [], inspectError: e.message }; }
      if (seq === progressSeq) break;
    }
    const { inspectError, ...body } = view;
    return { ...body, checked_at: checkedAt, check_error: inspectError || checkError, active_runs: countActiveRuns(), update: { ...progress, last_result: lastResult() } };
  }

  async function fetchOrigin() {
    await git(['fetch', '--quiet', '--no-tags', REMOTE], FETCH_TIMEOUT_MS);
    // origin/HEAD is only set by clone; without it the default branch falls back to main/master.
    try { await git(['remote', 'set-head', REMOTE, '--auto'], FETCH_TIMEOUT_MS); } catch {}
  }

  // Serialized: a manual check and the daily timer never run git fetch against the same repo at once.
  function check() {
    const job = checkChain.then(async () => {
      if (!(await supportReason()) && !busy) {
        try { await fetchOrigin(); checkError = null; }
        catch (e) { checkError = e.message; }
        checkedAt = new Date().toISOString();
        saveCheck();
      }
      const s = await status();
      if (s.behind > 0 && s.latest && s.latest.sha !== notifiedSha) {
        notifiedSha = s.latest.sha;
        broadcast({ type: 'update_available', latest: s.latest, behind: s.behind });
      }
      return s;
    });
    checkChain = job.catch(() => {});
    return job;
  }

  async function smokeBoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-smoke-'));
    let child = null;
    try {
      const dbCopy = path.join(dir, 'stoa.db');
      await db.backup(dbCopy);
      const Database = db.constructor;
      const c = new Database(dbCopy);
      try {
        try { c.prepare("UPDATE automation_connections SET status='disconnected'").run(); } catch {}
        try { c.prepare('UPDATE mcp_servers SET enabled=0').run(); } catch {}
      } finally { c.close(); }
      // A copy: PATCH /api/settings writes the env file, and the smoke server must never touch the live one.
      const envCopy = path.join(dir, '.env');
      try { fs.copyFileSync(envFile, envCopy); } catch { fs.writeFileSync(envCopy, ''); }
      for (const sub of ['dist', 'mcp']) fs.mkdirSync(path.join(dir, sub));
      const port = await freePort();
      const env = { ...process.env, PORT: String(port), DB_PATH: dbCopy, STOA_ENV_FILE: envCopy,
        STOA_AGENT_BUNDLE_DIR: path.join(dir, 'dist'), STOA_MCP_WORK_DIR: path.join(dir, 'mcp'),
        // Also moves update-check.json (derived from it) into the throwaway dir.
        STOA_UPDATE_STATE_FILE: path.join(dir, 'update-state.json'),
        STOA_SMOKE_BOOT: '1', STOA_SEMANTIC_SEARCH: 'off', STOA_ORPHAN_WAKE: 'off' };
      let output = '';
      child = spawn(process.execPath, [path.join(repoDir, 'server.js')], { cwd: repoDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const keep = (d) => { output = (output + d).slice(-2000); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      let exitCode = null;
      child.on('exit', (code, signal) => { exitCode = code ?? signal; });
      const tail = () => output.trim().split('\n').slice(-5).join(' | ').slice(0, 600);
      const deadline = Date.now() + smokeTimeoutMs;
      let up = false;
      while (!up && exitCode === null && Date.now() < deadline) {
        up = await httpUp(port);
        if (!up) await new Promise(r => setTimeout(r, 300));
      }
      if (exitCode !== null) throw new Error(`smoke boot exited (${exitCode}): ${tail()}`);
      if (!up) throw new Error(`smoke boot not healthy within ${Math.round(smokeTimeoutMs / 1000)}s: ${tail()}`);
      await new Promise(r => setTimeout(r, smokeSettleMs));
      if (exitCode !== null) throw new Error(`smoke boot crashed after start (${exitCode}): ${tail()}`);
    } finally {
      if (child && child.exitCode === null) {
        const gone = new Promise(r => child.once('exit', r));
        child.kill('SIGKILL');
        await gone;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async function perform() {
    let prevHead = null, newHead = null, installed = false;
    let step = 'fetch';
    try {
      setProgress('running', step);
      await fetchOrigin();
      checkedAt = new Date().toISOString();
      checkError = null;
      saveCheck();
      const view = await inspect();
      if (view.reason) throw new Error(`update not supported: ${view.reason}`);
      if (view.blockers.length) throw new Error(`update blocked: ${view.blockers[0]}`);
      prevHead = await git(['rev-parse', 'HEAD']);
      step = 'merge';
      setProgress('running', step);
      await git(['merge', '--ff-only', '--quiet', `${REMOTE}/${view.branch}`]);
      newHead = await git(['rev-parse', 'HEAD']);
      const lockChanged = await git(['diff', '--quiet', prevHead, newHead, '--', 'package-lock.json']).then(() => false, (e) => { if (e.code === 1) return true; throw e; });
      if (lockChanged) {
        step = 'install';
        setProgress('running', step);
        installed = true;
        await runNpmCi({ cwd: repoDir, timeout: NPM_TIMEOUT_MS, env: process.env });
      }
      step = 'smoke';
      setProgress('running', step);
      await smokeBoot();
    } catch (e) {
      const error = `${step}: ${e.message}`.slice(0, 1000);
      let rolledBack = false;
      if (prevHead && newHead && prevHead !== newHead) {
        try {
          await git(['reset', '--hard', '--quiet', prevHead]);
          if (installed) await runNpmCi({ cwd: repoDir, timeout: NPM_TIMEOUT_MS, env: process.env });
          rolledBack = true;
        } catch (re) { log.error('[update] rollback failed:', re.message); }
      }
      const result = { ok: false, rolled_back: rolledBack, from: prevHead, to: newHead, error, at: new Date().toISOString() };
      progress.last_result = result;
      try { writeState(stateFile, { status: 'failed', prev_head: prevHead, new_head: newHead, last_result: result }); }
      catch (we) { log.error('[update] could not write state file:', we.message); }
      log.error(`[update] failed at ${error}${rolledBack ? ' — rolled back' : ''}`);
      setProgress('failed', step, error);
      return;
    }
    progress.last_result = null;
    writeState(stateFile, { status: 'pending', prev_head: prevHead, new_head: newHead, attempts: 0, started_at: new Date().toISOString(), last_result: null });
    log.log(`[update] ${prevHead.slice(0, 7)} → ${newHead.slice(0, 7)} passed smoke boot — restarting`);
    setProgress('restarting', 'restart');
    restart('update');
  }

  // → { status, body } for the HTTP handler. 202 means perform() runs in the background.
  async function start({ force = false } = {}) {
    if (busy || progress.state === 'running' || progress.state === 'restarting') {
      return { status: 409, body: { error: 'An update is already running', code: 'update_running' } };
    }
    busy = true;
    let started = false;
    try {
      await checkChain;
      const reason = await supportReason();
      if (reason) return { status: 400, body: { error: 'Update is not supported on this install', code: reason } };
      const view = await inspect();
      if (view.blockers.length) return { status: 409, body: { error: 'Update blocked', code: view.blockers[0] } };
      const activeRuns = countActiveRuns();
      if (activeRuns > 0 && force !== true) {
        return { status: 409, body: { error: `${activeRuns} agent run(s) in progress`, code: 'active_runs', active_runs: activeRuns } };
      }
      started = true;
      perform().catch(e => { log.error('[update] unexpected error:', e.message); setProgress('failed', progress.step, e.message); })
        .finally(() => { busy = false; });
      return { status: 202, body: { ok: true } };
    } finally {
      if (!started) busy = false;
    }
  }

  // Daily check: first run after firstDelayMs, then every intervalMs. Failures land in check_error only.
  function startDailyCheck({ firstDelayMs, intervalMs }) {
    let timer = null;
    const tick = (delay) => {
      timer = setTimeout(async () => {
        try { await check(); } catch (e) { checkError = e.message; saveCheck(); }
        tick(intervalMs);
      }, delay);
      timer.unref();
    };
    tick(firstDelayMs);
    return () => clearTimeout(timer);
  }

  return { status, check, start, startDailyCheck };
}

module.exports = { createServerUpdate, BLOCKER_ORDER };
