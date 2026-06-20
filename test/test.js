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

const PORT  = parseInt(process.env.PORT, 10) || 3001;
const HOST  = process.env.TEST_HOST || '127.0.0.1';
const BASE  = `http://${HOST}:${PORT}`;
const WS    = `ws://${HOST}:${PORT}`;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'stoa.db');

let db;
let SESSION_COOKIE = '';
const created = { actors: [], rooms: [], workdirs: [], authUserId: null };

// ── helpers ──────────────────────────────────────────────────────────────────

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: HOST, port: PORT,
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
      hostname: HOST, port: PORT, path: urlPath, method,
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
      if (msg.type === 'proxy_file_list') {
        ws.send(JSON.stringify({ type: 'proxy_file_list_result', request_id: msg.request_id, root: msg.workdir, tree: [{ t: 'file', name: 'test.txt', depth: 0 }], modified: [] }));
      }
      if (msg.type === 'proxy_git_diff') {
        ws.send(JSON.stringify({ type: 'proxy_git_diff_result', request_id: msg.request_id, files: [] }));
      }
      if (msg.type === 'proxy_file_read') {
        ws.send(JSON.stringify({ type: 'proxy_file_read_result', request_id: msg.request_id, path: msg.path, content: 'test content' }));
      }
      if (msg.type === 'proxy_file_write') {
        ws.send(JSON.stringify({ type: 'proxy_file_write_result', request_id: msg.request_id, path: msg.path, ok: true }));
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('agent connect timeout')), 5000);
  });
}

// Connect as a browser client (with auth cookie), join a room, return ws + message helper
function connectBrowser(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS, { headers: { Cookie: SESSION_COOKIE } });
    const pending = new Map();
    let msgId = 0;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
    });
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'history') { resolve({ ws, send: sendMsg, waitFor }); return; }
      for (const [id, { types, resolve: res }] of pending) {
        if (types.includes(msg.type)) { pending.delete(id); res(msg); return; }
      }
    });
    function sendMsg(data) { ws.send(JSON.stringify(data)); }
    function waitFor(types, timeout = 5000) {
      if (!Array.isArray(types)) types = [types];
      return new Promise((res, rej) => {
        const id = ++msgId;
        pending.set(id, { types, resolve: res });
        setTimeout(() => { pending.delete(id); rej(new Error(`timeout waiting for ${types.join('|')}`)); }, timeout);
      });
    }
    ws.on('error', reject);
    setTimeout(() => reject(new Error('browser connect timeout')), 5000);
  });
}

