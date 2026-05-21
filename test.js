#!/usr/bin/env node
// Stoa full-flow integration test
// Tests: setup, add agents (Idris + Kira), create room, workdirs, skills, chat WS
// Run: node test.js
// Cleanup: all created actors, rooms, workdirs, messages removed at end.

'use strict';

const http   = require('http');
const assert = require('assert');
const crypto = require('crypto');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path   = require('path');

const BASE  = 'http://localhost:3001';
const WS    = 'ws://localhost:3001';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'stoa.db');

let db;
let SESSION_COOKIE = '';
const created = { actors: [], rooms: [], workdirs: [], authUserId: null };

// ── helpers ──────────────────────────────────────────────────────────────────

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: '127.0.0.1', port: 3001,
      path: urlPath, method,
      headers: {
        'Content-Type': 'application/json',
        ...(buf ? { 'Content-Length': buf.length } : {}),
        ...(SESSION_COOKIE ? { 'Cookie': SESSION_COOKIE } : {}),
      },
    };
    const r = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}

function reqRaw(method, urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3001, path: urlPath, method,
      headers: SESSION_COOKIE ? { 'Cookie': SESSION_COOKIE } : {},
    };
    const r = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    r.on('error', reject);
    r.end();
  });
}

// Get a one-time install token via /install.sh script
async function getInstallToken(name) {
  const { body: script } = await reqRaw('GET', `/install.sh?name=${encodeURIComponent(name)}`);
  const m = script.match(/REG_TOKEN="([0-9a-f]+)"/);
  if (!m) throw new Error('could not parse REG_TOKEN from install.sh');
  return m[1];
}

// Register agent using the install token flow
async function registerAgent(name) {
  const token = await getInstallToken(name);
  const { status, body } = await req('POST', '/api/agent/register', { token });
  assert.strictEqual(status, 200, `register failed for ${name}: ${JSON.stringify(body)}`);
  return body; // { actor_id, name, secret }
}

function pass(msg) { process.stdout.write(`  \x1b[32m✓\x1b[0m ${msg}\n`); }
function fail(msg) { process.stdout.write(`  \x1b[31m✗\x1b[0m ${msg}\n`); }

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (e) {
    fail(`${name}: ${e.message}`);
    if (process.env.DEBUG) console.error(e);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Connect a fake agent over WebSocket, handshake, send scan result, resolve when ready
function connectAgent(actorId, secret, workdirs = []) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'agent_connect', actor_id: actorId, secret }));
    });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'auth_error') { ws.close(); reject(new Error('auth_error: ' + msg.error)); return; }
      if (msg.type === 'agent_ready') {
        ws.send(JSON.stringify({
          type: 'agent_scan_result',
          workdirs: workdirs.map(w => ({ path: w, label: path.basename(w), skills: [] })),
          global_skills: [],
        }));
        resolve(ws);
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('agent connect timeout')), 5000);
  });
}

