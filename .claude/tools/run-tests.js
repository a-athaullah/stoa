#!/usr/bin/env node
/**
 * Isolated integration test runner.
 *
 * Guarantees the LIVE server + REAL DB are never touched:
 *   1. Copies db/stoa.db -> a throwaway temp file (no WAL/SHM carried over)
 *   2. Neutralizes external side-effects in the COPY
 *      (automation_connections -> 'disconnected' so boot won't reconnect Slack)
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
 * Usage:        node .claude/tools/run-tests.js
 * Pin port:     TEST_PORT=4123 node .claude/tools/run-tests.js
 * Timeout (s):  TEST_TIMEOUT=120 node .claude/tools/run-tests.js   (default 90)
 */

const { spawn } = require('child_process');
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
const liveDb      = path.join(projectRoot, 'db', 'stoa.db');
const liveBundle  = path.join(projectRoot, 'dist', 'stoa.js');
const liveEnv     = path.join(projectRoot, '.env');
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
  const tmpEnv = path.join(tmpEnvDir, '.env');
  const rmTmp = () => {
    tmpArtifacts.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    try { fs.rmSync(tmpBundleDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpEnvDir, { recursive: true, force: true }); } catch {}
  };
  const bundleStamp = () => { try { const s = fs.statSync(liveBundle); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };
  const liveBundleBefore = bundleStamp();
  const envStamp = () => { try { const s = fs.statSync(liveEnv); return `${s.mtimeMs}:${fs.readFileSync(liveEnv, 'utf8')}`; } catch { return null; } };
  const liveEnvBefore = envStamp();
  try { fs.copyFileSync(liveEnv, tmpEnv); } catch { fs.writeFileSync(tmpEnv, ''); }

  tmpArtifacts.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  fs.copyFileSync(liveDb, tmpDb);
  const testPassword = crypto.randomBytes(18).toString('base64url');
  let testEmail = null;

  try {
    const c = new Database(tmpDb);
    c.pragma('journal_mode = WAL');
    try { c.prepare("UPDATE automation_connections SET status='disconnected'").run(); } catch {}
    // The live password can change any time and must never live in test code: give the COPY a
    // throwaway password (same scrypt format as server.js hashPassword) and hand it to test.js via env.
    const user = c.prepare('SELECT id, email FROM auth_users ORDER BY id LIMIT 1').get();
    if (user) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(testPassword, salt, 64).toString('hex');
      c.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(`${salt}:${hash}`, user.id);
      testEmail = user.email;
    }
    c.close();
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: `failed to prep temp DB: ${e.message}` }, null, 2));
    rmTmp();
    process.exit(1);
  }

  const PORT = parseInt(process.env.TEST_PORT, 10) || (await getFreePort());
  const env = { ...process.env, PORT: String(PORT), DB_PATH: tmpDb, TEST_HOST: '127.0.0.1', STOA_TEST: '1', STOA_AGENT_BUNDLE_DIR: tmpBundleDir,
    STOA_ENV_FILE: tmpEnv,
    // Model-free embedding backend: exercises worker/backfill/hybrid without a 130 MB download.
    STOA_SEMANTIC_BACKEND: 'hash',
    // Server run timeout (15 min in prod) short enough for the timed-out sub-agent tests to reach it.
    AGENT_RUN_TIMEOUT_MS: '15000',
    // MCP approval wait (5 min in prod) short enough for the expiry test to reach it.
    MCP_APPROVAL_TIMEOUT_MS: '3000',
    STOA_TEST_EMAIL: testEmail || '', STOA_TEST_PASSWORD: testPassword };

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
