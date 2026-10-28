#!/usr/bin/env node
// Regenerate README/docs screenshots from a fictional demo workspace.
//
//   node .claude/tools/screenshots/capture.js                 # every shot in shots.js
//   node .claude/tools/screenshots/capture.js --only=hero,threads
//   node .claude/tools/screenshots/capture.js --list
//   node .claude/tools/screenshots/capture.js --serve         # boot the demo and keep it up (manual look)
//
// Boots a throwaway server (temp DB seeded from demo-data.js, empty .env, random port and
// password), fakes the "online" agents over WS, drives headless Chrome with Playwright, writes
// PNGs to docs/screenshots/, then deletes the temp dir. Never touches db/stoa.db or the live port.
// Playwright is not a repo dependency: set STOA_PLAYWRIGHT=/path/to/node_modules/playwright
// when `require('playwright')` can't resolve it. Output: JSON {ok, outDir, shots: [{name, file, bytes}]}.
'use strict';

const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), net = require('net');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const WebSocket = require(path.join(root, 'node_modules/ws'));
const demo = require('./demo-data');
const SHOTS = require('./shots');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT_DIR = path.join(root, 'docs', 'screenshots');

function loadPlaywright() {
  for (const p of [process.env.STOA_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(p); } catch {}
  }
  throw new Error('Playwright not found: set STOA_PLAYWRIGHT=/path/to/node_modules/playwright');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

async function waitHttp(base, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`${base}/api/auth/me`); if (r.status) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('demo server did not start');
}

function startServer(dir, port, password) {
  const env = {
    ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'stoa.db'), STOA_ENV_FILE: path.join(dir, '.env'),
    STOA_TEST: '1', STOA_INITIAL_PASSWORD: password, HUMAN_NAME: demo.HUMAN.name,
    STOA_AGENT_BUNDLE_DIR: fs.mkdtempSync(path.join(dir, 'dist-')), STOA_MCP_WORK_DIR: fs.mkdtempSync(path.join(dir, 'mcp-')),
    STOA_UPDATE_REPO_DIR: path.join(dir, 'upd'), STOA_UPDATE_STATE_FILE: path.join(dir, 'upd.json'), STOA_UPDATE_CHECK_DELAY_MS: String(864e5),
  };
  delete env.NODE_ENV;
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  return spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, stdio: ['ignore', log, log], env });
}

function stopServer(proc) {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 4000);
  });
}

function ts(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

// Writes the demo rows straight into the (stopped) throwaway DB. Returns ids the shots need.
function seed(dbPath) {
  const db = new Database(dbPath);
  const ids = { actors: {}, rooms: {}, msgs: {}, subs: {}, secrets: {} };
  db.transaction(() => {
    const addActor = db.prepare('INSERT INTO actors (name, type, adapter, adapter_config, avatar_color, avatar_symbol, secret, default_model, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    // First boot already created the single human actor; rename it rather than add a second one.
    const human = db.prepare("SELECT id FROM actors WHERE type='human' LIMIT 1").get();
    if (human) db.prepare('UPDATE actors SET name=?, avatar_color=?, avatar_symbol=? WHERE id=?').run(demo.HUMAN.name, demo.HUMAN.color, demo.HUMAN.symbol, human.id);
    ids.actors.human = human ? human.id : addActor.run(demo.HUMAN.name, 'human', null, null, demo.HUMAN.color, demo.HUMAN.symbol, null, null, ts(40000)).lastInsertRowid;
    for (const a of demo.AGENTS) {
      const secret = crypto.randomBytes(24).toString('hex');
      ids.actors[a.key] = addActor.run(a.name, 'ai', 'claude', '{"lang":"en"}', a.color, a.symbol, secret, a.model, ts(40000)).lastInsertRowid;
      ids.secrets[a.key] = secret;
      db.prepare('INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,1)').run(ids.actors[a.key], a.workdir, a.machine);
    }
    for (const s of demo.SUB_AGENTS) {
      ids.subs[s.key] = db.prepare('INSERT INTO sub_agents (parent_actor_id, label, tier, model, system_prompt, avatar_color, avatar_symbol, description, role) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(ids.actors[s.parent], s.label, s.tier, s.model, `You are ${s.label}, the team's ${s.role}.`, s.color, s.symbol, s.description, s.role).lastInsertRowid;
    }
    db.prepare("INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('global', NULL, 'public_url', 'https://stoa.example.com')").run();
    const addMsg = db.prepare(`INSERT INTO messages (room_id, participant_id, content, state, created_at, completed_at, ai_model, sub_agent_id, sub_agent_label,
      parent_message_id, result_meta, thread_id, tool_steps) VALUES (?,?,?,'complete',?,?,?,?,?,?,?,?,?)`);
    for (const [i, r] of demo.ROOMS.entries()) {
      const roomId = db.prepare('INSERT INTO rooms (title, created_by, is_pinned, model, created_at) VALUES (?,?,?,?,?)').run(r.title, ids.actors.human, r.pinned ? 1 : 0, r.model || null, ts(30000 - i)).lastInsertRowid;
      ids.rooms[r.key] = roomId;
      const part = {};
      const join = db.prepare('INSERT INTO room_participants (room_id, actor_id) VALUES (?,?)');
      part.human = join.run(roomId, ids.actors.human).lastInsertRowid;
      for (const a of r.agents) {
        part[a] = join.run(roomId, ids.actors[a]).lastInsertRowid;
        // The room's Agents panel reads presence from the main session row.
        const def = demo.AGENTS.find(x => x.key === a);
        if (def.online) db.prepare("INSERT INTO ai_sessions (participant_id, room_id, claude_session_id, workdir, status, thread_id) VALUES (?,?,?,?,'idle',0)")
          .run(part[a], roomId, crypto.randomUUID(), def.workdir);
      }
      if (r.agents.length > 1) {
        const primaryKey = r.primary || r.agents[0];
        db.prepare('UPDATE rooms SET primary_actor_id=? WHERE id=?').run(ids.actors[primaryKey], roomId);
      }
      if (r.memory) db.prepare("INSERT INTO room_memory (room_id, content, updated_at) VALUES (?,?,datetime('now'))").run(roomId, r.memory);
      for (const s of r.subs) db.prepare('INSERT INTO room_sub_agents (room_id, sub_agent_id) VALUES (?,?)').run(roomId, ids.subs[s]);
      const insert = (m, threadId) => {
        const [who, sub] = m.by.split(':');
        const agent = demo.AGENTS.find(a => a.key === who);
        const subDef = sub && demo.SUB_AGENTS.find(s => s.key === sub);
        const isAi = who !== 'human';
        const meta = isAi ? JSON.stringify({ exit_reason: 'completed', duration_ms: 40000 + (m.ago % 7) * 9000 }) : null;
        const steps = m.steps ? JSON.stringify(m.steps.map(([name, summary]) => ({ name, summary }))) : null;
        return addMsg.run(roomId, part[who], m.text, ts(m.ago), isAi ? ts(m.ago - 1) : null, isAi ? (subDef ? subDef.model : agent.model) : null,
          subDef ? ids.subs[sub] : null, subDef ? subDef.label : null, m.parentOf ? ids.msgs[m.parentOf] : null, meta, threadId, steps).lastInsertRowid;
      };
      for (const m of r.messages) ids.msgs[m.id] = insert(m);
      for (const t of r.threads || []) for (const m of t.replies) insert(m, ids.msgs[t.root]);
    }
    if (demo.SKILLS) {
      const addSkill = db.prepare(`INSERT INTO skills (name, description, argument_hint, enabled, created_by_actor_id, current_revision_id, created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?)`);
      const addRev = db.prepare(`INSERT INTO skill_revisions (skill_id, version, body, manifest_hash, total_bytes, file_count, author_actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const s of demo.SKILLS) {
        const creatorId = s.by ? ids.actors[s.by] : null;
        const skillId = addSkill.run(s.name, s.description, s.argument_hint || null, s.enabled, creatorId, ts(1000), ts(100)).lastInsertRowid;
        const hash = crypto.createHash('sha256').update(s.body).digest('hex');
        const revId = addRev.run(skillId, 1, s.body, hash, Buffer.byteLength(s.body), 1, creatorId, ts(1000)).lastInsertRowid;
        db.prepare('UPDATE skills SET current_revision_id=? WHERE id=?').run(revId, skillId);
      }
    }
  })();
  db.close();
  return ids;
}

// Holds a WS open per online agent so the UI shows it as connected. Never answers triggers.
function fakeAgents(port, ids) {
  return demo.AGENTS.filter(a => a.online).map(a => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'agent_connect', actor_id: ids.actors[a.key], secret: ids.secrets[a.key], client_version: '9.9.9', harnesses_available: ['claude'], active_message_ids: [] })));
    ws.on('error', () => {});
    return ws;
  });
}

