// Stoa Tests — Unit + Integration
// Integration tests require a running server: node server.js
// Usage: node test.js [PORT]
const http = require('http');
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { WebSocket } = require('ws');

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

  // deriveUsageModel (mirrors server.js usage_report handler)
  // Default-model turns send model 'unknown'/null but carry modelUsage keyed by real model name.
  const deriveUsageModel = (msg) => {
    let model = (msg.model && msg.model !== 'unknown') ? msg.model : null;
    if (!model && msg.modelUsage && typeof msg.modelUsage === 'object') {
      const top = Object.entries(msg.modelUsage)
        .sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0)
                     || (b[1].outputTokens || 0) - (a[1].outputTokens || 0))[0];
      if (top) model = top[0];
    }
    return model || 'unknown';
  };
  ut('deriveUsageModel — explicit model is preserved', () => {
    assert.strictEqual(deriveUsageModel({ model: 'claude-opus-4-8', modelUsage: {} }), 'claude-opus-4-8');
  });
  ut("deriveUsageModel — model 'unknown' + modelUsage → real model name", () => {
    const msg = { model: 'unknown', modelUsage: { 'claude-sonnet-4-6': { costUSD: 0.5, outputTokens: 100 } } };
    assert.strictEqual(deriveUsageModel(msg), 'claude-sonnet-4-6');
  });
  ut('deriveUsageModel — null model + modelUsage → real model name', () => {
    const msg = { model: null, modelUsage: { 'claude-haiku-4-5-20251001': { costUSD: 0.01, outputTokens: 161 } } };
    assert.strictEqual(deriveUsageModel(msg), 'claude-haiku-4-5-20251001');
  });
  ut('deriveUsageModel — multi-model → dominant by costUSD', () => {
    const msg = { model: 'unknown', modelUsage: {
      'claude-haiku-4-5-20251001': { costUSD: 0.01, outputTokens: 5000 },
      'claude-opus-4-8': { costUSD: 2.0, outputTokens: 50 },
    } };
    assert.strictEqual(deriveUsageModel(msg), 'claude-opus-4-8');
  });
  ut('deriveUsageModel — equal cost → tie-break by outputTokens', () => {
    const msg = { model: 'unknown', modelUsage: {
      'claude-sonnet-4-6': { costUSD: 1.0, outputTokens: 100 },
      'claude-opus-4-8': { costUSD: 1.0, outputTokens: 900 },
    } };
    assert.strictEqual(deriveUsageModel(msg), 'claude-opus-4-8');
  });
  ut("deriveUsageModel — empty/absent modelUsage → 'unknown' fallback", () => {
    assert.strictEqual(deriveUsageModel({ model: 'unknown', modelUsage: {} }), 'unknown');
    assert.strictEqual(deriveUsageModel({ model: null }), 'unknown');
  });

  // pickFavoriteModel (mirrors server.js favoriteModel logic)
  // Historical "unknown" rows must not win the headline Top Model; rank only real model names.
  const pickFavoriteModel = (byModel) => {
    const rankable = byModel.filter(m => m.model && m.model !== 'unknown');
    return rankable.length ? rankable.reduce((a, b) => b.turns > a.turns ? b : a).model : null;
  };
  ut('pickFavoriteModel — ignores "unknown" even when it has the most turns', () => {
    const byModel = [
      { model: 'unknown', turns: 431 },
      { model: 'claude-sonnet-4-6', turns: 186 },
      { model: 'claude-opus-4-8', turns: 101 },
    ];
    assert.strictEqual(pickFavoriteModel(byModel), 'claude-sonnet-4-6');
  });
  ut('pickFavoriteModel — all rows unknown → null (UI renders placeholder)', () => {
    assert.strictEqual(pickFavoriteModel([{ model: 'unknown', turns: 10 }]), null);
    assert.strictEqual(pickFavoriteModel([]), null);
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

async function streamReq(method, path, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST, port: PORT, path, method,
      headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
    };
    const r = http.request(opts, res => {
      const events = [];
      let buf = '';
      const timer = setTimeout(() => { r.destroy(); reject(new Error(`stream timeout after ${timeoutMs}ms`)); }, timeoutMs);
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.trim()) try { events.push(JSON.parse(line)); } catch {}
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (buf.trim()) try { events.push(JSON.parse(buf)); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, events });
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });
    r.on('error', reject);
    r.end();
  });
}