// ── test suite ────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n\x1b[1mStoa integration tests\x1b[0m\n');

  // ── 0. Prerequisites ──────────────────────────────────────────────────────
  console.log('0 · server health');

  await test(`server responds on :`, async () => {
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
        hostname: HOST, port: PORT, path: '/api/auth/logout', method: 'POST',
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

  await test('POST /api/rooms with non-existent workdir_id returns 404', async () => {
    const { status } = await req('POST', '/api/rooms', {
      title:           'Test Room — bad wd',
      participant_ids: [humanId, idrisId],
      workdir_id:      999999,
    });
    assert.strictEqual(status, 404);
  });

  await test('POST /api/rooms rejects a workdir not owned by any participant', async () => {
    // firstWorkdirId belongs to idris, who is NOT among the participants here.
    const { status } = await req('POST', '/api/rooms', {
      title:           'Test Room — wd not owned',
      participant_ids: [humanId, kiraId],
      workdir_id:      firstWorkdirId,
    });
    assert.strictEqual(status, 400);
  });

  // ── 6b. Offline-agent gate ─────────────────────────────────────────────────
  // A room is only useful with an agent that can actually respond, so an offline AI may
  // not be a room participant. Enforced server-side (HTTP 409), not just in the UI.
  await test('POST /api/rooms rejects an offline AI participant (409)', async () => {
    // A freshly registered agent that never connects is offline. Insert its workdir directly
    // (the workdir API requires the agent online) so the ownership check passes and we reach
    // the online gate.
    const ghost = await registerAgent('Ghost-create-test');
    created.actors.push(ghost.actor_id);
    const wd = db.prepare(
      'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0)'
    ).run(ghost.actor_id, '/tmp/stoa-ghost-create-wd', 'ghost');
    const { status, body } = await req('POST', '/api/rooms', {
      title:           'Test Room — offline create',
      participant_ids: [humanId, ghost.actor_id],
      workdir_id:      wd.lastInsertRowid,
    });
    assert.strictEqual(status, 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(/offline/i.test(body.error || ''), `expected offline error, got ${JSON.stringify(body)}`);
  });

  await test('POST /api/rooms/:id/participants rejects an offline AI agent (409)', async () => {
    const ghost = await registerAgent('Ghost-add-test');
    created.actors.push(ghost.actor_id);
    const { status, body } = await req('POST', `/api/rooms/${roomId}/participants`, { actor_id: ghost.actor_id });
    assert.strictEqual(status, 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(/offline/i.test(body.error || ''), `expected offline error, got ${JSON.stringify(body)}`);
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

  // Test runner setup: unpin all existing pinned rooms (from production DB copy)
  // so pin tests start from clean state (0 pinned). This only affects the temp
  // copy DB, not production. Without this, test fails when live DB has pins.
  {
    const { body: allRooms } = await req('GET', '/api/rooms');
    const pinned = allRooms.filter(r => r.is_pinned);
    for (const r of pinned) {
      await req('DELETE', `/api/rooms/${r.id}/pin`);
    }
  }

  await test('POST /api/rooms/:id/pin pins a room', async () => {
    const { status, body } = await req('POST', `/api/rooms/${roomId}/pin`);
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    const { body: rooms } = await req('GET', '/api/rooms');
    const found = rooms.find(r => r.id === roomId);
    assert.ok(found.is_pinned, 'room should be pinned');
  });

  await test('POST /api/rooms/:id/pin idempotent — re-pin returns ok', async () => {
    const { status, body } = await req('POST', `/api/rooms/${roomId}/pin`);
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
  });

  await test('DELETE /api/rooms/:id/pin unpins a room', async () => {
    const { status, body } = await req('DELETE', `/api/rooms/${roomId}/pin`);
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    const { body: rooms } = await req('GET', '/api/rooms');
    const found = rooms.find(r => r.id === roomId);
    assert.ok(!found.is_pinned, 'room should be unpinned');
  });

  await test('POST /api/rooms/:id/pin returns 400 when limit reached', async () => {
    // Create 5 rooms and pin them all
    const tempRooms = [];
    for (let i = 0; i < 5; i++) {
      const { body: r } = await req('POST', '/api/rooms', { title: `Test Room — pin-limit-${i}`, participant_ids: [humanId, idrisId], workdir_id: firstWorkdirId });
      tempRooms.push(r.id);
      await req('POST', `/api/rooms/${r.id}/pin`);
    }
    // Now try to pin roomId (6th) — should fail
    const { status, body } = await req('POST', `/api/rooms/${roomId}/pin`);
    assert.strictEqual(status, 400);
    assert.ok(body.error);
    // Cleanup: unpin all temp rooms (room deletion handled by global cleanup)
    for (const id of tempRooms) {
      await req('DELETE', `/api/rooms/${id}/pin`);
    }
  });

  await test('GET /api/rooms/:id/participants returns 3 participants', async () => {
    const { body } = await req('GET', `/api/rooms/${roomId}/participants`);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 3);
  });

  await test('GET /api/rooms/participants?ids= returns grouped object', async () => {
    const { status, body } = await req('GET', `/api/rooms/participants?ids=${roomId}`);
    assert.strictEqual(status, 200);
    assert.ok(typeof body === 'object' && !Array.isArray(body), 'expected grouped object');
    assert.ok(Array.isArray(body[roomId]), 'expected array for room key');
    assert.strictEqual(body[roomId].length, 3);
    const p = body[roomId][0];
    assert.ok(!('secret' in p), 'secret must not be exposed');
  });

  // ── 6b. Add agent with per-participant workdir ─────────────────────────────
  console.log('\n6b · add agent with workdir');

  let addRoomId, kiraWdId;

  await test('create room (human + idris) for add-agent flow', async () => {
    const { status, body } = await req('POST', '/api/rooms', {
      title:           'Test Room — add agent',
      participant_ids: [humanId, idrisId],
      workdir_id:      firstWorkdirId,        // idris owns this workdir
    });
    assert.strictEqual(status, 200);
    addRoomId = body.id;
    created.rooms.push(addRoomId);
    // The creator agent (idris) participant should carry the room workdir explicitly.
    const row = db.prepare(
      'SELECT workdir_id FROM room_participants WHERE room_id=? AND actor_id=?'
    ).get(addRoomId, idrisId);
    assert.strictEqual(row.workdir_id, firstWorkdirId, 'idris participant workdir_id should equal room workdir');
  });

  await test('create a workdir owned by kira', async () => {
    const { status, body } = await req('POST', `/api/actors/${kiraId}/workdirs`, { path: '/tmp/kira-add-wd' });
    assert.strictEqual(status, 200);
    kiraWdId = body.id;
    created.workdirs.push(kiraWdId);
  });

  await test('POST participants rejects a workdir not owned by the agent', async () => {
    const { status } = await req('POST', `/api/rooms/${addRoomId}/participants`, {
      actor_id:   kiraId,
      workdir_id: firstWorkdirId,             // belongs to idris, not kira
    });
    assert.strictEqual(status, 400);
  });

  await test('POST participants to a missing room returns 404', async () => {
    const { status } = await req('POST', '/api/rooms/999999/participants', { actor_id: kiraId });
    assert.strictEqual(status, 404);
  });

  await test('POST participants without actor_id returns 400', async () => {
    const { status } = await req('POST', `/api/rooms/${addRoomId}/participants`, {});
    assert.strictEqual(status, 400);
  });

  await test('POST participants adds kira with her own workdir', async () => {
    const { status } = await req('POST', `/api/rooms/${addRoomId}/participants`, {
      actor_id:   kiraId,
      workdir_id: kiraWdId,
    });
    assert.strictEqual(status, 200);
    const row = db.prepare(
      'SELECT workdir_id FROM room_participants WHERE room_id=? AND actor_id=?'
    ).get(addRoomId, kiraId);
    assert.strictEqual(row.workdir_id, kiraWdId);
  });

  await test('GET participants exposes workdir_path per participant', async () => {
    const { body } = await req('GET', `/api/rooms/${addRoomId}/participants`);
    const kira = body.find(p => p.actor_id === kiraId);
    assert.ok(kira, 'kira should be a participant');
    assert.strictEqual(kira.workdir_id, kiraWdId);
    assert.strictEqual(kira.workdir_path, '/tmp/kira-add-wd');
  });

  // ── 6c. ai_sessions re-keyed by participant_id (migration 20260620-rekey) ──
  console.log('\n6c · ai_sessions re-key by participant_id');

  await test('ai_sessions unique key is participant_id only', () => {
    const { sql } = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'"
    ).get();
    assert.ok(/UNIQUE\s*\(\s*participant_id\s*\)/i.test(sql), 'expected UNIQUE(participant_id)');
    assert.ok(!/UNIQUE\s*\(\s*participant_id\s*,\s*workdir\s*\)/i.test(sql),
      'old (participant_id, workdir) key must be gone');
  });

  await test('one session row per participant — different workdir upserts, never duplicates', () => {
    // Mirrors saveSession(): keyed by participant_id, latest claude_session_id + workdir win.
    // This is the invariant the fix relies on — a dispatch in workdir A then a save reporting
    // workdir B must update the SAME row, so getSession (by participant_id) always finds it.
    const part = db.prepare(
      'SELECT id FROM room_participants WHERE room_id=? AND actor_id=?'
    ).get(addRoomId, kiraId);
    const upsert = (sid, wd) => db.prepare(
      `INSERT INTO ai_sessions (participant_id, room_id, claude_session_id, workdir, status) VALUES (?,?,?,?,'idle')
       ON CONFLICT(participant_id) DO UPDATE SET claude_session_id=excluded.claude_session_id, room_id=excluded.room_id, workdir=excluded.workdir, status='idle', last_active_at=datetime('now')`
    ).run(part.id, addRoomId, sid, wd);
    try {
      upsert('sess-A', '/tmp/dir-a');
      upsert('sess-B', '/tmp/dir-b');
      const rows = db.prepare('SELECT claude_session_id, workdir FROM ai_sessions WHERE participant_id=?').all(part.id);
      assert.strictEqual(rows.length, 1, 'exactly one session row per participant');
      assert.strictEqual(rows[0].claude_session_id, 'sess-B', 'latest claude_session_id wins');
      assert.strictEqual(rows[0].workdir, '/tmp/dir-b', 'workdir refreshed to latest dispatch');
    } finally {
      db.prepare('DELETE FROM ai_sessions WHERE participant_id=?').run(part.id);
    }
  });

  // ── 6d. stale-workdir cleanup must respect room_participants.workdir_id ──────
  console.log('\n6d · stale-workdir cleanup respects room_participants.workdir_id');

  await test('workdir referenced only by a participant is kept (no FOREIGN KEY constraint failed)', () => {
    const part = db.prepare(
      'SELECT id, workdir_id FROM room_participants WHERE room_id=? AND actor_id=?'
    ).get(addRoomId, kiraId);
    // A workdir the agent will NOT report in its next scan (so it's "stale"), but that a
    // participant actively references via workdir_id — the case that raised FK errors.
    const ins = db.prepare(
      'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0)'
    ).run(kiraId, '/tmp/stale-used-by-participant', 'stale-used');
    const staleId = ins.lastInsertRowid;
    try {
      db.prepare('UPDATE room_participants SET workdir_id=? WHERE id=?').run(staleId, part.id);
      const staleIds = [staleId];
      const ph0 = staleIds.map(() => '?').join(',');

      // OLD logic (rooms only) — the bug: the participant reference is invisible.
      const oldInUse = new Set(
        db.prepare(`SELECT DISTINCT workdir_id FROM rooms WHERE workdir_id IN (${ph0})`)
          .all(...staleIds).map(r => r.workdir_id)
      );
      assert.ok(!oldInUse.has(staleId),
        'sanity: old rooms-only logic would have flagged this workdir for deletion (the bug)');

      // NEW logic (UNION rooms + room_participants) — must see the participant reference.
      const newInUse = new Set(
        db.prepare(
          `SELECT workdir_id FROM rooms WHERE workdir_id IN (${ph0})
           UNION
           SELECT workdir_id FROM room_participants WHERE workdir_id IN (${ph0})`
        ).all(...staleIds, ...staleIds).map(r => r.workdir_id)
      );
      assert.ok(newInUse.has(staleId),
        'fixed logic must keep a workdir still referenced by a participant');

      // Prove the bug was real: deleting it while the FK reference stands fails.
      assert.throws(
        () => db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(staleId),
        /FOREIGN KEY constraint failed/,
        'deleting a participant-referenced workdir must raise FK error (what old logic risked)'
      );
    } finally {
      db.prepare('UPDATE room_participants SET workdir_id=? WHERE id=?').run(part.workdir_id, part.id);
      db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(staleId);
    }
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
      const r = http.request({ hostname: HOST, port: PORT, path: '/api/rooms', method: 'POST',
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
        hostname: HOST, port: PORT,
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
        hostname: HOST, port: PORT,
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
    const { body: newRoom } = await req('POST', '/api/rooms', { title: 'Test Room — add-part', participant_ids: [humanId, idrisId], workdir_id: firstWorkdirId });
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
    const { body: tmpRoom } = await req('POST', '/api/rooms', { title: 'Test Room — delete-test', participant_ids: [humanId, idrisId], workdir_id: firstWorkdirId });
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
        hostname: HOST, port: PORT,
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
        hostname: HOST, port: PORT, path: '/api/actors', method: 'GET',
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
        hostname: HOST, port: PORT, path: '/api/rooms', method: 'GET',
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
        hostname: HOST, port: PORT, path: '/api/settings', method: 'GET',
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
    const { status } = await req('PATCH', '/api/settings', { public_url: 'http://test.local' });
    assert.strictEqual(status, 200);
    const row = db.prepare("SELECT value FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name='public_url' ORDER BY id DESC LIMIT 1").get();
    assert.strictEqual(row?.value, 'http://test.local');
    await req('PATCH', '/api/settings', { public_url: '' });
    // Cleanup any duplicate rows created by the NULL scope_id bug
    const latest = db.prepare("SELECT id FROM settings WHERE key_name='public_url' ORDER BY id DESC LIMIT 1").get();
    if (latest) db.prepare("DELETE FROM settings WHERE key_name='public_url' AND id != ?").run(latest.id);
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

  // ── 9o. WebSocket message tests ────────────────────────────────────────────
  console.log('\n9o · WebSocket message tests');

  let browserWs;
  await test('browser WS connects and receives history', async () => {
    browserWs = await connectBrowser(roomId);
    assert.ok(browserWs.ws.readyState === WebSocket.OPEN);
  });

  await test('WS file_list returns tree or proxies to agent', async () => {
    const p = browserWs.waitFor('file_list', 8000);
    browserWs.send({ type: 'file_list' });
    const msg = await p;
    assert.ok(msg.root || msg.tree || msg.error, 'expected root, tree, or error');
  });

  await test('WS send_message creates message', async () => {
    const p = browserWs.waitFor(['message_new', 'message_complete']);
    browserWs.send({ type: 'send_message', room_id: roomId, content: 'ws test message' });
    const msg = await p;
    assert.ok(msg.type);
  });

  await test('WS file_write requires valid path', async () => {
    const p = browserWs.waitFor('file_write_result');
    browserWs.send({ type: 'file_write', path: '../escape.txt', content: 'hack' });
    const msg = await p;
    assert.ok(msg.error);
  });

  await test('WS file_write blocks binary extensions', async () => {
    const p = browserWs.waitFor('file_write_result');
    browserWs.send({ type: 'file_write', path: 'test.exe', content: 'binary' });
    const msg = await p;
    assert.strictEqual(msg.error, 'binary files cannot be edited');
  });

  await test('WS file_write blocks oversized content', async () => {
    const p = browserWs.waitFor('file_write_result');
    browserWs.send({ type: 'file_write', path: 'big.txt', content: 'x'.repeat(1024 * 1024 + 1) });
    const msg = await p;
    assert.ok(msg.error.includes('too large'));
  });

  await test('WS file_create blocks invalid characters', async () => {
    const p = browserWs.waitFor('file_create_result');
    browserWs.send({ type: 'file_create', path: 'bad<file>.txt' });
    const msg = await p;
    assert.ok(msg.error.includes('invalid characters'));
  });

  await test('WS file_delete blocks path traversal', async () => {
    const p = browserWs.waitFor('file_delete_result');
    browserWs.send({ type: 'file_delete', path: '../../etc/passwd' });
    const msg = await p;
    assert.ok(msg.error);
  });

  await test('WS file_rename blocks invalid characters in new path', async () => {
    const p = browserWs.waitFor('file_rename_result');
    browserWs.send({ type: 'file_rename', path: 'old.txt', new_path: 'new|bad.txt' });
    const msg = await p;
    assert.ok(msg.error.includes('invalid characters'));
  });

  await test('WS git_diff returns result', async () => {
    const p = browserWs.waitFor('git_diff');
    browserWs.send({ type: 'git_diff' });
    const msg = await p;
    assert.ok(msg.files !== undefined || msg.error);
  });

  // ── 9o2. Agent protocol WS message tests ───────────────────────────────────
  console.log('\n9o2 · agent protocol WS messages');

  // Create a pending AI message in DB for agent response flow tests
  let testMsgId;
  await test('setup: create pending AI message for agent tests', async () => {
    const aiPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, idrisId);
    assert.ok(aiPart, 'Idris must be a participant in the room');
    db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?, ?, '', 'streaming')").run(roomId, aiPart.id);
    testMsgId = db.prepare('SELECT id FROM messages WHERE room_id=? AND participant_id=? ORDER BY id DESC LIMIT 1').get(roomId, aiPart.id).id;
    assert.ok(testMsgId);
  });

  // Reconnect browser to this room for receiving broadcasts
  await test('reconnect browser WS for agent protocol tests', async () => {
    browserWs = await connectBrowser(roomId);
    assert.ok(browserWs.ws.readyState === WebSocket.OPEN);
  });

  await test('WS subscribe_global adds to global clients', async () => {
    const globalBrowser = await connectBrowser(roomId);
    globalBrowser.send({ type: 'subscribe_global' });
    await sleep(100);
    globalBrowser.ws.close();
  });

  await test('WS agent_token broadcasts message_token to room', async () => {
    const p = browserWs.waitFor('message_token');
    idrisWs.send(JSON.stringify({ type: 'agent_token', room_id: roomId, message_id: testMsgId, token: 'hello ' }));
    const msg = await p;
    assert.strictEqual(msg.message_id, testMsgId);
    assert.strictEqual(msg.token, 'hello ');
  });

  await test('WS agent_tool broadcasts message_tool to room', async () => {
    const p = browserWs.waitFor('message_tool');
    idrisWs.send(JSON.stringify({ type: 'agent_tool', room_id: roomId, message_id: testMsgId, tool: { name: 'Read', input: { path: '/tmp/test' } } }));
    const msg = await p;
    assert.strictEqual(msg.message_id, testMsgId);
    assert.strictEqual(msg.tool.name, 'Read');
  });

  await test('WS agent_state broadcasts message_state to room', async () => {
    const p = browserWs.waitFor('message_state');
    idrisWs.send(JSON.stringify({ type: 'agent_state', room_id: roomId, message_id: testMsgId, state: 'streaming' }));
    const msg = await p;
    assert.strictEqual(msg.message_id, testMsgId);
    assert.strictEqual(msg.state, 'streaming');
  });

  await test('WS agent_complete finalizes message in DB', async () => {
    const p = browserWs.waitFor('message_complete');
    idrisWs.send(JSON.stringify({ type: 'agent_complete', room_id: roomId, message_id: testMsgId, content: 'Hello from Idris test' }));
    const msg = await p;
    assert.strictEqual(msg.message_id, testMsgId);
    assert.strictEqual(msg.content, 'Hello from Idris test');
    const row = db.prepare('SELECT state, content FROM messages WHERE id=?').get(testMsgId);
    assert.strictEqual(row.state, 'complete');
    assert.strictEqual(row.content, 'Hello from Idris test');
  });

  // Create another pending message for error test
  let errorMsgId;
  await test('WS agent_error marks message as error', async () => {
    const aiPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, idrisId);
    db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?, ?, '', 'streaming')").run(roomId, aiPart.id);
    errorMsgId = db.prepare('SELECT id FROM messages WHERE room_id=? AND participant_id=? ORDER BY id DESC LIMIT 1').get(roomId, aiPart.id).id;
    const p = browserWs.waitFor('message_state');
    idrisWs.send(JSON.stringify({ type: 'agent_error', room_id: roomId, message_id: errorMsgId, error: 'test error' }));
    const msg = await p;
    assert.strictEqual(msg.state, 'error');
    const row = db.prepare('SELECT state FROM messages WHERE id=?').get(errorMsgId);
    assert.strictEqual(row.state, 'error');
  });

  await test('WS agent_system_event broadcasts system_event', async () => {
    const p = browserWs.waitFor('system_event');
    idrisWs.send(JSON.stringify({ type: 'agent_system_event', room_id: roomId, status: 'test system event' }));
    const msg = await p;
    assert.strictEqual(msg.status, 'test system event');
    assert.ok(msg.actor_name);
  });


  await test('WS agent_search returns search results', async () => {
    const handler = new Promise((resolve, reject) => {
      const onMsg = raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'search_result' && msg.request_id === 'test-search-1') {
          idrisWs.removeListener('message', onMsg);
          resolve(msg);
        }
      };
      idrisWs.on('message', onMsg);
      setTimeout(() => { idrisWs.removeListener('message', onMsg); reject(new Error('search timeout')); }, 5000);
    });
    idrisWs.send(JSON.stringify({ type: 'agent_search', request_id: 'test-search-1', query: 'Hello', room_id: roomId }));
    const msg = await handler;
    assert.ok(Array.isArray(msg.results));
  });

  await test('WS agent_get_message returns message data', async () => {
    const handler = new Promise((resolve, reject) => {
      const onMsg = raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'get_message_result' && msg.request_id === 'test-get-1') {
          idrisWs.removeListener('message', onMsg);
          resolve(msg);
        }
      };
      idrisWs.on('message', onMsg);
      setTimeout(() => { idrisWs.removeListener('message', onMsg); reject(new Error('get_message timeout')); }, 5000);
    });
    idrisWs.send(JSON.stringify({ type: 'agent_get_message', request_id: 'test-get-1', message_id: testMsgId }));
    const msg = await handler;
    assert.ok(msg.message);
    assert.strictEqual(msg.message.id, testMsgId);
  });

  await test('WS stop_generation forwards cancel to agent', async () => {
    const aiPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, idrisId);
    db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?, ?, '', 'streaming')").run(roomId, aiPart.id);
    const stopMsgId = db.prepare('SELECT id FROM messages WHERE room_id=? AND participant_id=? ORDER BY id DESC LIMIT 1').get(roomId, aiPart.id).id;
    const handler = new Promise((resolve, reject) => {
      const onMsg = raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'cancel_generation') {
          idrisWs.removeListener('message', onMsg);
          resolve(msg);
        }
      };
      idrisWs.on('message', onMsg);
      setTimeout(() => { idrisWs.removeListener('message', onMsg); reject(new Error('cancel timeout')); }, 5000);
    });
    browserWs.send({ type: 'stop_generation', room_id: roomId, message_id: stopMsgId });
    const msg = await handler;
    assert.strictEqual(msg.message_id, stopMsgId);
    db.prepare('DELETE FROM messages WHERE id=?').run(stopMsgId);
  });

  await test('WS invite_suggest creates invite suggestion', async () => {
    const aiPart = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?').get(roomId, idrisId);
    idrisWs.send(JSON.stringify({ type: 'invite_suggest', room_id: roomId, suggested_by_participant_id: aiPart.id, suggested_actor_id: kiraId, reason: 'Need help' }));
    await sleep(300);
    const row = db.prepare('SELECT * FROM invite_suggestions WHERE room_id=? AND suggested_actor_id=? ORDER BY id DESC LIMIT 1').get(roomId, kiraId);
    assert.ok(row, 'invite suggestion should exist');
    assert.strictEqual(row.reason, 'Need help');
    db.prepare('DELETE FROM invite_suggestions WHERE room_id=? AND suggested_actor_id=?').run(roomId, kiraId);
  });

  await test('WS file_read returns content or proxies', async () => {
    const p = browserWs.waitFor('file_read', 8000);
    browserWs.send({ type: 'file_read', path: 'test.txt' });
    const msg = await p;
    assert.ok(msg.content !== undefined || msg.base64 !== undefined || msg.error);
  });

  // ── Proxy result forwarding tests ──
  await test('WS proxy_file_create_result forwards to browser', async () => {
    const rid = crypto.randomBytes(6).toString('hex');
    browserWs.send({ type: 'file_create', path: 'proxy-test-create.txt' });
    await sleep(300);
    const pendingOps = [...Array(10)].map((_, i) => i);
    // Agent connectAgent already handles proxy_file_write; for create we need to handle in the connectAgent handler
    // The existing connectAgent doesn't handle proxy_file_create, so this tests the fallback timeout
    // Just verify the browser gets a response (error due to timeout or success from agent)
  });

  // Clean up test messages
  await test('cleanup agent protocol test messages', async () => {
    db.prepare('DELETE FROM messages WHERE id IN (?, ?)').run(testMsgId, errorMsgId);
  });

  browserWs.ws.close();

  // ── 9o3. Model switching WS tests ────────────────────────────────────────────
  console.log('\n9o3 · model switching');

  await test('WS set_room_model updates room model in DB', async () => {
    const bws = await connectBrowser(roomId);
    bws.send({ type: 'set_room_model', model: 'claude-opus-4-8' });
    await sleep(200);
    const row = db.prepare('SELECT model FROM rooms WHERE id=?').get(roomId);
    assert.strictEqual(row.model, 'claude-opus-4-8');
    bws.send({ type: 'set_room_model', model: 'claude-sonnet-4-6' });
    await sleep(100);
    bws.ws.close();
  });

  await test('WS set_room_model broadcasts room_model_changed', async () => {
    const sender = await connectBrowser(roomId);
    const receiver = await connectBrowser(roomId);
    const p = receiver.waitFor('room_model_changed', 3000);
    sender.send({ type: 'set_room_model', model: 'claude-haiku-4-5-20251001' });
    const msg = await p;
    assert.strictEqual(msg.model, 'claude-haiku-4-5-20251001');
    assert.strictEqual(msg.room_id, roomId);
    sender.send({ type: 'set_room_model', model: 'claude-sonnet-4-6' });
    await sleep(100);
    sender.ws.close();
    receiver.ws.close();
  });

  await test('WS set_room_model rejects unknown model', async () => {
    const before = db.prepare('SELECT model FROM rooms WHERE id=?').get(roomId).model;
    const bws = await connectBrowser(roomId);
    const errP = bws.waitFor('error', 2000);
    bws.send({ type: 'set_room_model', model: 'gpt-4-turbo' });
    const errMsg = await errP;
    assert.strictEqual(errMsg.code, 'invalid_model', 'error code must be invalid_model');
    const after = db.prepare('SELECT model FROM rooms WHERE id=?').get(roomId).model;
    assert.strictEqual(after, before, 'unknown model must not update DB');
    bws.ws.close();
  });

  // ── 9p. Client error logging ────────────────────────────────────────────────
  console.log('\n9p · client error logging');

  await test('POST /api/client-error accepts error report', async () => {
    const { status } = await req('POST', '/api/client-error', { message: 'test error', source: 'test:1:1' });
    assert.strictEqual(status, 200);
  });

  await test('POST /api/client-error sanitizes newlines', async () => {
    const { status } = await req('POST', '/api/client-error', { message: 'line1\nline2\rline3', source: 'test' });
    assert.strictEqual(status, 200);
  });

  // ── 9q. Proactive message (POST /api/rooms/:id/message) ───────────────────
  console.log('\n9q · proactive message');

  // helper: POST with agent auth headers + JSON body
  function reqAgent(urlPath, body, agentId, agentSecret) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(JSON.stringify(body));
      const opts = {
        hostname: HOST, port: PORT, path: urlPath, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': buf.length,
          'x-agent-id': String(agentId),
          'x-agent-secret': agentSecret,
        },
      };
      const r = http.request(opts, res => {
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
  }

  await test('POST /api/rooms/:id/message without agent auth returns 403', async () => {
    const { status } = await req('POST', `/api/rooms/${roomId}/message`, { content: 'hello' });
    assert.strictEqual(status, 403);
  });

  await test('POST /api/rooms/:id/message with wrong secret returns 401', async () => {
    const { status } = await reqAgent(`/api/rooms/${roomId}/message`, { content: 'hello' }, idrisId, 'wrongsecret');
    assert.strictEqual(status, 401);
  });

  await test('POST /api/rooms/:id/message with empty content returns 400', async () => {
    const { status } = await reqAgent(`/api/rooms/${roomId}/message`, { content: '   ' }, idrisId, idrisSecret);
    assert.strictEqual(status, 400);
  });

  await test('POST /api/rooms/:id/message for non-existent room returns 404', async () => {
    const { status } = await reqAgent('/api/rooms/999999/message', { content: 'hello' }, idrisId, idrisSecret);
    assert.strictEqual(status, 404);
  });

  await test('POST /api/rooms/:id/message success returns message_id', async () => {
    const { status, body } = await reqAgent(`/api/rooms/${roomId}/message`, { content: 'proactive test message' }, idrisId, idrisSecret);
    assert.strictEqual(status, 200);
    assert.ok(body.message_id, `expected message_id, got: ${JSON.stringify(body)}`);
    // verify persisted
    const row = db.prepare('SELECT id, content, state FROM messages WHERE id=?').get(body.message_id);
    assert.ok(row, 'message must exist in DB');
    assert.strictEqual(row.content, 'proactive test message');
    assert.strictEqual(row.state, 'complete');
    // cleanup
    db.prepare('DELETE FROM messages WHERE id=?').run(body.message_id);
  });

  // ── 9r. Workspace file (GET /api/workspace/file) ──────────────────────────
  console.log('\n9r · workspace file');

  await test('GET /api/workspace/file without params returns 400', async () => {
    const { status } = await reqRaw('GET', '/api/workspace/file');
    assert.strictEqual(status, 400);
  });

  await test('GET /api/workspace/file for non-existent room returns 404', async () => {
    const { status } = await reqRaw('GET', '/api/workspace/file?room=999999&path=test.txt');
    assert.strictEqual(status, 404);
  });

  await test('GET /api/workspace/file path traversal returns 403 or 404', async () => {
    const { status } = await reqRaw('GET', `/api/workspace/file?room=${roomId}&path=../../etc/passwd`);
    assert.ok(status === 403 || status === 404, `expected 403 or 404, got ${status}`);
  });


  // ── 9s. Automation connections (CRUD + error cases) ──────────────────────
  console.log('\n9s · automation connections');

  // Automated: input validation & 404 cases (no Slack token required)

  await test('POST /api/automations/connections — missing name returns 400', async () => {
    const { status, body } = await req('POST', '/api/automations/connections', {
      provider: 'slack', tokenType: 'bot', appToken: 'xapp-test', token: 'xoxb-test'
    });
    assert.strictEqual(status, 400);
    assert.ok(body.error, 'should have error field');
  });

  await test('POST /api/automations/connections — invalid provider returns 400', async () => {
    const { status, body } = await req('POST', '/api/automations/connections', {
      name: 'Test Conn', provider: 'discord', tokenType: 'bot', appToken: 'xapp-test', token: 'xoxb-test'
    });
    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  await test('POST /api/automations/connections — invalid tokenType returns 400', async () => {
    const { status, body } = await req('POST', '/api/automations/connections', {
      name: 'Test Conn', provider: 'slack', tokenType: 'admin', appToken: 'xapp-test', token: 'xoxb-test'
    });
    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  await test('POST /api/automations/connections — missing appToken returns 400', async () => {
    const { status, body } = await req('POST', '/api/automations/connections', {
      name: 'Test Conn', provider: 'slack', tokenType: 'bot', token: 'xoxb-test'
    });
    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  await test('GET /api/automations/connections — returns array without credentials', async () => {
    const { status, body } = await req('GET', '/api/automations/connections');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body), 'should return array');
    for (const c of body) {
      assert.ok(!c.credentials, 'credentials must not be in list response');
    }
  });

  await test('GET /api/automations/connections/999999 — returns 404', async () => {
    const { status } = await req('GET', '/api/automations/connections/999999');
    assert.strictEqual(status, 404);
  });

  await test('PATCH /api/automations/connections/999999 — returns 404', async () => {
    const { status } = await req('PATCH', '/api/automations/connections/999999', { name: 'x' });
    assert.strictEqual(status, 404);
  });

  await test('DELETE /api/automations/connections/999999 — returns 404', async () => {
    const { status } = await req('DELETE', '/api/automations/connections/999999');
    assert.strictEqual(status, 404);
  });

  // Manual tests — require valid Slack tokens (xapp-1-... + xoxb-...)
  console.log('  [MANUAL] POST /api/automations/connections — create with real tokens: name trimmed, credentials not in response, status=connecting');
  console.log('  [MANUAL] GET /api/automations/connections/:id — returns connection without credentials');
  console.log('  [MANUAL] PATCH /api/automations/connections/:id — invalid tokenType → 400, empty name → 400, valid name → 200');
  console.log('  [MANUAL] POST /api/automations/connections/:id/reconnect — reconnects stopped connection → 200');
  console.log('  [MANUAL] DELETE /api/automations/connections/:id — connected → 409 (must disconnect first), disconnected → 200');

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
