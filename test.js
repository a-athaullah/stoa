// Stoa Tests — Unit + Integration
// Integration tests require a running server: node server.js
// Usage: node test.js [PORT]
const http = require('http');
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

// ── Pure Unit Tests (no server required) ──────────────────────────────────────

function runUnitTests() {
  let p = 0, f = 0;
  function ut(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); p++; }
    catch (e) { console.error(`  ✗ ${name}: ${e.message}`); f++; }
  }

  // parseJsonBody
  const parseJsonBody = s => { try { return JSON.parse(s); } catch { return null; } };
  ut('parseJsonBody — valid JSON object', () => {
    assert.deepStrictEqual(parseJsonBody('{"ok":true}'), { ok: true });
  });
  ut('parseJsonBody — valid JSON array', () => {
    assert.deepStrictEqual(parseJsonBody('[1,2,3]'), [1, 2, 3]);
  });
  ut('parseJsonBody — invalid JSON → null', () => {
    assert.strictEqual(parseJsonBody('not-json'), null);
    assert.strictEqual(parseJsonBody(''), null);
    assert.strictEqual(parseJsonBody('{broken'), null);
  });
  ut('parseJsonBody — null input → null', () => {
    assert.strictEqual(parseJsonBody(null), null);
  });

  // parseCookies
  const parseCookies = header => {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) cookies[k.trim()] = v.join('=').trim();
    }
    return cookies;
  };
  ut('parseCookies — parses key=value pairs', () => {
    const c = parseCookies('session=abc123; theme=dark; lang=en');
    assert.strictEqual(c.session, 'abc123');
    assert.strictEqual(c.theme, 'dark');
    assert.strictEqual(c.lang, 'en');
  });
  ut('parseCookies — empty/null → {}', () => {
    assert.deepStrictEqual(parseCookies(''), {});
    assert.deepStrictEqual(parseCookies(null), {});
    assert.deepStrictEqual(parseCookies(undefined), {});
  });
  ut('parseCookies — value with = sign preserved', () => {
    const c = parseCookies('token=a=b=c');
    assert.strictEqual(c.token, 'a=b=c');
  });

  // isPathSafe (mirrors server logic)
  const isPathSafe = (filePath, workdir) => {
    const resolved = path.resolve(filePath);
    const wdResolved = path.resolve(workdir);
    const norm = p2 => process.platform === 'win32' ? p2.toLowerCase() : p2;
    return norm(resolved).startsWith(norm(wdResolved + path.sep)) || norm(resolved) === norm(wdResolved);
  };
  ut('isPathSafe — valid file inside workdir', () => {
    assert.ok(isPathSafe('/tmp/test/file.js', '/tmp/test'));
  });
  ut('isPathSafe — path equals workdir', () => {
    assert.ok(isPathSafe('/tmp/test', '/tmp/test'));
  });
  ut('isPathSafe — traversal via .. blocked', () => {
    assert.ok(!isPathSafe('/tmp/test/../../etc/passwd', '/tmp/test'));
  });
  ut('isPathSafe — sibling directory blocked', () => {
    assert.ok(!isPathSafe('/tmp/other/file.js', '/tmp/test'));
  });
  ut('isPathSafe — nested subdirectory allowed', () => {
    assert.ok(isPathSafe('/tmp/test/a/b/c/deep.js', '/tmp/test'));
  });

  // parseGitDiff (mirrors server logic)
  const parseGitDiff = raw => {
    if (!raw.trim()) return [];
    const files = [];
    let current = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/);
        current = { name: match ? match[1] : '?', hunks: [], add: 0, del: 0 };
        files.push(current);
      } else if (line.startsWith('@@') && current) {
        current.hunks.push({ k: 'hunk', text: line });
      } else if (current && current.hunks.length) {
        if (line.startsWith('+') && !line.startsWith('+++')) { current.hunks.push({ k: 'add', text: line.slice(1) }); current.add++; }
        else if (line.startsWith('-') && !line.startsWith('---')) { current.hunks.push({ k: 'del', text: line.slice(1) }); current.del++; }
        else if (line.startsWith(' ')) { current.hunks.push({ k: 'ctx', text: line.slice(1) }); }
      }
    }
    return files;
  };
  ut('parseGitDiff — empty string → []', () => {
    assert.deepStrictEqual(parseGitDiff(''), []);
    assert.deepStrictEqual(parseGitDiff('   '), []);
  });
  ut('parseGitDiff — counts adds and deletes correctly', () => {
    const diff = 'diff --git a/foo.js b/foo.js\n--- a/foo.js\n+++ b/foo.js\n@@ -1,3 +1,4 @@\n ctx\n-old line\n+new line\n+another new\n ctx2';
    const files = parseGitDiff(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].name, 'foo.js');
    assert.strictEqual(files[0].add, 2);
    assert.strictEqual(files[0].del, 1);
  });
  ut('parseGitDiff — multiple files', () => {
    const diff = 'diff --git a/a.js b/a.js\n@@ -1 +1 @@\n+x\ndiff --git a/b.js b/b.js\n@@ -1 +1 @@\n-y';
    const files = parseGitDiff(diff);
    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0].name, 'a.js');
    assert.strictEqual(files[1].name, 'b.js');
    assert.strictEqual(files[0].add, 1);
    assert.strictEqual(files[1].del, 1);
  });
  ut('parseGitDiff — +++ and --- lines not counted as diff', () => {
    const diff = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-old\n+new';
    const files = parseGitDiff(diff);
    assert.strictEqual(files[0].add, 1, 'should not count +++ line');
    assert.strictEqual(files[0].del, 1, 'should not count --- line');
  });

  // password hashing (using same algorithm as server)
  const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  };
  const verifyPassword = (password, stored) => {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  };
  ut('password — correct password verifies', () => {
    const hash = hashPassword('mypassword');
    assert.ok(verifyPassword('mypassword', hash));
  });
  ut('password — wrong password fails', () => {
    const hash = hashPassword('mypassword');
    assert.ok(!verifyPassword('wrongpassword', hash));
  });
  ut('password — different salts → different hashes', () => {
    const h1 = hashPassword('same');
    const h2 = hashPassword('same');
    assert.notStrictEqual(h1, h2);
    assert.ok(verifyPassword('same', h1));
    assert.ok(verifyPassword('same', h2));
  });

  // resolveAgentOrder (mirrors server logic)
  const resolveAgentOrder = (content, agents) => {
    const mentions = [];
    for (const agent of agents) {
      const idx = content.indexOf('@' + agent.name);
      if (idx !== -1) mentions.push({ agent, idx });
    }
    if (mentions.length > 0) {
      mentions.sort((a, b) => a.idx - b.idx);
      return mentions.map(m => m.agent);
    }
    return [...agents];
  };
  ut('resolveAgentOrder — single @mention selects one agent', () => {
    const agents = [{ name: 'Ara' }, { name: 'Idris' }];
    const ordered = resolveAgentOrder('@Ara please help', agents);
    assert.strictEqual(ordered.length, 1);
    assert.strictEqual(ordered[0].name, 'Ara');
  });
  ut('resolveAgentOrder — multiple mentions ordered by position', () => {
    const agents = [{ name: 'Ara' }, { name: 'Idris' }];
    const ordered = resolveAgentOrder('hey @Idris then @Ara', agents);
    assert.strictEqual(ordered[0].name, 'Idris');
    assert.strictEqual(ordered[1].name, 'Ara');
  });
  ut('resolveAgentOrder — no mentions → all agents returned', () => {
    const agents = [{ name: 'Ara' }, { name: 'Idris' }];
    const ordered = resolveAgentOrder('hello everyone', agents);
    assert.strictEqual(ordered.length, 2);
  });

  // parseDocFilename (mirrors server logic)
  const parseDocFilename = name => {
    const m = name.match(/^(.+)\.([a-z]{2})\.md$/);
    if (m) return { slug: m[1], lang: m[2] };
    if (name.endsWith('.md')) return { slug: name.slice(0, -3), lang: 'en' };
    return null;
  };
  ut('parseDocFilename — lang-tagged filename', () => {
    const r = parseDocFilename('guide-usage.en.md');
    assert.deepStrictEqual(r, { slug: 'guide-usage', lang: 'en' });
  });
  ut('parseDocFilename — Indonesian', () => {
    const r = parseDocFilename('doc-tailscale.id.md');
    assert.deepStrictEqual(r, { slug: 'doc-tailscale', lang: 'id' });
  });
  ut('parseDocFilename — no lang tag → defaults to en', () => {
    const r = parseDocFilename('readme.md');
    assert.deepStrictEqual(r, { slug: 'readme', lang: 'en' });
  });
  ut('parseDocFilename — non-md file → null', () => {
    assert.strictEqual(parseDocFilename('server.js'), null);
    assert.strictEqual(parseDocFilename('image.png'), null);
  });

  return { p, f };
}


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
  // Run unit tests first (no server needed)
  console.log('Stoa Tests');
  console.log('='.repeat(40));
  console.log('\n[Unit Tests — no server required]');
  const unitResult = runUnitTests();
  passed += unitResult.p;
  failed += unitResult.f;

  console.log(`\n[Integration Tests — http://${HOST}:${PORT}]`);

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

  await test('GET /api/rooms/:id — returns room object', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id === firstRoomId, 'id mismatch');
    assert.ok(r.body.title, 'title missing');
  });

  await test('GET /api/rooms/:id/skills — returns array', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/skills`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('POST /api/rooms/:id/participants — adds actor to room', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const actors = (await req('GET', '/api/actors')).body;
    const parts = (await req('GET', `/api/rooms/${firstRoomId}/participants`)).body;
    const partActorIds = new Set(parts.map(p => p.actor_id));
    const nonMember = actors.find(a => !partActorIds.has(a.id));
    if (!nonMember) { console.log('    (skipped — all actors already in room)'); return; }
    const r = await req('POST', `/api/rooms/${firstRoomId}/participants`, { actor_id: nonMember.id });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
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

  await test('GET /api/rooms/:id/messages — system_event filter: only compact markers, not offline notifications', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/messages`);
    assert.strictEqual(r.status, 200);
    for (const msg of r.body) {
      if (msg.state === 'system_event') {
        assert.ok(msg.content.endsWith('· session compacted'),
          `system_event message must be compact marker, got: "${msg.content}"`);
      }
    }
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

  await test('POST /api/invites/:id/resolve — nonexistent invite → 404', async () => {
    const r = await req('POST', '/api/invites/999999/resolve', { approved: true });
    assert.strictEqual(r.status, 404);
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

  // Room lifecycle (create → rename → archive → restore → export → delete)
  console.log('\n[Room Lifecycle]');
  let testRoomId = null;
  let testActorId = null;
  let testActorSecret = null;
  let testMessageId = null;

  await test('Register test actor for room lifecycle', async () => {
    const scriptR = await req('GET', '/install.sh?name=test-lifecycle-agent');
    const tokenMatch = scriptR.raw.match(/REG_TOKEN="([a-f0-9]+)"/);
    assert.ok(tokenMatch, 'no token');
    const r = await req('POST', '/api/agent/register', { token: tokenMatch[1] });
    assert.strictEqual(r.status, 200);
    testActorId = r.body.actor_id;
    testActorSecret = r.body.secret;
    assert.ok(testActorId, 'no actor_id');

    // Get default workdir id from first available agent workdir (or use human actor's default)
    const actors = (await req('GET', '/api/actors')).body;
    const anyAI = actors.find(a => a.type === 'ai' && a.id !== testActorId);
    if (!anyAI) return; // skip if no other AI agents

    const wds = (await req('GET', `/api/actors/${anyAI.id}/workdirs`)).body;
    if (!wds.length) return;

    const r2 = await req('POST', '/api/rooms', { title: 'Test Room lifecycle', participant_ids: [testActorId], workdir_id: wds[0].id });
    assert.strictEqual(r2.status, 200, `create room failed: ${JSON.stringify(r2.body)}`);
    testRoomId = r2.body.id;
    assert.ok(testRoomId, 'room id missing');
  });

  await test('POST /api/rooms/:id/message — agent posts proactive message → 200', async () => {
    if (!testRoomId || !testActorId || !testActorSecret) { console.log('    (skipped — no test room/actor)'); return; }
    const r = await rawReq('POST', `/api/rooms/${testRoomId}/message`,
      JSON.stringify({ content: 'proactive from test agent' }),
      'application/json',
      { 'X-Agent-Id': String(testActorId), 'X-Agent-Secret': testActorSecret }
    );
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.raw}`);
    assert.ok(r.body.message_id, 'message_id missing');
    testMessageId = r.body.message_id;
  });

  await test('POST /api/rooms/:id/message — no auth → 403', async () => {
    if (!testRoomId) { console.log('    (skipped — no test room)'); return; }
    const r = await req('POST', `/api/rooms/${testRoomId}/message`, { content: 'test' });
    assert.strictEqual(r.status, 403);
  });

  await test('PATCH /api/rooms/:id — rename room', async () => {
    if (!testRoomId) { console.log('    (skipped — no test room)'); return; }
    const r = await req('PATCH', `/api/rooms/${testRoomId}`, { title: 'Renamed Test Room' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    const room = (await req('GET', `/api/rooms/${testRoomId}`)).body;
    assert.strictEqual(room.title, 'Renamed Test Room');
  });

  await test('PATCH /api/rooms/:id — archive room', async () => {
    if (!testRoomId) { console.log('    (skipped — no test room)'); return; }
    const r = await req('PATCH', `/api/rooms/${testRoomId}`, { archived: true });
    assert.strictEqual(r.status, 200);
    const archived = (await req('GET', '/api/rooms?archived=1')).body;
    assert.ok(archived.some(rm => rm.id === testRoomId), 'room not in archive list');
  });

  await test('PATCH /api/rooms/:id — restore room', async () => {
    if (!testRoomId) { console.log('    (skipped — no test room)'); return; }
    const r = await req('PATCH', `/api/rooms/${testRoomId}`, { archived: false });
    assert.strictEqual(r.status, 200);
    const active = (await req('GET', '/api/rooms')).body;
    assert.ok(active.some(rm => rm.id === testRoomId), 'room not restored to active list');
  });

  await test('GET /api/rooms/:id/export — JSON format', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/export?format=json`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.room, 'missing room key');
    assert.ok(Array.isArray(r.body.messages), 'messages not array');
    assert.ok(r.body.exported_at, 'missing exported_at');
  });

  await test('GET /api/rooms/:id/export — CSV format', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('GET', `/api/rooms/${firstRoomId}/export?format=csv`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.startsWith('id,timestamp,actor'), 'missing CSV header');
  });

  await test('DELETE /api/rooms/:id — deletes room', async () => {
    if (!testRoomId) { console.log('    (skipped — no test room)'); return; }
    const r = await req('DELETE', `/api/rooms/${testRoomId}`);
    assert.strictEqual(r.status, 204);
    const r2 = await req('GET', `/api/rooms/${testRoomId}`);
    assert.strictEqual(r2.status, 404);
    testRoomId = null;
  });

  await test('Cleanup test actor', async () => {
    if (!testActorId) { console.log('    (skipped)'); return; }
    const r = await req('DELETE', `/api/actors/${testActorId}`);
    assert.ok([204, 200].includes(r.status));
    testActorId = null;
    testActorSecret = null;
  });

  // Messages
  console.log('\n[Message Operations]');
  let testMsgId = null;

  await test('GET /api/messages/:id — get single message', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const msgs = (await req('GET', `/api/rooms/${firstRoomId}/messages`)).body;
    if (!msgs.length) { console.log('    (skipped — no messages)'); return; }
    const r = await req('GET', `/api/messages/${msgs[0].id}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id, 'id missing');
    assert.ok(r.body.actor_name, 'actor_name missing');
  });

  await test('DELETE /api/messages/:id — deletes message', async () => {
    if (!testMessageId) { console.log('    (skipped — no test message)'); return; }
    const r = await req('DELETE', `/api/messages/${testMessageId}`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert.ok(r.body.ok, 'ok field missing');
    testMessageId = null;
  });

  await test('GET /api/messages/999999 — nonexistent → 404', async () => {
    const r = await req('GET', '/api/messages/999999');
    assert.strictEqual(r.status, 404);
  });

  await test('DELETE /api/messages/999999 — nonexistent → 404', async () => {
    const r = await req('DELETE', '/api/messages/999999');
    assert.strictEqual(r.status, 404);
  });

  // Actor operations
  console.log('\n[Actor Operations]');
  await test('GET /api/actors/:id/capabilities — returns models array', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const ollamaActor = actors.find(a => a.adapter === 'ollama');
    if (!ollamaActor) { console.log('    (skipped — no Ollama actor)'); return; }
    const r = await req('GET', `/api/actors/${ollamaActor.id}/capabilities`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.models), 'models not array');
  });

  await test('GET /api/actors/:id/workdirs — returns workdir list', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const r = await req('GET', `/api/actors/${aiActor.id}/workdirs`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('POST /api/actors/:id/force-update — online agent → 200', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const online = actors.find(a => a.type === 'ai' && a.online);
    if (!online) { console.log('    (skipped — no online AI agents)'); return; }
    const r = await req('POST', `/api/actors/${online.id}/force-update`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
  });

  await test('POST /api/actors/:id/force-update — offline agent → 503', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const offline = actors.find(a => a.type === 'ai' && !a.online);
    if (!offline) { console.log('    (skipped — all AI agents online)'); return; }
    const r = await req('POST', `/api/actors/${offline.id}/force-update`);
    assert.strictEqual(r.status, 503);
  });

  await test('POST /api/actors/:id/rescan — online agent → 200', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const online = actors.find(a => a.type === 'ai' && a.online);
    if (!online) { console.log('    (skipped — no online AI agents)'); return; }
    const r = await req('POST', `/api/actors/${online.id}/rescan`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
  });

  await test('PUT /api/actors/:id/config — updates name and lang', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const origName = aiActor.name;
    const r = await req('PUT', `/api/actors/${aiActor.id}/config`, { name: origName, lang: 'en' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id, 'id missing');
    assert.strictEqual(r.body.name, origName);
  });

  await test('PUT /api/actors/:id/config — empty name → 400', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const r = await req('PUT', `/api/actors/${aiActor.id}/config`, { name: '' });
    assert.strictEqual(r.status, 400);
  });

  await test('POST /api/actors/:id/workdirs — offline agent → 503', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const offline = actors.find(a => a.type === 'ai' && !a.online);
    if (!offline) { console.log('    (skipped — all AI agents online)'); return; }
    const r = await req('POST', `/api/actors/${offline.id}/workdirs`, { path: '/tmp/test-wd-stoa' });
    assert.strictEqual(r.status, 503);
  });

  await test('POST /api/actors/:id/workdirs — online agent → 200', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const online = actors.find(a => a.type === 'ai' && a.online);
    if (!online) { console.log('    (skipped — no online AI agents)'); return; }
    const r = await req('POST', `/api/actors/${online.id}/workdirs`, { path: `/tmp/test-wd-stoa-${Date.now()}` });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id !== undefined, 'id missing');
  });

  // Auth operations
  console.log('\n[Auth Operations]');
  await test('PATCH /api/auth/email — invalid email format → 400', async () => {
    const r = await req('PATCH', '/api/auth/email', { email: 'not-an-email' });
    assert.strictEqual(r.status, 400);
  });

  await test('PATCH /api/auth/password — wrong current password → 401', async () => {
    const r = await req('PATCH', '/api/auth/password', { current_password: 'wrong', new_password: 'newpass123' });
    assert.strictEqual(r.status, 401);
  });

  await test('PATCH /api/auth/password — too short new password → 400', async () => {
    const r = await req('PATCH', '/api/auth/password', { current_password: 'stoa2026!', new_password: 'abc' });
    assert.strictEqual(r.status, 400);
  });

  await test('POST /api/auth/logout — clears session → ok', async () => {
    const r = await req('POST', '/api/auth/logout');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    // Re-authenticate so subsequent tests keep working
    const loginR = await req('POST', '/api/auth/login', { email: 'stoa@stoa.com', password: 'stoa2026!' });
    sessionCookie = loginR.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(sessionCookie, 'failed to re-authenticate after logout');
  });

  // Settings
  console.log('\n[Settings Operations]');
  await test('PATCH /api/settings — invalid JSON → 400', async () => {
    const r = await rawReq('PATCH', '/api/settings', 'bad-json', 'application/json');
    assert.strictEqual(r.status, 400);
  });

  await test('PATCH /api/settings — valid non-destructive update → ok', async () => {
    const curr = (await req('GET', '/api/settings')).body;
    const r = await req('PATCH', '/api/settings', { max_ai_turns: curr.max_ai_turns });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
  });

  // Client error logging
  console.log('\n[Client Error]');
  await test('POST /api/client-error — logs error → 200 ok', async () => {
    const r = await req('POST', '/api/client-error', { message: 'test error from test.js', source: 'test.js', line: 0 });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
  });

  // Upload validation
  console.log('\n[Upload Validation]');
  await test('GET /uploads/nonexistent.txt — 404', async () => {
    const r = await req('GET', '/uploads/nonexistent-file-xyz.txt');
    assert.strictEqual(r.status, 404);
  });

  await test('GET /uploads/../../server.js — traversal blocked', async () => {
    const r = await req('GET', '/uploads/../../server.js');
    assert.strictEqual(r.status, 404);
  });

  // Docs
  console.log('\n[Docs Fetch]');
  await test('GET /api/docs/:file — known doc returns content', async () => {
    const r = await req('GET', '/api/docs/guide-usage.en.md');
    assert.strictEqual(r.status, 200);
    assert.ok(r.raw.includes('Stoa'), 'doc content missing');
  });

  await test('GET /api/docs/:file — non-md → 400', async () => {
    const r = await req('GET', '/api/docs/server.js');
    assert.strictEqual(r.status, 400);
  });

  await test('GET /api/docs/:file — nonexistent → 404', async () => {
    const r = await req('GET', '/api/docs/nonexistent.md');
    assert.strictEqual(r.status, 404);
  });

  // Automation CRUD
  console.log('\n[Automation CRUD]');
  let testAutoId = null;

  await test('GET /api/automations — returns array', async () => {
    const r = await req('GET', '/api/automations');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  await test('POST /api/automations — creates rule', async () => {
    if (!firstRoomId) { console.log('    (skipped — no rooms)'); return; }
    const r = await req('POST', '/api/automations', {
      name: 'test-auto',
      trigger_type: 'slack',
      trigger_event: 'message',
      trigger_conditions: JSON.stringify([]),
      target_room_id: firstRoomId,
      prompt_template: 'test {{slack_message_text}}',
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id, 'id missing');
    assert.strictEqual(r.body.name, 'test-auto');
    testAutoId = r.body.id;
  });

  await test('POST /api/automations — missing required fields → 400', async () => {
    const r = await req('POST', '/api/automations', { name: 'no-target' });
    assert.strictEqual(r.status, 400);
  });

  await test('PATCH /api/automations/:id — updates rule', async () => {
    if (!testAutoId) { console.log('    (skipped)'); return; }
    const r = await req('PATCH', `/api/automations/${testAutoId}`, { name: 'renamed-auto', enabled: false });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, 'renamed-auto');
    assert.strictEqual(r.body.enabled, 0);
  });

  await test('PATCH /api/automations/:id — invalid JSON → 400', async () => {
    if (!testAutoId) { console.log('    (skipped)'); return; }
    const r = await rawReq('PATCH', `/api/automations/${testAutoId}`, 'bad-json', 'application/json');
    assert.strictEqual(r.status, 400);
  });

  await test('PATCH /api/automations/999999 — nonexistent → 404', async () => {
    const r = await req('PATCH', '/api/automations/999999', { name: 'x' });
    assert.strictEqual(r.status, 404);
  });

  await test('DELETE /api/automations/:id — deletes rule', async () => {
    if (!testAutoId) { console.log('    (skipped)'); return; }
    const r = await req('DELETE', `/api/automations/${testAutoId}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    // Confirm gone
    const list = (await req('GET', '/api/automations')).body;
    assert.ok(!list.some(a => a.id === testAutoId), 'auto still in list after delete');
    testAutoId = null;
  });

  await test('GET /api/automations/slack — returns connected status', async () => {
    const r = await req('GET', '/api/automations/slack');
    assert.strictEqual(r.status, 200);
    assert.ok('connected' in r.body, 'connected field missing');
  });

  await test('GET /api/setup/status — returns needsSetup bool', async () => {
    const r = await req('GET', '/api/setup/status');
    assert.strictEqual(r.status, 200);
    assert.ok('needsSetup' in r.body, 'needsSetup field missing');
    assert.strictEqual(typeof r.body.needsSetup, 'boolean');
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