// ── test suite ────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n\x1b[1mStoa integration tests\x1b[0m\n');

  // ── 0. Prerequisites ──────────────────────────────────────────────────────
  console.log('0 · server health');

  await test('server responds on :3001', async () => {
    const { status } = await req('GET', '/');
    assert.strictEqual(status, 200);
  });

  db = new Database(DB_PATH, { readonly: false });

  // ── 0b. Auth setup (create test session directly in DB) ────────────────
  console.log('\n0b · auth setup');

  const TEST_EMAIL = 'test-stoa@test.com';
  const TEST_PASSWORD = 'test-pass-123';

  await test('create test auth user and session', async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(TEST_PASSWORD, salt, 64).toString('hex');
    const passwordHash = `${salt}:${hash}`;
    db.prepare('INSERT OR IGNORE INTO auth_users (email, password_hash) VALUES (?,?)').run(TEST_EMAIL, passwordHash);
    const user = db.prepare('SELECT id FROM auth_users WHERE email=?').get(TEST_EMAIL);
    assert.ok(user, 'test user must exist');
    created.authUserId = user.id;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600_000).toISOString();
    db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, user.id, expires);
    SESSION_COOKIE = `stoa_session=${token}`;
  });

  // ── 0c. Auth endpoint tests ───────────────────────────────────────────────
  console.log('\n0c · auth endpoints');

  await test('POST /api/auth/login with valid creds returns 200 + cookie', async () => {
    const { status, headers } = await req('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
    assert.strictEqual(status, 200);
    assert.ok(headers['set-cookie'], 'expected Set-Cookie header');
  });

  await test('POST /api/auth/login with wrong password returns 401', async () => {
    const { status } = await req('POST', '/api/auth/login', { email: TEST_EMAIL, password: 'wrong' });
    assert.strictEqual(status, 401);
  });

  await test('GET /api/auth/me returns user info', async () => {
    const { status, body } = await req('GET', '/api/auth/me');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.email, TEST_EMAIL);
  });

  await test('PATCH /api/auth/email updates email', async () => {
    const newEmail = 'test-stoa-updated@test.com';
    const { status, body } = await req('PATCH', '/api/auth/email', { email: newEmail });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.email, newEmail);
    // Revert
    await req('PATCH', '/api/auth/email', { email: TEST_EMAIL });
  });

  await test('PATCH /api/auth/email with invalid email returns 400', async () => {
    const { status } = await req('PATCH', '/api/auth/email', { email: 'not-an-email' });
    assert.strictEqual(status, 400);
  });

  await test('PATCH /api/auth/password with correct current password works', async () => {
    const { status } = await req('PATCH', '/api/auth/password', { current_password: TEST_PASSWORD, new_password: 'new-pass-456' });
    assert.strictEqual(status, 200);
    // Change back
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(TEST_PASSWORD, salt, 64).toString('hex');
    db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(`${salt}:${hash}`, created.authUserId);
  });

  await test('PATCH /api/auth/password with wrong current returns 401', async () => {
    const { status } = await req('PATCH', '/api/auth/password', { current_password: 'wrong', new_password: 'new-pass' });
    assert.strictEqual(status, 401);
  });

  await test('PATCH /api/auth/password with short new password returns 400', async () => {
    const { status } = await req('PATCH', '/api/auth/password', { current_password: TEST_PASSWORD, new_password: '12345' });
    assert.strictEqual(status, 400);
  });

  await test('POST /api/auth/logout returns 200 + clears cookie', async () => {
    // Use a separate session for logout test
    const logoutToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600_000).toISOString();
    db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?,?,?)').run(logoutToken, created.authUserId, expires);
    const { status } = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1', port: 3001, path: '/api/auth/logout', method: 'POST',
        headers: { 'Cookie': `stoa_session=${logoutToken}` },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject);
      r.end();
    });
    assert.strictEqual(status, 200);
    const deleted = db.prepare('SELECT id FROM auth_sessions WHERE token=?').get(logoutToken);
    assert.ok(!deleted, 'session should be deleted after logout');
  });

  // ── 1. Setup ──────────────────────────────────────────────────────────────
  console.log('\n1 · first-run setup');

  let humanId;

  await test('GET /api/setup/status returns shape', async () => {
    const { status, body } = await req('GET', '/api/setup/status');
    assert.strictEqual(status, 200);
    assert.ok('needsSetup' in body);
  });

  // If setup already done (e.g. human actor exists) keep it; else create one
  await test('setup or reuse human actor', async () => {
    const { body: status } = await req('GET', '/api/setup/status');
    if (status.needsSetup) {
      const { status: s, body } = await req('POST', '/api/setup', { name: 'Test Human' });
      assert.strictEqual(s, 200);
      assert.ok(body.ok);
      const { body: actors } = await req('GET', '/api/actors');
      const human = actors.find(a => a.type === 'human');
      humanId = human.id;
      created.actors.push(humanId);
    } else {
      const { body: actors } = await req('GET', '/api/actors');
      const human = actors.find(a => a.type === 'human');
      assert.ok(human, 'human actor must exist');
      humanId = human.id;
      // don't add to created – we didn't create it
    }
    assert.ok(humanId > 0);
  });

  // ── 2. Register agents ────────────────────────────────────────────────────
  console.log('\n2 · agent registration');

  let idrisId, idrisSecret, kiraId, kiraSecret;

  await test('register Idris via install token flow', async () => {
    const r = await registerAgent('Idris-test');
    assert.ok(r.actor_id);
    assert.ok(r.secret);
    idrisId     = r.actor_id;
    idrisSecret = r.secret;
    created.actors.push(idrisId);
  });

  await test('register Kira via install token flow', async () => {
    const r = await registerAgent('Kira-test');
    assert.ok(r.actor_id);
    kiraId     = r.actor_id;
    kiraSecret = r.secret;
    created.actors.push(kiraId);
  });

  await test('GET /api/actors includes both agents', async () => {
    const { body: actors } = await req('GET', '/api/actors');
    const names = actors.map(a => a.name);
    assert.ok(names.includes('Idris-test'), 'Idris-test not in actors');
    assert.ok(names.includes('Kira-test'),  'Kira-test not in actors');
  });

  // ── 3. Agent WebSocket connect + scan ──────────────────────────────────────
  console.log('\n3 · agent WS connection & workdir scan');

  const IDRIS_WORKDIRS = ['/tmp/stoa-test-proj-a', '/tmp/stoa-test-proj-b'];
  let idrisWs, kiraWs;

  await test('Idris connects and sends scan result', async () => {
    idrisWs = await connectAgent(idrisId, idrisSecret, IDRIS_WORKDIRS);
    assert.ok(idrisWs.readyState === WebSocket.OPEN);
    await sleep(300); // let server persist workdirs
  });

  await test('Kira connects (no workdirs)', async () => {
    kiraWs = await connectAgent(kiraId, kiraSecret, []);
    assert.ok(kiraWs.readyState === WebSocket.OPEN);
  });

  await test('wrong secret rejected with auth_error', async () => {
    let got = false;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_connect', actor_id: idrisId, secret: 'wrong' })));
      ws.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'auth_error') { got = true; ws.close(); resolve(); }
      });
      ws.on('error', reject);
      setTimeout(resolve, 3000);
    });
    assert.ok(got, 'expected auth_error for wrong secret');
  });

  // ── 4. Workdirs ────────────────────────────────────────────────────────────
  console.log('\n4 · workdirs');

  await test('GET /api/actors/:id/workdirs returns scanned dirs', async () => {
    const { body } = await req('GET', `/api/actors/${idrisId}/workdirs`);
    assert.ok(Array.isArray(body));
    const paths = body.map(w => w.path);
    for (const wd of IDRIS_WORKDIRS) {
      assert.ok(paths.includes(wd), `missing workdir ${wd}`);
    }
    created.workdirs.push(...body.map(w => w.id));
  });

  let newWorkdirId;
  await test('POST /api/actors/:id/workdirs adds new workdir', async () => {
    const { status, body } = await req('POST', `/api/actors/${idrisId}/workdirs`, {
      path: '/tmp/stoa-test-new-wd',
      label: 'new-wd',
    });
    assert.strictEqual(status, 200);
    assert.ok(body.id);
    newWorkdirId = body.id;
    created.workdirs.push(newWorkdirId);
  });

  await test('new workdir appears in list', async () => {
    const { body } = await req('GET', `/api/actors/${idrisId}/workdirs`);
    const ids = body.map(w => w.id);
    assert.ok(ids.includes(newWorkdirId));
  });

  // ── 6. Room creation ───────────────────────────────────────────────────────
  console.log('\n6 · room creation');

  let roomId, firstWorkdirId;

  // Get a workdir_id for room creation (required)
  await test('get workdir for room creation', async () => {
    const { body } = await req('GET', `/api/actors/${idrisId}/workdirs`);
    assert.ok(body.length > 0, 'need at least one workdir');
    firstWorkdirId = body[0].id;
  });

  await test('POST /api/rooms without workdir_id returns 400', async () => {
    const { status } = await req('POST', '/api/rooms', {
      title: 'Test Room — no wd',
      participant_ids: [humanId, idrisId],
    });
    assert.strictEqual(status, 400);
  });

  await test('POST /api/rooms creates room with participants', async () => {
    const { status, body } = await req('POST', '/api/rooms', {
      title:           'Test Room — flow',
      participant_ids: [humanId, idrisId, kiraId],
      workdir_id:      firstWorkdirId,
    });
    assert.strictEqual(status, 200);
    assert.ok(body.id, `expected body.id, got: ${JSON.stringify(body)}`);
    roomId = body.id;
    created.rooms.push(roomId);
  });

  await test('GET /api/rooms lists new room', async () => {
    const { body } = await req('GET', '/api/rooms');
    const titles = body.map(r => r.title);
    assert.ok(titles.includes('Test Room — flow'));
  });

  await test('GET /api/rooms/:id returns single room with expected shape', async () => {
    const { status, body } = await req('GET', `/api/rooms/${roomId}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.id, roomId);
    assert.ok(body.title, 'expected title field');
    assert.ok('created_at' in body, 'expected created_at field');
    assert.ok('workdir_id' in body, 'expected workdir_id field');
  });

  await test('GET /api/rooms/999999 returns 404', async () => {
    const { status } = await req('GET', '/api/rooms/999999');
    assert.strictEqual(status, 404);
  });

  await test('GET /api/rooms?archived=1 returns only archived rooms', async () => {
    // Archive the test room
    await req('PATCH', `/api/rooms/${roomId}`, { archived: true });
    const { status, body } = await req('GET', '/api/rooms?archived=1');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
    const found = body.find(r => r.id === roomId);
    assert.ok(found, 'archived room should appear in archived list');
    assert.ok(found.archived_at, 'archived room should have archived_at set');
    // Verify it does NOT appear in non-archived list
    const { body: activeRooms } = await req('GET', '/api/rooms');
    const inActive = activeRooms.find(r => r.id === roomId);
    assert.ok(!inActive, 'archived room should NOT appear in default (non-archived) list');
    // Restore the room
    await req('PATCH', `/api/rooms/${roomId}`, { archived: false });
  });

  await test('GET /api/rooms/:id/participants returns 3 participants', async () => {
    const { body } = await req('GET', `/api/rooms/${roomId}/participants`);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 3);
  });

  // ── 7. Change workdir for room ─────────────────────────────────────────────
  console.log('\n7 · change working directory');

  await test('POST /api/rooms creates room with workdir_id', async () => {
    const { body: scannedWds } = await req('GET', `/api/actors/${idrisId}/workdirs`);
    const wd = scannedWds.find(w => w.path === IDRIS_WORKDIRS[0]);
    assert.ok(wd, `workdir ${IDRIS_WORKDIRS[0]} not found in list`);
    const { status, body } = await req('POST', '/api/rooms', {
      title:           'Test Room — wd',
      participant_ids: [humanId, idrisId],
      workdir_id:      wd.id,
    });
    assert.strictEqual(status, 200);
    created.rooms.push(body.id);
    const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(body.id);
    assert.strictEqual(roomRow.workdir_id, wd.id);
  });

  // ── 8. Messages ────────────────────────────────────────────────────────────
  console.log('\n8 · message persistence');

  await test('GET /api/rooms/:id/messages returns empty array initially', async () => {
    const { body } = await req('GET', `/api/rooms/${roomId}/messages`);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 0);
  });

  // ── 8b. Room rename ───────────────────────────────────────────────────────
  console.log('\n8b · room rename');

  await test('PATCH /api/rooms/:id renames room', async () => {
    const { status } = await req('PATCH', `/api/rooms/${roomId}`, { title: 'Test Room — renamed' });
    assert.strictEqual(status, 200);
    const { body: rooms } = await req('GET', '/api/rooms');
    const found = rooms.find(r => r.id === roomId);
    assert.strictEqual(found.title, 'Test Room — renamed');
  });

  // ── 8c. Install scripts ──────────────────────────────────────────────────
  console.log('\n8c · install scripts');

  await test('GET /install.sh returns 200 with REG_TOKEN', async () => {
    const { status, body } = await reqRaw('GET', '/install.sh?name=test-install');
    assert.strictEqual(status, 200);
    assert.ok(body.includes('REG_TOKEN='), 'missing REG_TOKEN in install.sh');
  });

  await test('GET /install.ps1 returns 200 with valid $RegToken', async () => {
    const { status, body } = await reqRaw('GET', '/install.ps1?name=test-install-ps');
    assert.strictEqual(status, 200);
    const m = body.match(/\$RegToken\s*=\s*"([0-9a-f]+)"/);
    assert.ok(m, 'missing $RegToken assignment in install.ps1');
    assert.ok(m[1].length > 0, '$RegToken must be non-empty hex');
    assert.ok(/^[0-9a-f]+$/.test(m[1]), `$RegToken must be hex, got: ${m[1]}`);
  });

  await test('GET /install.cmd returns 200 with ps1 URL and params', async () => {
    const { status, body } = await reqRaw('GET', '/install.cmd?name=test-install-cmd');
    assert.strictEqual(status, 200);
    assert.ok(body.includes('/install.ps1'), 'install.cmd must reference /install.ps1 URL');
    assert.ok(body.includes('name=test-install-cmd'), 'install.cmd must pass name param to ps1 URL');
  });

  // ── 8d. Client manifest ──────────────────────────────────────────────────
  console.log('\n8d · client manifest');

  await test('GET /api/client/manifest returns files object', async () => {
    const { status, body } = await req('GET', '/api/client/manifest');
    assert.strictEqual(status, 200);
    assert.ok(body.files && typeof body.files === 'object');
  });

  // ── 8e. Message pagination ───────────────────────────────────────────────
  console.log('\n8e · message pagination');

  await test('GET /api/rooms/:id/messages?before=999999 returns array', async () => {
    const { status, body } = await req('GET', `/api/rooms/${roomId}/messages?before=999999&limit=10`);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  await test('before= pagination returns only earlier messages', async () => {
    // Get participant_id for human in test room
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    assert.ok(humanPart, 'human participant must exist in test room');

    // Insert 3 test messages
    const msgIds = [];
    for (let i = 1; i <= 3; i++) {
      const r = db.prepare(
        "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)"
      ).run(roomId, humanPart.id, `pagination-test-msg-${i}`, 'complete');
      msgIds.push(Number(r.lastInsertRowid));
    }

    // Fetch with before= the last message ID — should return only earlier messages
    const { status, body } = await req('GET', `/api/rooms/${roomId}/messages?before=${msgIds[2]}&limit=50`);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));

    const returnedIds = body.map(m => m.id);
    // The first two messages should be in the result
    assert.ok(returnedIds.includes(msgIds[0]), `msg ${msgIds[0]} should be in before= result`);
    assert.ok(returnedIds.includes(msgIds[1]), `msg ${msgIds[1]} should be in before= result`);
    // The last message (the before= target) must NOT be in the result
    assert.ok(!returnedIds.includes(msgIds[2]), `msg ${msgIds[2]} (before target) must NOT be in result`);

    // Cleanup: remove test messages
    for (const id of msgIds) {
      db.prepare('DELETE FROM messages WHERE id=?').run(id);
    }
  });

  // ── 8f. Settings ─────────────────────────────────────────────────────────
  console.log('\n8f · settings');

  await test('GET /api/settings returns object', async () => {
    const { status, body } = await req('GET', '/api/settings');
    assert.strictEqual(status, 200);
    assert.ok(typeof body === 'object');
  });

  // ── 8g. Invalid JSON returns 400 not 500 ─────────────────────────────────
  console.log('\n8g · error handling');

  await test('POST with invalid JSON returns 400', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = http.request({ hostname: '127.0.0.1', port: 3001, path: '/api/rooms', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 5, 'Cookie': SESSION_COOKIE } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject);
      r.write('{bad}');
      r.end();
    });
    assert.strictEqual(status, 400);
  });

  // ── 8h. Client file download ───────────────────────────────────────────────
  console.log('\n8h · client file download');

  await test('GET /api/client/file/stoa.js returns 200', async () => {
    const { status } = await reqRaw('GET', '/api/client/file/stoa.js');
    assert.strictEqual(status, 200);
  });

  await test('GET /api/client/file/nonexistent returns 404', async () => {
    const { status } = await reqRaw('GET', '/api/client/file/nonexistent.xyz');
    assert.strictEqual(status, 404);
  });

  // ── 8i. Docs listing ──────────────────────────────────────────────────────
  console.log('\n8i · docs listing');

  await test('GET /api/docs returns array', async () => {
    const { status, body } = await req('GET', '/api/docs');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  // ── 8j. Messages with since param ─────────────────────────────────────────
  console.log('\n8j · messages since');

  await test('GET /api/rooms/:id/messages?since=0 returns array', async () => {
    const { status, body } = await req('GET', `/api/rooms/${roomId}/messages?since=0`);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  // ── 8k. Agent commands via REST ───────────────────────────────────────────
  console.log('\n8k · agent commands');

  await test('POST /api/actors/:id/rescan sends rescan to connected agent', async () => {
    const { status } = await req('POST', `/api/actors/${idrisId}/rescan`);
    assert.strictEqual(status, 200);
  });

  await test('POST /api/actors/:id/force-update sends update to agent', async () => {
    const { status } = await req('POST', `/api/actors/${idrisId}/force-update`);
    assert.strictEqual(status, 200);
  });

  // ── 8l. File upload (base64) ──────────────────────────────────────────────
  console.log('\n8l · file upload');

  await test('POST /api/upload/raw (text) returns file URL', async () => {
    const { status, body } = await new Promise((resolve, reject) => {
      const buf = Buffer.from('hello upload test');
      const r = http.request({
        hostname: '127.0.0.1', port: 3001,
        path: '/api/upload/raw', method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': buf.length,
          'X-File-Name': encodeURIComponent('test-upload.txt'),
          'Cookie': SESSION_COOKIE,
        },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let json; try { json = JSON.parse(raw); } catch { json = raw; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      r.on('error', reject);
      r.write(buf);
      r.end();
    });
    assert.strictEqual(status, 200);
    assert.ok(body.url, 'expected url in response');
  });

  // ── 8m. Invite resolve ────────────────────────────────────────────────────
  console.log('\n8m · invite resolve');

  await test('POST /api/invites/:id/resolve works', async () => {
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    const invite = db.prepare(
      'INSERT INTO invite_suggestions (room_id, suggested_by_participant_id, suggested_actor_id, reason) VALUES (?,?,?,?)'
    ).run(roomId, humanPart.id, kiraId, 'test invite');
    const inviteId = invite.lastInsertRowid;
    const { status, body } = await req('POST', `/api/invites/${inviteId}/resolve`, { approved: true });
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
  });

  // ── 8n. Raw binary upload ───────────────────────────────────────────────
  console.log('\n8n · raw upload');

  await test('POST /api/upload/raw returns file URL', async () => {
    const { status, body } = await new Promise((resolve, reject) => {
      const buf = Buffer.from('binary test data');
      const r = http.request({
        hostname: '127.0.0.1', port: 3001,
        path: '/api/upload/raw', method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buf.length,
          'X-File-Name': encodeURIComponent('test-raw.bin'),
          'Cookie': SESSION_COOKIE,
        },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let json; try { json = JSON.parse(raw); } catch { json = raw; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      r.on('error', reject);
      r.write(buf);
      r.end();
    });
    assert.strictEqual(status, 200);
    assert.ok(body.url, 'expected url in response');
    assert.ok(body.name === 'test-raw.bin');
  });

  // ── 8o. Avatar upload & delete ────────────────────────────────────────────
  console.log('\n8o · avatar');

  await test('POST /api/actors/:id/avatar uploads avatar', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB';
    const { status, body } = await req('POST', `/api/actors/${idrisId}/avatar`, { data_url: dataUrl });
    assert.strictEqual(status, 200);
    assert.ok(body.avatar_url, 'expected avatar_url in response');
  });

  await test('DELETE /api/actors/:id/avatar removes avatar', async () => {
    const { status } = await req('DELETE', `/api/actors/${idrisId}/avatar`);
    assert.strictEqual(status, 200);
  });

  // ── 8p. PATCH settings ────────────────────────────────────────────────────
  console.log('\n8p · settings update');

  await test('PATCH /api/settings updates human_name', async () => {
    const { body: before } = await req('GET', '/api/settings');
    const origName = before.human_name;
    const { status, body } = await req('PATCH', '/api/settings', { human_name: 'Test Human Updated' });
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    const { body: after } = await req('GET', '/api/settings');
    assert.strictEqual(after.human_name, 'Test Human Updated');
    await req('PATCH', '/api/settings', { human_name: origName });
  });

  await test('PATCH /api/settings updates max_concurrent', async () => {
    const { body: before } = await req('GET', '/api/settings');
    const orig = before.max_concurrent;
    const { status, body } = await req('PATCH', '/api/settings', { max_concurrent: 5 });
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    const { body: after } = await req('GET', '/api/settings');
    assert.strictEqual(after.max_concurrent, 5);
    await req('PATCH', '/api/settings', { max_concurrent: orig });
  });

  await test('PATCH /api/settings rejects invalid max_concurrent', async () => {
    await req('PATCH', '/api/settings', { max_concurrent: 0 });
    const { body } = await req('GET', '/api/settings');
    assert.notStrictEqual(body.max_concurrent, 0);
    await req('PATCH', '/api/settings', { max_concurrent: 99 });
    const { body: b2 } = await req('GET', '/api/settings');
    assert.notStrictEqual(b2.max_concurrent, 99);
  });

  // ── 8q. Doc content ───────────────────────────────────────────────────────
  console.log('\n8q · doc content');

  await test('GET /api/docs/:filename returns md content or 404', async () => {
    const { body: docs } = await req('GET', '/api/docs');
    if (docs.length > 0) {
      const { status } = await reqRaw('GET', `/api/docs/${docs[0].slug}.en.md`);
      assert.strictEqual(status, 200);
    } else {
      const { status } = await reqRaw('GET', '/api/docs/nonexistent.md');
      assert.strictEqual(status, 404);
    }
  });

  // ── 9. Rename actor ────────────────────────────────────────────────────────
  console.log('\n9 · actor rename');

  await test('PATCH /api/actors/:id renames agent', async () => {
    const { status } = await req('PATCH', `/api/actors/${idrisId}`, { name: 'Idris-test-renamed' });
    assert.strictEqual(status, 200);
    const { body: actors } = await req('GET', '/api/actors');
    const found = actors.find(a => a.id === idrisId);
    assert.strictEqual(found.name, 'Idris-test-renamed');
  });

  // ── 9b. Search ──────────────────────────────────────────────────────────────
  console.log('\n9b · search');

  await test('GET /api/search with empty q returns empty array', async () => {
    const { status, body } = await req('GET', '/api/search?q=&limit=10');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 0);
  });

  await test('GET /api/search with query returns array', async () => {
    const { status, body } = await req('GET', '/api/search?q=test&limit=5');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  await test('GET /api/search?room_id=X scopes results to that room', async () => {
    // Insert a searchable message in the test room
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    assert.ok(humanPart, 'human participant must exist in test room');
    const uniqueWord = 'xyzzyplugh' + Date.now();
    const r = db.prepare(
      "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)"
    ).run(roomId, humanPart.id, `room-scoped search test ${uniqueWord}`, 'complete');
    const testMsgId = Number(r.lastInsertRowid);

    // Search with room_id scope — should find the message
    const { status, body } = await req('GET', `/api/search?q=${uniqueWord}&room_id=${roomId}&limit=10`);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0, 'should find at least one result in scoped search');
    assert.ok(body.every(m => m.room_id === roomId), 'all results should belong to the scoped room');

    // Search with a different room_id scope — should NOT find it
    const otherRooms = created.rooms.filter(id => id !== roomId);
    if (otherRooms.length > 0) {
      const { body: otherBody } = await req('GET', `/api/search?q=${uniqueWord}&room_id=${otherRooms[0]}&limit=10`);
      assert.strictEqual(otherBody.length, 0, 'should not find message in a different room scope');
    }

    // Cleanup
    db.prepare("INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?, ?)").run(testMsgId, `room-scoped search test ${uniqueWord}`);
    db.prepare('DELETE FROM messages WHERE id=?').run(testMsgId);
  });

  // ── 9c. Add participant to room ───────────────────────────────────────────
  console.log('\n9c · add participant');

  await test('POST /api/rooms/:id/participants adds actor to room', async () => {
    // Create a new room with only human
    const { body: newRoom } = await req('POST', '/api/rooms', { title: 'Test Room — add-part', participant_ids: [humanId], workdir_id: firstWorkdirId });
    created.rooms.push(newRoom.id);
    const { status } = await req('POST', `/api/rooms/${newRoom.id}/participants`, { actor_id: kiraId });
    assert.strictEqual(status, 200);
    const { body: parts } = await req('GET', `/api/rooms/${newRoom.id}/participants`);
    assert.ok(parts.some(p => p.actor_id === kiraId));
  });

  await test('POST /api/rooms/:id/participants without actor_id returns 400', async () => {
    const { status } = await req('POST', `/api/rooms/${roomId}/participants`, {});
    assert.strictEqual(status, 400);
  });

  // ── 9d. Room skills ────────────────────────────────────────────────────────
  console.log('\n9d · room skills');

  await test('GET /api/rooms/:id/skills returns array', async () => {
    const { status, body } = await req('GET', `/api/rooms/${roomId}/skills`);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  await test('GET /api/rooms/999999/skills returns 404', async () => {
    const { status } = await req('GET', '/api/rooms/999999/skills');
    assert.strictEqual(status, 404);
  });

  // ── 9e. Room export ───────────────────────────────────────────────────────
  console.log('\n9e · room export');

  await test('GET /api/rooms/:id/export returns JSON export', async () => {
    const { status, body } = await req('GET', `/api/rooms/${roomId}/export`);
    assert.strictEqual(status, 200);
    assert.ok(body.room, 'expected room in export');
    assert.ok(Array.isArray(body.messages), 'expected messages array');
  });

  await test('GET /api/rooms/:id/export?format=csv returns CSV', async () => {
    const { status, body } = await reqRaw('GET', `/api/rooms/${roomId}/export?format=csv`);
    assert.strictEqual(status, 200);
    assert.ok(body.startsWith('id,'), 'expected CSV header');
  });

  await test('GET /api/rooms/999999/export returns 404', async () => {
    const { status } = await reqRaw('GET', '/api/rooms/999999/export');
    assert.strictEqual(status, 404);
  });

  // ── 9f. Room delete via REST ──────────────────────────────────────────────
  console.log('\n9f · room delete');

  await test('DELETE /api/rooms/:id deletes room', async () => {
    const { body: tmpRoom } = await req('POST', '/api/rooms', { title: 'Test Room — delete-test', participant_ids: [humanId], workdir_id: firstWorkdirId });
    assert.ok(tmpRoom.id);
    const { status } = await req('DELETE', `/api/rooms/${tmpRoom.id}`);
    assert.strictEqual(status, 204);
    const check = db.prepare('SELECT id FROM rooms WHERE id=?').get(tmpRoom.id);
    assert.ok(!check, 'room should be deleted');
  });

  // ── 9g. Upload retrieval & path traversal ─────────────────────────────────
  console.log('\n9g · upload retrieval');

  let uploadedUrl;
  await test('POST /api/upload/raw then GET /uploads/:path returns file content', async () => {
    const content = 'retrieve-me-test-content-' + Date.now();
    const buf = Buffer.from(content);
    const { status, body } = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1', port: 3001,
        path: '/api/upload/raw', method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': buf.length,
          'X-File-Name': encodeURIComponent('retrieve-test.txt'),
          'Cookie': SESSION_COOKIE,
        },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let json; try { json = JSON.parse(raw); } catch { json = raw; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      r.on('error', reject);
      r.write(buf);
      r.end();
    });
    assert.strictEqual(status, 200);
    uploadedUrl = body.url;
    const { status: getStatus, body: getBody } = await reqRaw('GET', uploadedUrl);
    assert.strictEqual(getStatus, 200);
    assert.strictEqual(getBody, content);
  });

  await test('GET /uploads/../../server.js path traversal returns 404', async () => {
    const { status } = await reqRaw('GET', '/uploads/../../server.js');
    assert.ok(status === 403 || status === 404, `expected 403 or 404, got ${status}`);
  });

  await test('GET /uploads/../../../etc/passwd path traversal returns 404', async () => {
    const { status } = await reqRaw('GET', '/uploads/../../../etc/passwd');
    assert.ok(status === 403 || status === 404, `expected 403 or 404, got ${status}`);
  });

  // ── 9h. Unauthenticated access rejection ─────────────────────────────────
  console.log('\n9h · unauthenticated access');

  await test('GET /api/actors without cookie returns 401', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1', port: 3001, path: '/api/actors', method: 'GET',
        headers: {},
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject);
      r.end();
    });
    assert.strictEqual(status, 401);
  });

  await test('GET /api/rooms without cookie returns 401', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1', port: 3001, path: '/api/rooms', method: 'GET',
        headers: {},
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject);
      r.end();
    });
    assert.strictEqual(status, 401);
  });

  await test('GET /api/settings without cookie returns 401', async () => {
    const { status } = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1', port: 3001, path: '/api/settings', method: 'GET',
        headers: {},
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject);
      r.end();
    });
    assert.strictEqual(status, 401);
  });

  // ── 9i. Agent register with invalid token ─────────────────────────────────
  console.log('\n9i · agent register invalid token');

  await test('POST /api/agent/register with bogus token returns 401', async () => {
    const { status, body } = await req('POST', '/api/agent/register', { token: 'bogus' });
    assert.strictEqual(status, 401);
    assert.ok(body.error, 'expected error field in response');
  });

  // ── 9j. Rescan & force-update when agent offline ─────────────────────────
  console.log('\n9j · agent commands when offline');

  // Disconnect agents first so they are offline for these tests
  if (idrisWs) { idrisWs.close(); idrisWs = null; }
  if (kiraWs)  { kiraWs.close();  kiraWs = null; }
  await sleep(300); // let server notice disconnects

  await test('POST /api/actors/:id/rescan when agent offline returns 503', async () => {
    const { status } = await req('POST', `/api/actors/${idrisId}/rescan`);
    assert.strictEqual(status, 503);
  });

  await test('POST /api/actors/:id/force-update when agent offline returns 503', async () => {
    const { status } = await req('POST', `/api/actors/${idrisId}/force-update`);
    assert.strictEqual(status, 503);
  });

  // ── 9k. DELETE & GET single message ─────────────────────────────────────
  console.log('\n9k · single message operations');

  // Reconnect agents for remaining tests
  idrisWs = await connectAgent(idrisId, idrisSecret, IDRIS_WORKDIRS);
  kiraWs = await connectAgent(kiraId, kiraSecret, []);
  await sleep(300);

  await test('GET /api/messages/:id returns message with actor info', async () => {
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    const r = db.prepare(
      "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)"
    ).run(roomId, humanPart.id, 'test-get-single-msg', 'complete');
    const msgId = Number(r.lastInsertRowid);
    const { status, body } = await req('GET', `/api/messages/${msgId}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.id, msgId);
    assert.ok(body.actor_name, 'expected actor_name in response');
    assert.ok(body.content === 'test-get-single-msg');
    db.prepare('DELETE FROM messages WHERE id=?').run(msgId);
  });

  await test('GET /api/messages/999999 returns 404', async () => {
    const { status } = await req('GET', '/api/messages/999999');
    assert.strictEqual(status, 404);
  });

  await test('DELETE /api/messages/:id deletes message', async () => {
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    const r = db.prepare(
      "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)"
    ).run(roomId, humanPart.id, 'test-delete-msg', 'complete');
    const msgId = Number(r.lastInsertRowid);
    const { status } = await req('DELETE', `/api/messages/${msgId}`);
    assert.strictEqual(status, 204);
    const check = db.prepare('SELECT id FROM messages WHERE id=?').get(msgId);
    assert.ok(!check, 'message should be deleted');
  });

  await test('DELETE /api/messages/999999 returns 404', async () => {
    const { status } = await req('DELETE', '/api/messages/999999');
    assert.strictEqual(status, 404);
  });

  // ── 9l. PATCH actor lang ──────────────────────────────────────────────────
  console.log('\n9l · actor lang config');

  await test('PATCH /api/actors/:id with lang updates adapter_config', async () => {
    const { status } = await req('PATCH', `/api/actors/${idrisId}`, { name: 'Idris-test-renamed', lang: 'id' });
    assert.strictEqual(status, 200);
    const actor = db.prepare('SELECT adapter_config FROM actors WHERE id=?').get(idrisId);
    const cfg = JSON.parse(actor.adapter_config || '{}');
    assert.strictEqual(cfg.lang, 'id');
  });

  // ── 9m. PATCH settings extras ─────────────────────────────────────────────
  console.log('\n9m · settings extras');

  await test('PATCH /api/settings updates public_url', async () => {
    const { body: before } = await req('GET', '/api/settings');
    const orig = before.public_url || '';
    const { status } = await req('PATCH', '/api/settings', { public_url: 'http://test.local' });
    assert.strictEqual(status, 200);
    const { body: after } = await req('GET', '/api/settings');
    assert.strictEqual(after.public_url, 'http://test.local');
    await req('PATCH', '/api/settings', { public_url: orig });
  });

  await test('PATCH /api/settings updates cleanup_max_age_hours', async () => {
    const { body: before } = await req('GET', '/api/settings');
    const orig = before.cleanup_max_age_hours;
    const { status } = await req('PATCH', '/api/settings', { cleanup_max_age_hours: 48 });
    assert.strictEqual(status, 200);
    const { body: after } = await req('GET', '/api/settings');
    assert.strictEqual(after.cleanup_max_age_hours, 48);
    await req('PATCH', '/api/settings', { cleanup_max_age_hours: orig || 24 });
  });

  // ── 9n. Invite reject ─────────────────────────────────────────────────────
  console.log('\n9n · invite reject');

  await test('POST /api/invites/:id/resolve with approved=false rejects invite', async () => {
    const humanPart = db.prepare(
      "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
    ).get(roomId);
    const invite = db.prepare(
      'INSERT INTO invite_suggestions (room_id, suggested_by_participant_id, suggested_actor_id, reason) VALUES (?,?,?,?)'
    ).run(roomId, humanPart.id, kiraId, 'test reject invite');
    const inviteId = invite.lastInsertRowid;
    const { status, body } = await req('POST', `/api/invites/${inviteId}/resolve`, { approved: false });
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    const row = db.prepare('SELECT status FROM invite_suggestions WHERE id=?').get(inviteId);
    assert.strictEqual(row.status, 'rejected');
    db.prepare('DELETE FROM invite_suggestions WHERE id=?').run(inviteId);
  });

  // ── 10. Cleanup ────────────────────────────────────────────────────────────
  console.log('\n10 · cleanup');

  if (idrisWs) idrisWs.close();
  if (kiraWs)  kiraWs.close();
  await sleep(200);

  // Delete rooms directly from DB (no REST delete endpoint)
  await test('delete test rooms from DB', async () => {
    // Also catch any orphans by title in case IDs were never tracked (e.g. earlier failed run)
    const orphans = db.prepare("SELECT id FROM rooms WHERE title LIKE 'Test Room%'").all().map(r => r.id);
    const allRoomIds = [...new Set([...created.rooms.filter(Boolean), ...orphans])];
    for (const id of allRoomIds) {
      db.prepare('DELETE FROM invite_suggestions WHERE room_id=?').run(id);
      db.prepare('DELETE FROM messages WHERE room_id=?').run(id);
      db.prepare('DELETE FROM room_participants WHERE room_id=?').run(id);
      db.prepare('DELETE FROM rooms WHERE id=?').run(id);
    }
    const remaining = db.prepare("SELECT id FROM rooms WHERE title LIKE 'Test Room%'").all();
    assert.strictEqual(remaining.length, 0, `orphan test rooms remain: ${remaining.map(r=>r.id)}`);
  });

  // Delete test actors via REST
  for (const id of created.actors) {
    await test(`DELETE /api/actors/${id}`, async () => {
      const { status } = await req('DELETE', `/api/actors/${id}`);
      assert.ok(status === 200 || status === 204);
    });
  }

  await test('no test actors remain', async () => {
    const { body: actors } = await req('GET', '/api/actors');
    const testActors = actors.filter(a => created.actors.includes(a.id));
    assert.strictEqual(testActors.length, 0);
  });

  // Clean up test auth user
  await test('cleanup test auth user', async () => {
    if (created.authUserId) {
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(created.authUserId);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(created.authUserId);
    }
    const remaining = db.prepare('SELECT id FROM auth_users WHERE email=?').get(TEST_EMAIL);
    assert.ok(!remaining, 'test auth user should be cleaned up');
  });

  db.close();
  console.log('\n\x1b[1mDone.\x1b[0m\n');
}

run().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
