#!/usr/bin/env node
/**
 * Isolated integration test runner.
 *
 * Guarantees the LIVE server + REAL DB are never touched:
 *   1. Copies db/stoa.db -> a throwaway temp file (no WAL/SHM carried over)
 *   2. Neutralizes external side-effects in the COPY
 *      (automation_connections -> 'disconnected' so boot won't reconnect Slack;
 *      mcp_servers -> disabled so live upstreams stay out of the MCP tests)
 *      and sets a throwaway login password in the COPY (env STOA_TEST_EMAIL/STOA_TEST_PASSWORD)
 *   3. Boots a throwaway server on an isolated free port (never the live PORT),
 *      building its agent bundle into a temp dir (STOA_AGENT_BUNDLE_DIR) — the live
 *      server serves dist/stoa.js to agents, so a rebuild there leaks branch code to prod
 *   4. Runs test/test.js against it via env (PORT + DB_PATH + TEST_HOST),
 *      STREAMING output so partial results survive a hang, with a hard timeout
 *      (agent-dispatch tests block without a live agent client connected)
 *   5. Tears everything down (kills server + test, deletes temp DB + temp bundle)
 *   6. Fails the run if the live dist/stoa.js was modified during the run
 *   7. Points STOA_ENV_FILE at a throwaway copy of .env (PATCH /api/settings writes the env file;
 *      against the live .env a parallel run once raced it and dropped PORT) and fails the run
 *      if the live .env changed anyway
 *
 *   8. Writes a random token into the COPY (table stoa_test_marker) and passes it as
 *      STOA_TEST_DB_TOKEN; test.js refuses to run against any DB without the matching token
 *   9. Points the in-app updater (lib/server-update.js) at a temp git fixture dir, so no test can run git/npm
 *      on this repo, and keeps its boot-guard state file in that temp dir
 *  10. From a git worktree with no db/stoa.db, copies the DB (and .env) from the main worktree,
 *      read-only — never symlink the live DB into a worktree
 *
 * Usage:        node .claude/tools/run-tests.js
 * Pin port:     TEST_PORT=4123 node .claude/tools/run-tests.js
 * Timeout (s):  TEST_TIMEOUT=120 node .claude/tools/run-tests.js   (default 90)
 */

const { spawn, execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const net  = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '../..');
const testFile    = path.join(projectRoot, 'test.js');
const serverFile  = path.join(projectRoot, 'server.js');

// A git worktree has no db/stoa.db or .env of its own: read them (read-only) from the main
// worktree, so nobody needs to symlink the live DB into a worktree to run tests.
function sourceRoot() {
  if (fs.existsSync(path.join(projectRoot, 'db', 'stoa.db'))) return projectRoot;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    const main = path.dirname(path.resolve(projectRoot, common));
    if (fs.existsSync(path.join(main, 'db', 'stoa.db'))) return main;
  } catch {}
  return projectRoot;
}
const dataRoot    = sourceRoot();
const liveDb      = path.join(dataRoot, 'db', 'stoa.db');
const liveBundle  = path.join(dataRoot, 'dist', 'stoa.js');
const liveEnv     = path.join(dataRoot, '.env');
const TIMEOUT_MS  = (parseInt(process.env.TEST_TIMEOUT, 10) || 180) * 1000;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitUp(port, tries = 50) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => (++n > tries ? resolve(false) : setTimeout(tick, 200)));
    };
    tick();
  });
}