async function main() {
  const selected = args.only ? SHOTS.filter(s => String(args.only).split(',').includes(s.name)) : SHOTS;
  if (args.list) return console.log(JSON.stringify(SHOTS.map(s => ({ name: s.name, file: s.file, docs: s.docs || [] })), null, 2));
  if (!selected.length) throw new Error(`no shot matches --only=${args.only}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-shots-'));
  fs.writeFileSync(path.join(dir, '.env'), '');
  const password = crypto.randomBytes(18).toString('base64url');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let proc, sockets = [], browser;
  const cleanup = async () => {
    for (const ws of sockets) try { ws.close(); } catch {}
    if (browser) await browser.close().catch(() => {});
    if (proc) await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  process.on('SIGINT', () => cleanup().then(() => process.exit(130)));
  try {
    // First boot builds the schema + migrations and seeds the login; then seed offline and reboot.
    proc = startServer(dir, port, password); await waitHttp(base); await stopServer(proc);
    const ids = seed(path.join(dir, 'stoa.db'));
    proc = startServer(dir, port, password); await waitHttp(base);
    sockets = fakeAgents(port, ids);
    await new Promise(r => setTimeout(r, 800));

    if (args.serve) {
      console.log(JSON.stringify({ url: base, email: 'stoa@stoa.com', password, rooms: ids.rooms }));
      console.log('Ctrl+C to stop and delete the demo.');
      return await new Promise(() => {});
    }

    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ channel: process.env.STOA_PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const results = [];
    for (const shot of selected) {
      const ctx = await browser.newContext({ viewport: shot.viewport || { width: 1440, height: 900 }, deviceScaleFactor: shot.scale || 2, isMobile: !!shot.mobile, hasTouch: !!shot.mobile });
      await ctx.addInitScript(t => { localStorage.setItem('stoa-theme', t); }, shot.theme || 'warm-paper');
      const login = await ctx.request.post(`${base}/api/auth/login`, { data: { email: 'stoa@stoa.com', password }, headers: { Origin: base } });
      if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
      const page = await ctx.newPage();
      await shot.run(page, { base, ids, msgs: ids.msgs, rooms: ids.rooms });
      const file = path.join(OUT_DIR, shot.file);
      await page.screenshot({ path: file, ...(shot.clip ? { clip: shot.clip } : {}) });
      results.push({ name: shot.name, file: path.relative(root, file), bytes: fs.statSync(file).size });
      await ctx.close();
    }
    console.log(JSON.stringify({ ok: true, outDir: path.relative(root, OUT_DIR), shots: results }, null, 2));
  } finally {
    if (!args.serve) await cleanup();
  }
}

main().catch(e => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; });
