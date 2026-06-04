// Stoa API Integration Tests
// Requires a running server: node server.js
// Usage: node test.js [PORT]
const http = require('http');
const assert = require('assert');

const HOST = 'localhost';
const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000;
let sessionCookie = null;

async function req(method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== null ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...extraHeaders,
      },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function rawReq(method, path, body, contentType, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': contentType,
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : { 'Content-Length': '0' }),
        ...extraHeaders,
      },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    r.on('error', reject);
    if (body) r.write(body); r.end();
  });
}

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function run() {
  console.log(`Stoa API Tests — http://${HOST}:${PORT}`);
  console.log('='.repeat(40));

  // Auth
  console.log('\n[Auth]');
  await test('POST /api/auth/login — valid credentials → 200 + cookie', async () => {
    const r = await req('POST', '/api/auth/login', { email: 'stoa@stoa.com', password: 'stoa2026!' });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert.ok(r.body.ok, 'body.ok missing');
    sessionCookie = r.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(sessionCookie, 'no session cookie in response');
  });

  await test('POST /api/auth/login — wrong password → 401', async () => {
    const r = await req('POST', '/api/auth/login', { email: 'stoa@stoa.com', password: 'wrongpassword' });
    assert.strictEqual(r.status, 401);
  });

  await test('POST /api/auth/login — invalid JSON → 400', async () => {
    const r = await rawReq('POST', '/api/auth/login', 'not-json', 'application/json');
    assert.strictEqual(r.status, 400);
  });

  await test('GET /api/auth/me — authenticated', async () => {
    const r = await req('GET', '/api/auth/me');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.email, 'email missing');
  });

  await test('GET /api/rooms — unauthenticated → 401', async () => {
    const saved = sessionCookie; sessionCookie = null;
    const r = await req('GET', '/api/rooms');
    sessionCookie = saved;
    assert.strictEqual(r.status, 401);
  });

  // Rooms
  console.log('\n[Rooms]');
  let firstRoomId = null;

  await test('GET /api/rooms — returns array', async () => {
    const r = await req('GET', '/api/rooms');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'body is not array');
    if (r.body.length) firstRoomId = r.body[0].id;
  });

  await test('GET /api/rooms?archived=1 — returns array', async () => {
    const r = await req('GET', '/api/rooms?archived=1');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('GET /api/rooms/participants?ids=1 — returns grouped object', async () => {
    const r = await req('GET', '/api/rooms/participants?ids=1');
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body === 'object');
  });

  // Messages
  console.log('\n[Messages]');
  await test('GET /api/rooms/:id/messages — since param, returns array', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/messages`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('GET /api/rooms/:id/messages?before=9999999 — before param', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/messages?before=9999999`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('GET /api/rooms/:id/participants — returns array', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/participants`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  // Search
  console.log('\n[Search]');
  await test('GET /api/search?q= — empty query → []', async () => {
    const r = await req('GET', '/api/search?q=');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, []);
  });

  await test('GET /api/search?q=test — returns array', async () => {
    const r = await req('GET', '/api/search?q=test&limit=5');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  // Actors
  console.log('\n[Actors]');
  await test('GET /api/actors — no secret field exposed', async () => {
    const r = await req('GET', '/api/actors');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
    for (const a of r.body) {
      assert.ok(!('secret' in a), `actor ${a.id} exposes secret field`);
    }
  });

  await test('GET /api/actors — has online field', async () => {
    const r = await req('GET', '/api/actors');
    assert.strictEqual(r.status, 200);
    for (const a of r.body) assert.ok('online' in a, `actor ${a.id} missing online field`);
  });

  // Settings
  console.log('\n[Settings]');
  await test('GET /api/settings — returns expected keys', async () => {
    const r = await req('GET', '/api/settings');
    assert.strictEqual(r.status, 200);
    for (const key of ['public_url', 'port', 'max_ai_turns', 'session_idle_ttl']) {
      assert.ok(key in r.body, `missing key: ${key}`);
    }
  });

  // Client auto-update
  console.log('\n[Client Files]');
  await test('GET /api/client/manifest — returns files map', async () => {
    const r = await req('GET', '/api/client/manifest');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.files && typeof r.body.files === 'object', 'missing files map');
    assert.ok('stoa.js' in r.body.files, 'stoa.js not in manifest');
  });

  await test('GET /api/client/file/stoa.js — returns JS content', async () => {
    const r = await req('GET', '/api/client/file/stoa.js');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('CLIENT_VERSION'), 'CLIENT_VERSION not in stoa.js');
  });

  await test('GET /api/client/file/../../server.js — path traversal blocked → 404', async () => {
    const r = await req('GET', '/api/client/file/../../server.js');
    assert.strictEqual(r.status, 404);
  });

  await test('GET /api/client/file/notallowed.sh — not in whitelist → 404', async () => {
    const r = await req('GET', '/api/client/file/notallowed.sh');
    assert.strictEqual(r.status, 404);
  });

  // Install scripts
  console.log('\n[Install Scripts]');
  await test('GET /install.sh — returns bash script with one-time token', async () => {
    const r = await req('GET', '/install.sh');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('#!/bin/bash'), 'not a bash script');
    assert.ok(r.raw.includes('REG_TOKEN='), 'no REG_TOKEN in script');
    assert.ok(r.raw.includes('/api/agent/register'), 'no register endpoint in script');
  });

  await test('GET /install.ps1 — returns PowerShell script', async () => {
    const r = await req('GET', '/install.ps1');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('$RegToken'), 'not a PS1 script');
  });

  await test('GET /install.cmd — returns CMD script', async () => {
    const r = await req('GET', '/install.cmd');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('powershell'), 'no powershell in CMD script');
  });

  await test('GET /install.sh?backend=ollama — Ollama install script', async () => {
    const r = await req('GET', '/install.sh?backend=ollama');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('Ollama'), 'Ollama not mentioned in script');
    assert.ok(r.raw.includes('ollama-session.js'), 'ollama-session.js not included');
  });

  await test('GET /install.sh?backend=gemini — Gemini install script', async () => {
    const r = await req('GET', '/install.sh?backend=gemini');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('Gemini'), 'Gemini not in script');
    assert.ok(r.raw.includes('gemini-session.js'), 'gemini-session.js not included');
  });

  // Agent register
  console.log('\n[Agent Registration]');
  await test('POST /api/agent/register — invalid token → 401', async () => {
    const r = await req('POST', '/api/agent/register', { token: 'invalid-token-12345' });
    assert.strictEqual(r.status, 401);
  });

  await test('POST /api/agent/register — valid one-time token → 200 with secret', async () => {
    // Get a fresh install script to extract a valid token
    const scriptR = await req('GET', '/install.sh?name=test-agent');
    assert.strictEqual(scriptR.status, 200);
    const tokenMatch = scriptR.raw.match(/REG_TOKEN="([a-f0-9]+)"/);
    assert.ok(tokenMatch, 'no token found in script');
    const token = tokenMatch[1];

    const r = await req('POST', '/api/agent/register', { token });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.actor_id, 'actor_id missing');
    assert.ok(r.body.secret, 'secret missing');
    assert.ok(r.body.name, 'name missing');

    // Token should be one-time — second use should fail
    const r2 = await req('POST', '/api/agent/register', { token });
    assert.strictEqual(r2.status, 401, 'token should be invalidated after use');

    // Cleanup: delete the test actor
    await req('DELETE', `/api/actors/${r.body.actor_id}`);
  });

  // Invites
  console.log('\n[Invites]');
  await test('POST /api/invites/:id/resolve — invalid JSON → 400', async () => {
    const r = await rawReq('POST', '/api/invites/1/resolve', 'not-json', 'application/json');
    assert.strictEqual(r.status, 400);
  });

  // Upload
  console.log('\n[Upload]');
  await test('POST /api/upload/raw — uploads text content', async () => {
    const content = Buffer.from('hello from test');
    const r = await rawReq('POST', '/api/upload/raw', content, 'text/plain', {
      'X-File-Name': 'test.txt',
      'Content-Length': String(content.length),
    });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.raw}`);
    assert.ok(r.body.url?.startsWith('/uploads/'), 'url not in /uploads/');
  });

  // Docs
  console.log('\n[Docs]');
  await test('GET /api/docs — returns docs list', async () => {
    const r = await req('GET', '/api/docs');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
    if (r.body.length) {
      const first = r.body[0];
      assert.ok(first.slug, 'slug missing');
      assert.ok(Array.isArray(first.langs), 'langs missing');
    }
  });

  // 404 handling
  console.log('\n[404]');
  await test('GET /api/nonexistent — 404', async () => {
    const r = await req('GET', '/api/nonexistent-endpoint');
    assert.strictEqual(r.status, 404);
  });

  await test('GET /api/rooms/999999 — nonexistent room → 404', async () => {
    const r = await req('GET', '/api/rooms/999999');
    assert.strictEqual(r.status, 404);
  });

  // Summary
  const total = passed + failed;
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${total} tests | ${passed} passed | ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('[fatal]', e); process.exit(1); });