(async () => {
  const tmpDb = path.join(os.tmpdir(), `stoa-test-${process.pid}.db`);
  const tmpArtifacts = [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`];
  const tmpBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-test-dist-'));
  const tmpEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-test-env-'));
  const tmpMcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-test-mcp-'));
  const tmpUpdateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-test-update-'));
  const tmpEnv = path.join(tmpEnvDir, '.env');
  const rmTmp = () => {
    tmpArtifacts.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    try { fs.rmSync(tmpBundleDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpEnvDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpMcpDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpUpdateDir, { recursive: true, force: true }); } catch {}
  };
  const bundleStamp = () => { try { const s = fs.statSync(liveBundle); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };
  const liveBundleBefore = bundleStamp();
  const envStamp = () => { try { const s = fs.statSync(liveEnv); return `${s.mtimeMs}:${fs.readFileSync(liveEnv, 'utf8')}`; } catch { return null; } };
  const liveEnvBefore = envStamp();
  try { fs.copyFileSync(liveEnv, tmpEnv); } catch { fs.writeFileSync(tmpEnv, ''); }

  tmpArtifacts.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  try { fs.copyFileSync(liveDb, tmpDb); } catch (e) {
    console.log(JSON.stringify({ success: false, error: `no source DB to copy: ${e.message}` }, null, 2));
    rmTmp();
    process.exit(1);
  }
  const testPassword = crypto.randomBytes(18).toString('base64url');
  const dbToken = crypto.randomBytes(24).toString('hex');
  let testEmail = null;

  try {
    const c = new Database(tmpDb);
    c.pragma('journal_mode = WAL');
    try { c.prepare("UPDATE automation_connections SET status='disconnected'").run(); } catch {}
    // Live MCP servers (e.g. a default_access='all' preset) would leak into the MCP policy tests'
    // tool lists and make real upstream calls: the COPY starts with every server disabled.
    try { c.prepare('UPDATE mcp_servers SET enabled=0').run(); } catch {}
    // The live password can change any time and must never live in test code: give the COPY a
    // throwaway password (same scrypt format as server.js hashPassword) and hand it to test.js via env.
    const user = c.prepare('SELECT id, email FROM auth_users ORDER BY id LIMIT 1').get();
    if (user) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(testPassword, salt, 64).toString('hex');
      c.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(`${salt}:${hash}`, user.id);
      testEmail = user.email;
    }
    // test.js refuses any DB_PATH that does not carry this token (see its header guard).
    c.exec('CREATE TABLE stoa_test_marker (token TEXT NOT NULL)');
    c.prepare('INSERT INTO stoa_test_marker (token) VALUES (?)').run(dbToken);
    c.close();
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: `failed to prep temp DB: ${e.message}` }, null, 2));
    rmTmp();
    process.exit(1);
  }

  const PORT = parseInt(process.env.TEST_PORT, 10) || (await getFreePort());
  const env = { ...process.env, PORT: String(PORT), DB_PATH: tmpDb, TEST_HOST: '127.0.0.1', STOA_TEST: '1', STOA_AGENT_BUNDLE_DIR: tmpBundleDir,
    STOA_ENV_FILE: tmpEnv,
    // MCP upstream work dirs (<root>/<server id>) apart from the live server's: ids overlap with the DB copy.
    STOA_MCP_WORK_DIR: tmpMcpDir,
    // Expired-retrigger sweep (60 s in prod) fast enough for the offline-agent give-up test.
    RETRIGGER_SWEEP_MS: '500',
    // Model-free embedding backend: exercises worker/backfill/hybrid without a 130 MB download.
    STOA_SEMANTIC_BACKEND: 'hash',
    // Server run timeout (15 min in prod) short enough for the timed-out sub-agent tests to reach it.
    AGENT_RUN_TIMEOUT_MS: '15000',
    // Scheduler loop tick (30 s in prod) fast enough for the scheduled-trigger firing tests.
    SCHED_TICK_MS: '1000',
    // MCP approval wait (5 min in prod) short enough for the expiry test to reach it.
    MCP_APPROVAL_TIMEOUT_MS: '3000',
    // In-app updater works on a git fixture test.js builds here — never on this repo — and believes a
    // process manager exists so its checks run. Its boot-guard state stays in the temp dir too, and the
    // daily check never fires during a run (test.js drives /check itself).
    STOA_UPDATE_REPO_DIR: path.join(tmpUpdateDir, 'live'),
    STOA_UPDATE_STATE_FILE: path.join(tmpUpdateDir, 'update-state.json'),
    STOA_TEST_PROCESS_MANAGER: 'launchd',
    STOA_UPDATE_CHECK_DELAY_MS: String(24 * 3600_000),
    STOA_TEST_EMAIL: testEmail || '', STOA_TEST_PASSWORD: testPassword, STOA_TEST_DB_TOKEN: dbToken };

  const server = spawn(process.execPath, [serverFile], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  if (!(await waitUp(PORT))) {
    console.log(JSON.stringify({ success: false, error: 'throwaway server failed to start', testPort: PORT, serverLog: serverLog.trim().slice(-2000) }, null, 2));
    try { server.kill('SIGKILL'); } catch {}
    rmTmp();
    process.exit(1);
  }

  // Run the test suite, STREAMING output so early passes survive a later hang.
  const result = await new Promise((resolve) => {
    const test = spawn(process.execPath, [testFile], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    test.stdout.on('data', (d) => (output += d));
    test.stderr.on('data', (d) => (output += d));

    const timer = setTimeout(() => {
      timedOut = true;
      try { test.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS);

    test.on('close', (code) => {
      clearTimeout(timer);
      resolve({ output, code, timedOut });
    });
  });

  try { server.kill('SIGKILL'); } catch {}
  rmTmp();

  const passed = (result.output.match(/✓/g) || []).length;
  const failed = (result.output.match(/✗/g) || []).length;
  const liveBundleTouched = bundleStamp() !== liveBundleBefore;
  const liveEnvTouched = envStamp() !== liveEnvBefore;
  const summary = {
    // A timeout is NOT success, but partial results below still tell us which tests passed.
    success: !result.timedOut && result.code === 0 && failed === 0 && !liveBundleTouched && !liveEnvTouched,
    liveBundleTouched,
    liveEnvTouched,
    timedOut: result.timedOut,
    timeoutSec: TIMEOUT_MS / 1000,
    testPort: PORT,
    total: passed + failed,
    passed,
    failed,
    output: result.output.trim(),
    serverLog: serverLog.trim().slice(-1500),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.success ? 0 : 1);
})();