function openWsConnection(url, cookie = null) {
  return new Promise((resolve, reject) => {
    const opts = cookie ? { headers: { Cookie: cookie } } : {};
    const ws = new WebSocket(url, opts);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForWsMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
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

  // Global test rooms/actors — created once, used by all write tests, deleted in teardown
  let testRoomIds = [];
  let testWorkdirId = null;
  let orphanActorIds = [];   // actors created mid-test that teardown must clean up

  // Room/participant creation enforces two server rules (server.js): the workdir owner must be among
  // the participants, and every AI participant must be online at creation time. A writable test room
  // therefore needs a throwaway AI that is (a) online via the agent_connect ws handshake and (b) owns
  // the workdir it uses. Returns { actorId, secret, workdirId, ws }; the ws stays open so the caller
  // can create the room (agent only needs to be online at that moment), then the caller closes it.
  // Returns null if registration fails. The actor is registered into orphanActorIds for teardown.
  const createOnlineTestAgent = async (name, wdPath) => {
    const scriptR = await req('GET', `/install.sh?name=${name}`);
    const tokenMatch = scriptR.raw.match(/REG_TOKEN="([a-f0-9]+)"/);
    if (!tokenMatch) return null;
    const reg = await req('POST', '/api/agent/register', { token: tokenMatch[1] });
    if (reg.status !== 200) return null;
    const { actor_id: actorId, secret } = reg.body;
    orphanActorIds.push(actorId); // ensure teardown cleans it up even if a later step throws
    const ws = await openWsConnection(`ws://${HOST}:${PORT}`);
    const ready = waitForWsMessage(ws, m => m.type === 'agent_ready');
    ws.send(JSON.stringify({ type: 'agent_connect', actor_id: actorId, secret }));
    await ready;
    // Workdir must be owned by this agent; the POST requires the agent online (connected just above).
    const wd = await req('POST', `/api/actors/${actorId}/workdirs`, { path: wdPath, label: 'test' });
    return { actorId, secret, workdirId: wd.body?.id ?? null, ws };
  };

  console.log('\n[Test Setup]');
  await test('Setup — pre-cleanup leftover test actors from prior runs', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    if (!Array.isArray(actors)) return;
    const stale = actors.filter(a => a.name?.startsWith('__test'));
    for (const a of stale) await req('DELETE', `/api/actors/${a.id}`);
    if (stale.length) console.log(`    cleaned up ${stale.length} stale test actor(s)`);
  });

  let writeAgentWs = null;
  await test('Setup — create test rooms for write operations', async () => {
    // Room creation now requires the workdir owner among participants AND that AI online (server.js).
    const agent = await createOnlineTestAgent('__test-write-agent', '/tmp/stoa-test-write');
    if (!agent?.workdirId) { console.log('    (could not set up online test agent — pin/write tests will be skipped)'); return; }
    writeAgentWs = agent.ws;
    testWorkdirId = agent.workdirId;
    for (let i = 1; i <= 6; i++) {
      const r = await req('POST', '/api/rooms', { title: `__test-room-${i}__`, workdir_id: testWorkdirId, participant_ids: [agent.actorId] });
      if (r.status === 200) testRoomIds.push(r.body.id);
    }
    if (writeAgentWs) { writeAgentWs.close(); writeAgentWs = null; } // rooms persist; agent only needed at creation
    assert.ok(testRoomIds.length >= 1, 'could not create any test rooms');
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
    // Room creation requires workdir owner online as participant; POST /participants also
    // requires the added AI to be online — use two throwaway agents.
    const roomAgent = await createOnlineTestAgent('__test-participants-room-agent', '/tmp/stoa-test-participants-room');
    if (!roomAgent?.workdirId) { console.log('    (skipped — could not set up online test agent for room)'); return; }
    const tempRoom = await req('POST', '/api/rooms', { title: '__participants-test__', workdir_id: roomAgent.workdirId, participant_ids: [roomAgent.actorId] });
    roomAgent.ws.close(); // room created; agent only needed online at creation
    if (tempRoom.status !== 200) { console.log('    (skipped — could not create temp room)'); return; }
    const tempRoomId = tempRoom.body.id;
    try {
      const joinAgent = await createOnlineTestAgent('__test-participants-join-agent', '/tmp/stoa-test-participants-join');
      if (!joinAgent) { console.log('    (skipped — could not set up join agent)'); return; }
      const r = await req('POST', `/api/rooms/${tempRoomId}/participants`, { actor_id: joinAgent.actorId });
      joinAgent.ws.close();
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.ok);
    } finally {
      await req('DELETE', `/api/rooms/${tempRoomId}`);
    }
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

  // Pin rooms — all operations use testRoomIds, never touch production rooms
  console.log('\n[Pin Rooms]');
  await test('POST /api/rooms/:id/pin — pins a room → 200 ok', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const r = await req('POST', `/api/rooms/${testRoomIds[0]}/pin`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok, 'ok field missing');
    const rooms = (await req('GET', '/api/rooms')).body;
    const pinned = rooms.find(rm => rm.id === testRoomIds[0]);
    assert.ok(pinned, 'room not found after pin');
    assert.strictEqual(pinned.is_pinned, 1, 'is_pinned should be 1');
  });

  await test('DELETE /api/rooms/:id/pin — unpins a room → 200 ok', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const r = await req('DELETE', `/api/rooms/${testRoomIds[0]}/pin`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok, 'ok field missing');
    const rooms = (await req('GET', '/api/rooms')).body;
    const unpinned = rooms.find(rm => rm.id === testRoomIds[0]);
    assert.ok(unpinned, 'room not found after unpin');
    assert.strictEqual(unpinned.is_pinned, 0, 'is_pinned should be 0');
  });

  await test('POST /api/rooms/:id/pin — max 5 limit → 400', async () => {
    if (testRoomIds.length < 6) { console.log('    (skipped — need 6 test rooms)'); return; }
    // Unpin only test rooms (never touch production pins)
    for (const id of testRoomIds) { await req('DELETE', `/api/rooms/${id}/pin`); }
    // Count how many production rooms are already pinned
    const allRooms = (await req('GET', '/api/rooms')).body;
    const prodPinned = allRooms.filter(rm => rm.is_pinned && !testRoomIds.includes(rm.id)).length;
    if (prodPinned >= 5) { console.log('    (skipped — production already at max pins)'); return; }
    // Pin enough test rooms to reach the limit of 5
    const toPinCount = 5 - prodPinned;
    for (let i = 0; i < toPinCount; i++) { await req('POST', `/api/rooms/${testRoomIds[i]}/pin`); }
    // Now try to pin one more test room — should hit the limit
    const r = await req('POST', `/api/rooms/${testRoomIds[toPinCount]}/pin`);
    assert.strictEqual(r.status, 400, `expected 400 (limit), got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error?.includes('Maximum'), `error message missing: ${JSON.stringify(r.body)}`);
    // Cleanup — unpin only the test rooms we just pinned
    for (let i = 0; i < toPinCount; i++) { await req('DELETE', `/api/rooms/${testRoomIds[i]}/pin`); }
  });

  // Proactive message — self-contained flow: create actor → room → send → delete → archive → cleanup
  console.log('\n[Proactive Message]');
  {
    let pmActorId = null, pmActorSecret = null, pmWorkdirId = null, pmRoomId = null, pmMessageId = null;
    let pmAgentWs = null;

    await test('Setup — register proactive test actor', async () => {
      // Needs an online agent owning its workdir (room-creation rules) — see createOnlineTestAgent.
      const agent = await createOnlineTestAgent('__test-proactive-agent', '/tmp/stoa-test-proactive');
      if (!agent?.workdirId) { console.log('    (skipped — could not set up online test agent)'); return; }
      pmActorId = agent.actorId;
      pmActorSecret = agent.secret;
      pmWorkdirId = agent.workdirId;
      pmAgentWs = agent.ws;
    });

    await test('Setup — create proactive test room', async () => {
      if (!pmWorkdirId || !pmActorId) { console.log('    (skipped)'); return; }
      const r = await req('POST', '/api/rooms', { title: '__proactive-test-room__', workdir_id: pmWorkdirId, participant_ids: [pmActorId] });
      assert.strictEqual(r.status, 200, `create room failed: ${JSON.stringify(r.body)}`);
      pmRoomId = r.body.id;
      if (pmAgentWs) { pmAgentWs.close(); pmAgentWs = null; } // proactive post uses HTTP secret, not ws
    });

    await test('POST /api/rooms/:id/message — agent posts proactive message → 200', async () => {
      if (!pmRoomId || !pmActorId || !pmActorSecret) { console.log('    (skipped)'); return; }
      const r = await rawReq('POST', `/api/rooms/${pmRoomId}/message`,
        JSON.stringify({ content: 'proactive test message' }),
        'application/json',
        { 'X-Agent-Id': String(pmActorId), 'X-Agent-Secret': pmActorSecret }
      );
      assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.raw}`);
      assert.ok(r.body.message_id, 'message_id missing in response');
      pmMessageId = r.body.message_id;
    });

    await test('POST /api/rooms/:id/message — wrong secret → 403', async () => {
      if (!pmRoomId || !pmActorId) { console.log('    (skipped)'); return; }
      const r = await rawReq('POST', `/api/rooms/${pmRoomId}/message`,
        JSON.stringify({ content: 'should fail' }),
        'application/json',
        { 'X-Agent-Id': String(pmActorId), 'X-Agent-Secret': 'wrongsecret' }
      );
      assert.strictEqual(r.status, 403, `expected 403, got ${r.status}`);
    });

    await test('DELETE /api/messages/:id — deletes proactive message → 204', async () => {
      if (!pmMessageId) { console.log('    (skipped)'); return; }
      const r = await req('DELETE', `/api/messages/${pmMessageId}`);
      assert.strictEqual(r.status, 204, `expected 204, got ${r.status}`);
      pmMessageId = null;
    });

    await test('Cleanup — archive and delete test room', async () => {
      if (!pmRoomId) { console.log('    (skipped)'); return; }
      await req('PATCH', `/api/rooms/${pmRoomId}`, { archived: true });
      const r = await req('DELETE', `/api/rooms/${pmRoomId}`);
      assert.strictEqual(r.status, 204, `delete room failed: ${r.status}`);
      pmRoomId = null;
    });

    await test('Cleanup — delete proactive test actor', async () => {
      if (!pmActorId) { console.log('    (skipped)'); return; }
      const r = await req('DELETE', `/api/actors/${pmActorId}`);
      assert.ok([200, 204].includes(r.status), `delete actor failed: ${r.status}`);
      orphanActorIds = orphanActorIds.filter(id => id !== pmActorId);
      pmActorId = null;
    });
  }

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

  // Usage stats
  console.log('\n[Usage]');
  await test('GET /api/usage/stats — returns expected keys', async () => {
    const r = await req('GET', '/api/usage/stats');
    assert.strictEqual(r.status, 200);
    for (const key of ['totals', 'byModel', 'daily', 'activeDays', 'peakHour', 'streakCurrent', 'streakLongest', 'favoriteModel', 'dailyByModel']) {
      assert.ok(key in r.body, `missing key: ${key}`);
    }
  });

  await test('GET /api/usage/stats — unauthenticated → 401', async () => {
    const saved = sessionCookie; sessionCookie = null;
    const r = await req('GET', '/api/usage/stats');
    sessionCookie = saved;
    assert.strictEqual(r.status, 401);
  });

  await test('GET /api/usage/stats — invalid period falls back to 200', async () => {
    const r = await req('GET', '/api/usage/stats?period=bogus');
    assert.strictEqual(r.status, 200);
    for (const p of ['7', '30', 'all']) {
      const rp = await req('GET', '/api/usage/stats?period=' + p);
      assert.strictEqual(rp.status, 200, `period=${p} should be 200`);
    }
  });

  await test('GET /api/usage/stats — tz_offset accepted and clamped', async () => {
    const r = await req('GET', '/api/usage/stats?tz_offset=-420');
    assert.strictEqual(r.status, 200);
    const rClamp = await req('GET', '/api/usage/stats?tz_offset=99999'); // out of range → clamped, not rejected
    assert.strictEqual(rClamp.status, 200);
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

  await test('GET /install.sh?name=test — name preset in script token', async () => {
    const r = await req('GET', '/install.sh?name=my-agent');
    assert.strictEqual(r.status, 200);
    // The name preset is stored server-side in installTokens (not in script body directly)
    assert.ok(r.raw.includes('stoa.js'), 'stoa.js not in script');
    assert.ok(r.raw.includes('claude-session.js'), 'claude-session.js not in script');
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

  await test('POST /api/invites/:id/resolve — approve invite (approved: true)', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const scriptR = await req('GET', '/install.sh?name=__test_invite_agent__');
    const tokenMatch = scriptR.raw.match(/REG_TOKEN="([a-f0-9]+)"/);
    if (!tokenMatch) { console.log('    (skipped — install token not found)'); return; }
    const agentRes = await req('POST', '/api/agent/register', { token: tokenMatch[1] });
    if (agentRes.status !== 200) { console.log(`    (skipped — agent creation failed: ${agentRes.status})`); return; }
    const { actor_id: agentActorId, secret: agentSecret } = agentRes.body;
    orphanActorIds.push(agentActorId);
    let agentWs = null;
    try {
      const roomId = testRoomIds[0];
      // Adding an AI participant requires it online (server.js rule, same as room creation), so the
      // agent_connect handshake must happen BEFORE the POST /participants — not just before invite_suggest.
      agentWs = await openWsConnection(`ws://${HOST}:${PORT}`);
      const agentReadyPromise = waitForWsMessage(agentWs, m => m.type === 'agent_ready');
      agentWs.send(JSON.stringify({ type: 'agent_connect', actor_id: agentActorId, secret: agentSecret }));
      await agentReadyPromise;
      await req('POST', `/api/rooms/${roomId}/participants`, { actor_id: agentActorId });
      const partsRes = (await req('GET', `/api/rooms/${roomId}/participants`)).body;
      const agentPart = partsRes.find(p => p.actor_id === agentActorId);
      assert.ok(agentPart, 'agent participant not found');
      const actors = (await req('GET', '/api/actors')).body;
      const partActorIds = new Set(partsRes.map(p => p.actor_id));
      const targetActor = actors.find(a => !partActorIds.has(a.id));
      if (!targetActor) { console.log('    (skipped — no actors to suggest)'); return; }
      const roomWs = await openWsConnection(`ws://${HOST}:${PORT}`, sessionCookie);
      const invitePromise = waitForWsMessage(roomWs, m => m.type === 'invite_suggestion');
      roomWs.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
      agentWs.send(JSON.stringify({
        type: 'invite_suggest',
        room_id: roomId,
        suggested_by_participant_id: agentPart.id,
        suggested_actor_id: targetActor.id,
        reason: 'test invite',
      }));
      const suggestion = await invitePromise;
      roomWs.close();
      const r = await req('POST', `/api/invites/${suggestion.invite_id}/resolve`, { approved: true });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.ok, true);
    } finally {
      if (agentWs) agentWs.close();
      await req('DELETE', `/api/actors/${agentActorId}`);
      orphanActorIds = orphanActorIds.filter(id => id !== agentActorId);
    }
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
    // Lifecycle room needs its participant online and owning the workdir (server.js rules).
    const agent = await createOnlineTestAgent('__test-lifecycle-agent', '/tmp/stoa-test-lifecycle');
    assert.ok(agent, 'could not register online test agent');
    testActorId = agent.actorId;
    testActorSecret = agent.secret;
    assert.ok(testActorId, 'no actor_id');

    if (!agent.workdirId) { agent.ws.close(); return; } // skip room creation if workdir unavailable
    const r2 = await req('POST', '/api/rooms', { title: 'Test Room lifecycle', participant_ids: [testActorId], workdir_id: agent.workdirId });
    agent.ws.close(); // room created; agent only needed online at creation
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
    orphanActorIds = orphanActorIds.filter(id => id !== testActorId);
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
  // GET /api/actors/:id/capabilities — removed in a8a735c (vision detection moved to server-side /api/show)

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

  await test('PATCH /api/actors/:id — rename actor (no-op)', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const r = await req('PATCH', `/api/actors/${aiActor.id}`, { name: aiActor.name });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert.strictEqual(r.body.name, aiActor.name);
  });

  await test('PATCH /api/actors/:id — missing name → 400', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const r = await req('PATCH', `/api/actors/${aiActor.id}`, { name: '' });
    assert.strictEqual(r.status, 400);
  });

  const MINIMAL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  await test('POST /api/actors/:id/avatar — upload avatar → 200 with avatar_url', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    const r = await req('POST', `/api/actors/${aiActor.id}/avatar`, { data_url: MINIMAL_PNG });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert.ok(r.body.avatar_url?.startsWith('/uploads/avatar/'), `expected /uploads/avatar/ prefix, got ${r.body.avatar_url}`);
    await req('DELETE', `/api/actors/${aiActor.id}/avatar`);
  });

  await test('DELETE /api/actors/:id/avatar — remove avatar → 200 ok: true, clears avatar_url', async () => {
    const actors = (await req('GET', '/api/actors')).body;
    const aiActor = actors.find(a => a.type === 'ai');
    if (!aiActor) { console.log('    (skipped — no AI actors)'); return; }
    await req('POST', `/api/actors/${aiActor.id}/avatar`, { data_url: MINIMAL_PNG });
    const r = await req('DELETE', `/api/actors/${aiActor.id}/avatar`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    const after = (await req('GET', '/api/actors')).body;
    const updated = after.find(a => a.id === aiActor.id);
    assert.strictEqual(updated?.avatar_url, null);
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

  await test('GET /api/automations/connections — returns array', async () => {
    const r = await req('GET', '/api/automations/connections');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
  });

  await test('POST /api/automations/connections — missing tokens → 400', async () => {
    const r = await req('POST', '/api/automations/connections', { name: 'test' });
    assert.strictEqual(r.status, 400);
  });

  await test('POST /api/automations/connections — missing name → 400', async () => {
    const r = await req('POST', '/api/automations/connections', { appToken: 'xapp-x', token: 'xoxb-x' });
    assert.strictEqual(r.status, 400);
  });

  await test('GET /api/setup/status — returns needsSetup bool', async () => {
    const r = await req('GET', '/api/setup/status');
    assert.strictEqual(r.status, 200);
    assert.ok('needsSetup' in r.body, 'needsSetup field missing');
    assert.strictEqual(typeof r.body.needsSetup, 'boolean');
  });

  // AI platforms
  console.log('\n[AI Platforms]');
  let testPlatformId = null;

  // Pre-cleanup: delete leftover test platforms from previous runs
  {
    const existing = await req('GET', '/api/ai/platforms');
    const testPlatformIds = ['test-platform', 'updated-platform', '__test-no-baseurl__', '__test-no-baseurl-disc__', '__test-unreachable__'];
    if (Array.isArray(existing.body)) {
      for (const id of testPlatformIds) {
        if (existing.body.some(p => p.id === id)) await req('DELETE', `/api/ai/platforms/${encodeURIComponent(id)}`);
      }
    }
  }

  await test('GET /api/ai/platforms — returns array', async () => {
    const r = await req('GET', '/api/ai/platforms');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
  });

  await test('POST /api/ai/platforms — missing name → 400', async () => {
    const r = await req('POST', '/api/ai/platforms', { base_url: 'http://localhost:11434/v1' });
    assert.strictEqual(r.status, 400);
  });

  await test('POST /api/ai/platforms — creates platform → 200 with id', async () => {
    const r = await req('POST', '/api/ai/platforms', { name: 'Test Platform', base_url: 'http://localhost:11434/v1' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.id, 'id missing');
    assert.strictEqual(r.body.name, 'Test Platform');
    testPlatformId = r.body.id;
  });

  await test('GET /api/ai/platforms — includes newly created platform', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await req('GET', '/api/ai/platforms');
    assert.ok(r.body.some(p => p.id === testPlatformId), 'platform not in list');
  });

  await test('PATCH /api/ai/platforms/:id — updates name', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await req('PATCH', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}`, { name: 'Updated Platform' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, 'Updated Platform', 'name not updated in response');
  });

  await test('PATCH /api/ai/platforms/:id — nonexistent → 404', async () => {
    const r = await req('PATCH', '/api/ai/platforms/nonexistent-id-xyz', { name: 'x' });
    assert.strictEqual(r.status, 404);
  });

  await test('PATCH /api/ai/platforms/:id — invalid JSON body → 400', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await rawReq('PATCH', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}`, 'not-json', 'application/json');
    assert.strictEqual(r.status, 400);
  });

  await test('PATCH /api/ai/platforms/:id — empty name → 400', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await req('PATCH', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}`, { name: '' });
    assert.strictEqual(r.status, 400);
  });

  await test('POST /api/ai/platforms — duplicate id → 409', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    // The id is derived from the original name (PATCH rename doesn't change id)
    const r = await req('POST', '/api/ai/platforms', { name: 'Test Platform', base_url: 'http://localhost:11434/v1' });
    assert.strictEqual(r.status, 409);
  });

  await test('POST /api/ai/platforms/:id/health — returns status field', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await req('POST', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}/health`);
    assert.strictEqual(r.status, 200);
    assert.ok('status' in r.body, 'status field missing');
    assert.ok(r.body.status === 'ok' || r.body.status === 'error', 'unexpected status value');
    if (r.body.status === 'ok') assert.ok(Array.isArray(r.body.models), 'models not array on ok');
  });

  await test('POST /api/ai/platforms/:id/health — no base_url configured → error status', async () => {
    const r1 = await req('POST', '/api/ai/platforms', { name: '__test-no-baseurl__' });
    assert.strictEqual(r1.status, 200);
    const noBuId = r1.body.id;
    try {
      const r = await req('POST', `/api/ai/platforms/${encodeURIComponent(noBuId)}/health`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.status, 'error', 'expected error status when no base_url');
    } finally {
      await req('DELETE', `/api/ai/platforms/${encodeURIComponent(noBuId)}`);
    }
  });

  await test('POST /api/ai/platforms/:id/discover-models — nonexistent platform → 404', async () => {
    const r = await streamReq('POST', '/api/ai/platforms/nonexistent-platform-xyz/discover-models', 5000);
    assert.strictEqual(r.status, 404);
  });

  await test('POST /api/ai/platforms/:id/discover-models — no base_url configured → error response', async () => {
    const r1 = await req('POST', '/api/ai/platforms', { name: '__test-no-baseurl-disc__' });
    assert.strictEqual(r1.status, 200);
    const noBuId = r1.body.id;
    try {
      const r = await req('POST', `/api/ai/platforms/${encodeURIComponent(noBuId)}/discover-models`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.status, 'error', 'expected error when no base_url');
    } finally {
      await req('DELETE', `/api/ai/platforms/${encodeURIComponent(noBuId)}`);
    }
  });

  await test('POST /api/ai/platforms/:id/discover-models — unreachable base_url → error or empty usable', async () => {
    const r1 = await req('POST', '/api/ai/platforms', { name: '__test-unreachable__', base_url: 'http://127.0.0.1:19999/v1' });
    assert.strictEqual(r1.status, 200);
    const unreachId = r1.body.id;
    try {
      const r = await streamReq('POST', `/api/ai/platforms/${encodeURIComponent(unreachId)}/discover-models`, 30000);
      assert.strictEqual(r.status, 200);
      assert.ok(r.events.length > 0, 'expected at least one response event');
      // server may return {status:'error'} (regular JSON) or NDJSON {type:'done', usable:[]}
      const ev = r.events[r.events.length - 1];
      const isError = ev.status === 'error' || ev.type === 'error';
      const isDoneEmpty = ev.type === 'done' && ev.usable.length === 0;
      assert.ok(isError || isDoneEmpty, `expected error or empty done, got: ${JSON.stringify(ev)}`);
    } finally {
      await req('DELETE', `/api/ai/platforms/${encodeURIComponent(unreachId)}`);
    }
  });

  await test('POST /api/ai/platforms/:id/discover-models — streams NDJSON, done event has usable array [slow ~3min]', async () => {
    const platforms = (await req('GET', '/api/ai/platforms')).body;
    const ollamaCloud = Array.isArray(platforms) && platforms.find(p => p.vendor === 'ollama');
    if (!ollamaCloud) { console.log('    (skipped — no Ollama Cloud platform configured)'); return; }
    console.log(`    probing models on platform "${ollamaCloud.name}" — may take a few minutes...`);
    const r = await streamReq('POST', `/api/ai/platforms/${encodeURIComponent(ollamaCloud.id)}/discover-models`, 300000);
    assert.strictEqual(r.status, 200);
    const startEv = r.events.find(e => e.type === 'start');
    assert.ok(startEv, 'no start event');
    assert.ok(typeof startEv.total === 'number', 'start.total not a number');
    const doneEv = r.events.find(e => e.type === 'done');
    assert.ok(doneEv, 'no done event');
    assert.ok(Array.isArray(doneEv.usable), 'done.usable not array');
    assert.ok(typeof doneEv.tested === 'number', 'done.tested not a number');
    // usable is [{model, vision, tools, local}] objects — includes non-tool-calling models
    if (doneEv.usable.length > 0) {
      assert.ok(typeof doneEv.usable[0].model === 'string', 'usable[0].model not string');
      assert.ok(typeof doneEv.usable[0].vision === 'boolean', 'usable[0].vision not boolean');
      assert.ok(typeof doneEv.usable[0].tools === 'boolean', 'usable[0].tools not boolean');
    }
    const noToolsModels = doneEv.usable.filter(m => !m.tools);
    console.log(`    discovered ${doneEv.usable.length} of ${doneEv.tested} usable models (${noToolsModels.length} without tool-calling)`);
  });

  await test('POST /api/ai/platforms/:id/discover-models — non-tool-calling models included in results [slow ~3min]', async () => {
    const platforms = (await req('GET', '/api/ai/platforms')).body;
    const ollamaCloud = Array.isArray(platforms) && platforms.find(p => p.vendor === 'ollama');
    if (!ollamaCloud) { console.log('    (skipped — no Ollama Cloud platform configured)'); return; }
    const r = await streamReq('POST', `/api/ai/platforms/${encodeURIComponent(ollamaCloud.id)}/discover-models`, 300000);
    assert.strictEqual(r.status, 200);
    const doneEv = r.events.find(e => e.type === 'done');
    assert.ok(doneEv, 'no done event');
    assert.ok(Array.isArray(doneEv.usable), 'done.usable not array');
    // usable must equal all ok probes — non-tool-calling models are no longer filtered out
    const okCount = r.events.filter(e => e.type === 'progress' && e.ok).length;
    assert.strictEqual(doneEv.usable.length, okCount, `usable count (${doneEv.usable.length}) should match ok probes (${okCount}) — filtering by tools would cause mismatch`);
    // Each model must have a tools boolean field
    for (const m of doneEv.usable) {
      assert.ok(typeof m.tools === 'boolean', `model ${m.model} missing boolean tools field`);
    }
    console.log(`    ${doneEv.usable.filter(m => !m.tools).length} non-tool-calling models included`);
  });

  await test('GET /api/ai/models — returns array with anthropic group', async () => {
    const r = await req('GET', '/api/ai/models');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
    const anthropic = r.body.find(g => g.platform_id === 'anthropic');
    assert.ok(anthropic, 'anthropic group missing');
    assert.ok(Array.isArray(anthropic.models) && anthropic.models.length > 0, 'anthropic models empty');
  });

  await test('GET /api/ai/models — anthropic models have vision+tools boolean fields', async () => {
    const r = await req('GET', '/api/ai/models');
    assert.strictEqual(r.status, 200);
    const anthropic = r.body.find(g => g.platform_id === 'anthropic');
    assert.ok(anthropic && anthropic.models.length > 0, 'anthropic group missing');
    const m = anthropic.models[0];
    assert.ok(typeof m.vision === 'boolean', 'vision field not boolean');
    assert.ok(typeof m.tools === 'boolean', 'tools field not boolean');
    assert.ok(m.vision === true, 'anthropic model should have vision=true');
    assert.ok(m.tools === true, 'anthropic model should have tools=true');
  });

  // WS: set_room_model
  console.log('\n[WS: set_room_model]');
  await test('set_room_model — valid claude model → room_model_changed broadcast', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const roomId = testRoomIds[0];
    const ws = await openWsConnection(`ws://${HOST}:${PORT}`, sessionCookie);
    try {
      ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
      const changed = waitForWsMessage(ws, m => m.type === 'room_model_changed' && m.room_id === roomId);
      ws.send(JSON.stringify({ type: 'set_room_model', model: 'claude-opus-4-5', model_config: null }));
      const msg = await changed;
      assert.strictEqual(msg.model, 'claude-opus-4-5');
    } finally {
      ws.close();
    }
  });

  await test('set_room_model — non-claude model not in enabled list → error', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const roomId = testRoomIds[0];
    const ws = await openWsConnection(`ws://${HOST}:${PORT}`, sessionCookie);
    try {
      ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
      await new Promise(r => setTimeout(r, 50));
      const errPromise = waitForWsMessage(ws, m => m.type === 'error');
      ws.send(JSON.stringify({ type: 'set_room_model', model: 'llama3-unknown-model' }));
      const msg = await errPromise;
      assert.ok(msg.message.includes('enabled list'), `unexpected error: ${msg.message}`);
    } finally {
      ws.close();
    }
  });

  await test('set_room_model — invalid model value (empty string) → error', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const roomId = testRoomIds[0];
    const ws = await openWsConnection(`ws://${HOST}:${PORT}`, sessionCookie);
    try {
      ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
      await new Promise(r => setTimeout(r, 50));
      const errPromise = waitForWsMessage(ws, m => m.type === 'error');
      ws.send(JSON.stringify({ type: 'set_room_model', model: '' }));
      const msg = await errPromise;
      assert.ok(msg.message.includes('invalid model'), `unexpected error: ${msg.message}`);
    } finally {
      ws.close();
    }
  });

  await test('set_room_model — invalid base_url → error', async () => {
    if (!testRoomIds.length) { console.log('    (skipped — no test rooms)'); return; }
    const roomId = testRoomIds[0];
    const ws = await openWsConnection(`ws://${HOST}:${PORT}`, sessionCookie);
    try {
      ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
      await new Promise(r => setTimeout(r, 50));
      const errPromise = waitForWsMessage(ws, m => m.type === 'error');
      ws.send(JSON.stringify({ type: 'set_room_model', model: 'claude-opus-4-5', model_config: { platform_id: 'test', base_url: 'not-a-valid-url' } }));
      const msg = await errPromise;
      assert.ok(msg.message.includes('bad base_url'), `unexpected error: ${msg.message}`);
    } finally {
      ws.close();
    }
  });

  await test('DELETE /api/ai/platforms/:id — deletes platform', async () => {
    if (!testPlatformId) { console.log('    (skipped)'); return; }
    const r = await req('DELETE', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    const list = (await req('GET', '/api/ai/platforms')).body;
    assert.ok(!list.some(p => p.id === testPlatformId), 'platform still in list after delete');
    testPlatformId = null;
  });

  await test('DELETE /api/ai/platforms/:id — nonexistent → 404', async () => {
    const r = await req('DELETE', '/api/ai/platforms/nonexistent-id-xyz');
    assert.strictEqual(r.status, 404);
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

  // Teardown — delete test platform if still set (e.g. DELETE test was skipped/failed)
  if (testPlatformId) {
    await req('DELETE', `/api/ai/platforms/${encodeURIComponent(testPlatformId)}`).catch(() => {});
    testPlatformId = null;
  }

  // Teardown — delete all test rooms and actors created during the run
  console.log('\n[Test Teardown]');
  await test('Teardown — delete all test rooms', async () => {
    if (!testRoomIds.length) { console.log('    (nothing to clean up)'); return; }
    for (const id of [...testRoomIds]) {
      await req('DELETE', `/api/rooms/${id}`);
    }
    testRoomIds = [];
  });

  await test('Teardown — delete orphaned test actors', async () => {
    // Delete by id (actors registered mid-test)
    for (const id of [...orphanActorIds]) {
      await req('DELETE', `/api/actors/${id}`);
    }
    orphanActorIds = [];
    // Safety net: sweep any __test-prefixed actors still in DB (e.g. if finally block failed)
    const remaining = (await req('GET', '/api/actors')).body;
    if (Array.isArray(remaining)) {
      const stale = remaining.filter(a => a.name?.startsWith('__test'));
      let swept = 0;
      for (const a of stale) {
        const dr = await req('DELETE', `/api/actors/${a.id}`);
        if (dr.status === 204 || dr.status === 200) swept++;
        else console.log(`    warn: DELETE actor ${a.id} (${a.name}) → ${dr.status}`);
      }
      if (stale.length) console.log(`    swept ${swept}/${stale.length} stale actor(s) by name`);
      else console.log('    (nothing to clean up)');
    }
  });

  // Summary
  const total = passed + failed;
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${total} tests | ${passed} passed | ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('[fatal]', e); process.exit(1); });
