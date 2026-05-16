const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { spawnClaude } = require('./claude-adapter');

function getSession(participantId, workdir) {
  if (workdir) {
    const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND workdir=?').get(participantId, workdir);
    return row?.claude_session_id ?? null;
  }
  const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND workdir IS NULL').get(participantId);
  return row?.claude_session_id ?? null;
}

function saveSession(participantId, claudeSessionId, workdir) {
  if (workdir) {
    db.prepare(
      `INSERT INTO ai_sessions (participant_id, claude_session_id, workdir, status) VALUES (?,?,?,'idle')
       ON CONFLICT(participant_id) DO UPDATE SET claude_session_id=excluded.claude_session_id, workdir=excluded.workdir, status='idle', last_active_at=datetime('now')`
    ).run(participantId, claudeSessionId, workdir);
  } else {
    db.prepare(
      `INSERT INTO ai_sessions (participant_id, claude_session_id, status) VALUES (?,?,'idle')
       ON CONFLICT(participant_id) DO UPDATE SET claude_session_id=excluded.claude_session_id, status='idle', last_active_at=datetime('now')`
    ).run(participantId, claudeSessionId);
  }
}

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// Initialize schema on startup
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sqlite.sql'), 'utf8'));

// Add avatar_url column if not exists
try { db.exec("ALTER TABLE actors ADD COLUMN avatar_url TEXT DEFAULT NULL"); } catch {}

// Rebuild FTS index on startup
{
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
}

const PORT = parseInt(process.env.PORT) || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Sync HUMAN_NAME env → human actor on startup (default: "Human")
{
  const humanName = process.env.HUMAN_NAME || 'Human';
  const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
  if (human) db.prepare('UPDATE actors SET name=? WHERE id=?').run(humanName, human.id);
}

// Files yang boleh di-serve sebagai client update
const CLIENT_FILES = new Set(['stoa.js', 'claude-session.js', 'claude-adapter.js', 'claude-adapter-lite.js']);

// One-time install tokens (expires in 10 min)
const installTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, v] of installTokens) if (v.expires < now) installTokens.delete(t);
}, 60_000);

function clientFileHash(name) {
  const fp = path.join(__dirname, name);
  if (!fs.existsSync(fp)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 12);
}
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function getSetting(key, scopeId = null) {
  const scope = scopeId ? 'room' : 'global';
  const row = db.prepare(
    'SELECT value FROM settings WHERE scope=? AND (scope_id=? OR scope_id IS NULL) AND key_name=? ORDER BY scope DESC LIMIT 1'
  ).get(scope, scopeId, key);
  return row?.value ?? null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('global', NULL, ?, ?)
     ON CONFLICT(scope, scope_id, key_name) DO UPDATE SET value=excluded.value`
  ).run(key, value);
}

function getPublicUrl(fallbackHost) {
  const dbVal = getSetting('public_url');
  if (dbVal) return dbVal;
  const envVal = process.env.STOA_PUBLIC_URL;
  if (envVal) {
    try {
      const u = new URL(envVal);
      if (!u.port) u.port = PORT;
      return u.origin;
    } catch { return envVal; }
  }
  return `http://${fallbackHost}`;
}

function writeEnv(key, value) {
  const envFile = path.join(__dirname, '.env');
  let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(envFile, content, 'utf8');
}

function docTitle(filePath) {
  try {
    const first = fs.readFileSync(filePath, 'utf8').split('\n').find(l => l.startsWith('# '));
    return first ? first.slice(2).trim() : path.basename(filePath, '.md');
  } catch { return path.basename(filePath, '.md'); }
}

// Parse "doc-tailscale.en.md" → { slug: "doc-tailscale", lang: "en" }
// Falls back: "doc-tailscale.md" → { slug: "doc-tailscale", lang: "en" }
function parseDocFilename(name) {
  const m = name.match(/^(.+)\.([a-z]{2})\.md$/);
  if (m) return { slug: m[1], lang: m[2] };
  if (name.endsWith('.md')) return { slug: name.slice(0, -3), lang: 'en' };
  return null;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Static: uploaded files
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const relative = path.normalize(url.pathname.slice('/uploads/'.length)).replace(/^(\.\.[\/\\])+/, '');
    const filepath = path.join(UPLOADS_DIR, relative);
    if (!filepath.startsWith(UPLOADS_DIR) || !fs.existsSync(filepath)) { res.writeHead(404); return res.end('Not found'); }
    const filename = path.basename(filepath);
    const ext = path.extname(filename).toLowerCase();
    const MIMES = {
      '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
      '.gif':'image/gif', '.webp':'image/webp',
      '.md':'text/markdown; charset=utf-8', '.txt':'text/plain; charset=utf-8',
      '.pdf':'application/pdf', '.json':'application/json; charset=utf-8',
      '.html':'text/html; charset=utf-8', '.csv':'text/csv; charset=utf-8',
      '.js':'text/javascript; charset=utf-8', '.ts':'text/plain; charset=utf-8',
    };
    const mime = MIMES[ext] || 'application/octet-stream';
    const disp = mime.startsWith('text/') || mime.includes('json') ? 'inline' : 'attachment';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': disp });
    return res.end(fs.readFileSync(filepath));
  }

  // ── Upload file (raw binary)
  if (req.method === 'POST' && url.pathname === '/api/upload/raw') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    const fileName = decodeURIComponent(req.headers['x-file-name'] || 'file');
    const mimeType = req.headers['content-type'] || 'application/octet-stream';
    const origExt = fileName ? path.extname(fileName).toLowerCase() : null;
    const mimeToExt = { 'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp',
      'text/markdown':'.md','text/plain':'.txt','application/pdf':'.pdf','application/json':'.json' };
    const ext = origExt || mimeToExt[mimeType] || '.' + (mimeType.split('/')[1] || 'bin');
    const safeExt = ext.startsWith('.') ? ext : '.' + ext;
    const saved = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, saved), buffer);
    return json(res, { url: `/uploads/${saved}`, name: fileName || saved });
  }

  // ── Upload file (base64 JSON body — legacy)
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const body = await readBody(req);
    const { data, mimeType, fileName } = JSON.parse(body);
    const origExt = fileName ? path.extname(fileName).toLowerCase() : null;
    const mimeToExt = { 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp',
      'text/markdown':'md','text/plain':'txt','application/pdf':'pdf','application/json':'json' };
    const ext = origExt || '.' + (mimeToExt[mimeType] || mimeType.split('/')[1] || 'bin');
    const safeExt = ext.startsWith('.') ? ext : '.' + ext;
    const saved = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, saved), Buffer.from(data, 'base64'));
    return json(res, { url: `/uploads/${saved}`, name: fileName || saved });
  }

  // ── Actor avatar upload
  const avatarUploadMatch = req.method === 'POST' && url.pathname.match(/^\/api\/actors\/(\d+)\/avatar$/);
  if (avatarUploadMatch) {
    const id = parseInt(avatarUploadMatch[1]);
    const body = await readBody(req);
    const { data_url } = JSON.parse(body);
    if (!data_url || !data_url.startsWith('data:image/')) { res.writeHead(400); return res.end('invalid data_url'); }
    const mimeMatch = data_url.match(/^data:(image\/[a-z+]+);base64,/);
    if (!mimeMatch) { res.writeHead(400); return res.end('invalid data_url format'); }
    const mimeType = mimeMatch[1];
    const mimeToExt = { 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp' };
    const ext = mimeToExt[mimeType] || 'png';
    const base64Data = data_url.slice(data_url.indexOf(',') + 1);
    const saved = `avatar-${id}-${Date.now()}.${ext}`;
    const avatarDir = path.join(UPLOADS_DIR, 'avatar');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir);
    fs.writeFileSync(path.join(avatarDir, saved), Buffer.from(base64Data, 'base64'));
    const avatarUrl = `/uploads/avatar/${saved}`;
    db.prepare('UPDATE actors SET avatar_url=? WHERE id=?').run(avatarUrl, id);
    return json(res, { avatar_url: avatarUrl });
  }

  // ── Actor avatar delete
  const avatarDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/actors\/(\d+)\/avatar$/);
  if (avatarDeleteMatch) {
    const id = parseInt(avatarDeleteMatch[1]);
    db.prepare('UPDATE actors SET avatar_url=NULL WHERE id=?').run(id);
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 145"><rect x="15" y="0" width="230" height="10" fill="#2e2820"/><rect x="50" y="60" width="40" height="70" fill="#5b8fd4"/><rect x="110" y="40" width="40" height="90" fill="#8a7660"/><rect x="170" y="20" width="40" height="110" fill="#d39749"/><rect x="15" y="130" width="230" height="10" fill="#2e2820"/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(svg);
  }

  const STATIC_FILES = { '/manifest.json': 'application/manifest+json', '/stoa-icon.svg': 'image/svg+xml', '/sw.js': 'application/javascript' };
  if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
    const filePath = path.join(__dirname, url.pathname.slice(1));
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    const headers = { 'Content-Type': STATIC_FILES[url.pathname] };
    if (url.pathname === '/sw.js') headers['Cache-Control'] = 'no-cache';
    else headers['Cache-Control'] = 'public, max-age=86400';
    res.writeHead(200, headers);
    return res.end(fs.readFileSync(filePath));
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(html);
  }

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const rows = db.prepare(
      'SELECT DISTINCT name, description, scope FROM agent_skills ORDER BY scope, name'
    ).all();
    return json(res, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const rows = db.prepare(`
      SELECT r.*, a.name as creator_name,
        (SELECT COUNT(*) FROM room_participants WHERE room_id=r.id) as participant_count,
        (SELECT COUNT(*) FROM messages WHERE room_id=r.id) as message_count,
        (SELECT m.content FROM messages m WHERE m.room_id=r.id AND m.state='complete' AND m.content != '' ORDER BY m.id DESC LIMIT 1) as last_message,
        (SELECT a2.name FROM messages m2 JOIN room_participants rp ON rp.id=m2.participant_id JOIN actors a2 ON a2.id=rp.actor_id WHERE m2.room_id=r.id AND m2.state='complete' AND m2.content != '' ORDER BY m2.id DESC LIMIT 1) as last_message_actor,
        COALESCE((SELECT m3.created_at FROM messages m3 WHERE m3.room_id=r.id ORDER BY m3.id DESC LIMIT 1), r.created_at) as last_activity
      FROM rooms r JOIN actors a ON a.id=r.created_by ORDER BY last_activity DESC
    `).all();
    return json(res, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const body = await readBody(req);
    const { title, participant_ids = [], workdir_id = null } = JSON.parse(body);
    const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
    const humanId = human?.id ?? 1;
    const result = db.prepare('INSERT INTO rooms (title, created_by, workdir_id) VALUES (?,?,?)').run(title, humanId, workdir_id || null);
    const roomId = result.lastInsertRowid;
    const allIds = [...new Set([humanId, ...participant_ids])];
    const insertParticipant = db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id) VALUES (?,?)');
    for (const actorId of allIds) {
      insertParticipant.run(roomId, actorId);
    }
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
    console.log(`[server] Room created id=${roomId}, broadcasting to ${globalClients.size} clients`);
    broadcastGlobal({ type: 'room_created', room });
    return json(res, room);
  }

  const roomPatchMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomPatchMatch) {
    const roomId = parseInt(roomPatchMatch[1]);
    const body = await readBody(req);
    const { title } = JSON.parse(body);
    if (title) db.prepare('UPDATE rooms SET title=? WHERE id=?').run(title.trim(), roomId);
    broadcastGlobal({ type: 'room_updated', room_id: roomId, title: title.trim() });
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    const roomId = url.searchParams.get('room_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 100);
    if (!q) return json(res, []);
    const rows = db.prepare(`
      SELECT m.id, m.room_id, m.content, m.created_at,
             a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type,
             r.title as room_title,
             snippet(messages_fts, 0, '<mark>', '</mark>', '…', 40) as snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN room_participants rp ON rp.id = m.participant_id
      JOIN actors a ON a.id = rp.actor_id
      JOIN rooms r ON r.id = m.room_id
      WHERE messages_fts MATCH ? AND m.state='complete'
      ${roomId ? 'AND m.room_id = ?' : ''}
      ORDER BY rank
      LIMIT ?
    `).all(...(roomId ? [q, roomId, limit] : [q, limit]));
    return json(res, rows);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/')) {
    const roomId = url.pathname.split('/')[3];

    if (url.pathname.endsWith('/messages')) {
      const enrichReply = rows => {
        const replyIds = [...new Set(rows.filter(r => r.reply_to).map(r => r.reply_to))];
        if (!replyIds.length) return rows;
        const ph = replyIds.map(() => '?').join(',');
        const repliedRows = db.prepare(`SELECT m.id, m.content, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id IN (${ph})`).all(...replyIds);
        const replied = {};
        for (const r of repliedRows) replied[r.id] = r;
        return rows.map(r => r.reply_to && replied[r.reply_to] ? { ...r, reply_msg: replied[r.reply_to] } : r);
      };
      const before = url.searchParams.get('before');
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
      if (before) {
        const rows = db.prepare(`
          SELECT * FROM (
            SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
            FROM messages m
            JOIN room_participants rp ON rp.id=m.participant_id
            JOIN actors a ON a.id=rp.actor_id
            WHERE m.room_id=? AND m.id < ? AND m.state='complete'
              AND (m.content != '' OR m.image_url IS NOT NULL)
            ORDER BY m.created_at DESC LIMIT ?
          ) t ORDER BY created_at ASC
        `).all(roomId, before, limit);
        return json(res, enrichReply(rows));
      }
      const since = url.searchParams.get('since') ?? '0';
      const rows = db.prepare(`
        SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
        FROM messages m
        JOIN room_participants rp ON rp.id=m.participant_id
        JOIN actors a ON a.id=rp.actor_id
        WHERE m.room_id=? AND m.id > ? AND m.state='complete'
          AND (m.content != '' OR m.image_url IS NOT NULL)
        ORDER BY m.created_at ASC
        LIMIT 500
      `).all(roomId, since);
      return json(res, enrichReply(rows));
    }

    if (url.pathname.endsWith('/participants')) {
      const rows = db.prepare(`
        SELECT rp.*, a.name, a.type, a.avatar_color, a.avatar_symbol, a.avatar_url, a.adapter
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=?
      `).all(roomId);
      return json(res, rows);
    }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/participants$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);
    const body = await readBody(req);
    const { actor_id } = JSON.parse(body);
    if (!actor_id) return json(res, { error: 'actor_id required' }, 400);
    const actor = db.prepare('SELECT id, name FROM actors WHERE id=?').get(actor_id);
    if (!actor) return json(res, { error: 'actor not found' }, 404);
    db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id) VALUES (?,?)').run(roomId, actor_id);
    broadcast(roomId, { type: 'participant_joined', actor_id });
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/setup/status') {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    return json(res, { needsSetup: row.cnt === 0 });
  }

  if (req.method === 'POST' && url.pathname === '/api/setup') {
    const { name } = JSON.parse(await readBody(req));
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    if (row.cnt > 0) { res.writeHead(409); return res.end('already set up'); }
    db.prepare(
      `INSERT INTO actors (name, type, avatar_color, avatar_symbol) VALUES (?, 'human', '#8a7660', '◉')`
    ).run(name.trim());
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const host = req.headers.host || `localhost:${PORT}`;
    const human = db.prepare(`SELECT id, name FROM actors WHERE type='human' LIMIT 1`).get();
    return json(res, {
      public_url:  getPublicUrl(host),
      human_name:  human?.name ?? '',
      human_id:    human?.id ?? null,
      port:        PORT,
      human_name_from_env: !!process.env.HUMAN_NAME,
    });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    const body = JSON.parse(await readBody(req));
    if (body.public_url !== undefined) setSetting('public_url', body.public_url.trim());
    if (body.human_name !== undefined) {
      const name = body.human_name.trim() || 'Human';
      writeEnv('HUMAN_NAME', name);
      process.env.HUMAN_NAME = name;
      const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
      if (human) db.prepare('UPDATE actors SET name=? WHERE id=?').run(name, human.id);
    }
    if (body.port !== undefined) {
      const newPort = parseInt(body.port);
      if (newPort && newPort !== PORT && newPort >= 1 && newPort <= 65535) {
        writeEnv('PORT', String(newPort));
        const host = req.headers.host || `localhost:${PORT}`;
        const pubUrl = getPublicUrl(host);
        const newPubUrl = pubUrl.replace(`:${PORT}`, `:${newPort}`);
        const wsProto = newPubUrl.startsWith('https') ? 'wss' : 'ws';
        const newWsUrl = newPubUrl.replace(/^https?/, wsProto);
        broadcastServerRestart(newPort, newWsUrl);
        json(res, { ok: true, restarting: true, new_port: newPort });
        setTimeout(() => process.exit(0), 2000);
        return;
      }
    }
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/actors') {
    const rows = db.prepare('SELECT id, name, type, avatar_color, avatar_symbol, avatar_url, created_at FROM actors ORDER BY id').all();
    const result = rows.map(r => ({ ...r, online: agentClients.has(r.id) }));
    return json(res, result);
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/actors/')) {
    const id = parseInt(url.pathname.split('/')[3]);
    const body = JSON.parse(await readBody(req));
    const { name, avatar_url } = body;
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    if (avatar_url !== undefined) {
      db.prepare('UPDATE actors SET name=?, avatar_url=? WHERE id=?').run(name.trim(), avatar_url, id);
    } else {
      db.prepare('UPDATE actors SET name=? WHERE id=?').run(name.trim(), id);
    }
    const actor = db.prepare('SELECT type FROM actors WHERE id=?').get(id);
    if (actor?.type === 'human') {
      writeEnv('HUMAN_NAME', name.trim());
      process.env.HUMAN_NAME = name.trim();
    }
    return json(res, { id, name: name.trim() });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/actors/')) {
    const id = parseInt(url.pathname.split('/')[3]);
    db.prepare('DELETE FROM actors WHERE id=?').run(id);
    const ws = agentClients.get(id);
    if (ws) { ws.close(); agentClients.delete(id); }
    res.writeHead(204); return res.end();
  }

  // ── Client auto-update API ──
  if (req.method === 'GET' && url.pathname === '/api/client/manifest') {
    const files = {};
    for (const name of CLIENT_FILES) {
      const hash = clientFileHash(name);
      if (hash) files[name] = hash;
    }
    return json(res, { files });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/client/file/')) {
    const name = path.basename(url.pathname.slice('/api/client/file/'.length));
    if (!CLIENT_FILES.has(name)) { res.writeHead(404); return res.end('Not found'); }
    const fp = path.join(__dirname, name);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(fp));
  }

  // ── Docs ──
  if (req.method === 'GET' && url.pathname === '/api/docs') {
    const docsDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(docsDir)) return json(res, []);
    const slugMap = new Map(); // slug → { langs: Set, enFile }
    for (const f of fs.readdirSync(docsDir).sort()) {
      const parsed = parseDocFilename(f);
      if (!parsed) continue;
      if (!slugMap.has(parsed.slug)) slugMap.set(parsed.slug, { langs: new Set(), enFile: null });
      const entry = slugMap.get(parsed.slug);
      entry.langs.add(parsed.lang);
      if (parsed.lang === 'en') entry.enFile = f;
    }
    const result = [];
    for (const [slug, entry] of slugMap) {
      const titleFile = entry.enFile || `${slug}.md`;
      result.push({
        slug,
        title: docTitle(path.join(__dirname, 'docs', titleFile)),
        langs: [...entry.langs].sort(),
      });
    }
    return json(res, result);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/docs/')) {
    const name = path.basename(url.pathname);
    if (!name.endsWith('.md')) { res.writeHead(400); return res.end('md only'); }
    const fp = path.join(__dirname, 'docs', name);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(fp, 'utf8'));
  }

  // ── Agent install script ──
  if (req.method === 'GET' && url.pathname === '/install.sh') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const wsProto = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const stoaUrl = baseUrl.replace(/^https?/, wsProto);
    const token = crypto.randomBytes(12).toString('hex');
    const presetName = url.searchParams.get('name') || '';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName });

    const script = `#!/bin/bash
set -e

BASE_URL="${baseUrl}"
STOA_URL="${stoaUrl}"
REG_TOKEN="${token}"
AGENT_DIR="\${HOME}/stoa-agent"

echo "=== Stoa Agent Setup ==="
echo "Server : \${BASE_URL}"
echo ""

mkdir -p "\${AGENT_DIR}"
mkdir -p "\${HOME}/stoa-workspace"

echo "[1/5] Downloading client files..."
cd "\${AGENT_DIR}"
for FILE in stoa.js claude-session.js claude-adapter.js claude-adapter-lite.js; do
  curl -fsSL "\${BASE_URL}/api/client/file/\${FILE}" -o "\${FILE}"
  echo "  ok \${FILE}"
done

echo "[2/5] Installing dependencies..."
npm init -y > /dev/null 2>&1
npm install ws > /dev/null 2>&1
echo "  ok ws"

echo "[3/5] Registering agent..."
RESPONSE=\$(curl -s -X POST "\${BASE_URL}/api/agent/register" \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\":\\"\${REG_TOKEN}\\"}")
ACTOR_ID=\$(echo "\${RESPONSE}" | grep -o '"actor_id":[0-9]*' | grep -o '[0-9]*')
AGENT_NAME=\$(echo "\${RESPONSE}" | grep -o '"name":"[^"]*"' | sed 's/.*"name":"//;s/".*//')
STOA_SECRET=\$(echo "\${RESPONSE}" | grep -o '"secret":"[^"]*"' | sed 's/.*"secret":"//;s/".*//')
if [ -z "\${ACTOR_ID}" ]; then
  echo "  Registration failed: \${RESPONSE}"
  exit 1
fi
echo "  ok Actor #\${ACTOR_ID} (\${AGENT_NAME})"

echo "[4/5] Approving workspace trust..."
cd "\${HOME}/stoa-workspace"
printf "1\\n" | claude --dangerously-skip-permissions --print -p "hello" > /dev/null 2>&1 || true
cd "\${AGENT_DIR}"

echo "[5/5] Setting up PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2 > /dev/null 2>&1 || npm install -g pm2 > /dev/null 2>&1
fi

cat > ecosystem.config.js << EOFCFG
module.exports = {
  apps: [{
    name: '\${AGENT_NAME}',
    script: 'stoa.js',
    cwd: process.env.HOME + '/stoa-agent',
    env: {
      STOA_URL: '\${STOA_URL}',
      STOA_TYPE: 'ai',
      STOA_ACTOR_ID: '\${ACTOR_ID}',
      STOA_SECRET: '\${STOA_SECRET}',
      STOA_WORK_DIR: process.env.HOME + '/stoa-workspace',
    },
    restart_delay: 3000,
    max_restarts: 50,
    autorestart: true,
  }]
};
EOFCFG

pm2 stop "\${AGENT_NAME}" 2>/dev/null || true
pm2 delete "\${AGENT_NAME}" 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup 2>/dev/null | grep -E "sudo|^[A-Z]" | head -1 | bash 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Actor  : #\${ACTOR_ID} (\${AGENT_NAME})"
echo "Status : pm2 status"
echo "Logs   : pm2 logs \${AGENT_NAME}"
`;

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Windows PowerShell installer ──
  if (req.method === 'GET' && url.pathname === '/install.ps1') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const wsProto = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const stoaUrl = baseUrl.replace(/^https?/, wsProto);
    const token = crypto.randomBytes(12).toString('hex');
    const presetName = url.searchParams.get('name') || '';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName });

    const script = `$ErrorActionPreference = "Stop"
$BaseUrl = "${baseUrl}"
$StoaUrl = "${stoaUrl}"
$RegToken = "${token}"
$AgentDir = "$env:USERPROFILE\\stoa-agent"
$WorkDir  = "$env:USERPROFILE\\stoa-workspace"

Write-Host "=== Stoa Agent Setup ==="
Write-Host "Server : $BaseUrl"
Write-Host ""

New-Item -ItemType Directory -Force $AgentDir | Out-Null
New-Item -ItemType Directory -Force $WorkDir  | Out-Null

Write-Host "[1/5] Downloading client files..."
foreach ($file in @("stoa.js","claude-session.js","claude-adapter.js","claude-adapter-lite.js")) {
  Invoke-WebRequest "$BaseUrl/api/client/file/$file" -OutFile "$AgentDir\\$file" -UseBasicParsing
  Write-Host "  ok $file"
}

Write-Host "[2/5] Installing dependencies..."
Set-Location $AgentDir
npm init -y 2>&1 | Out-Null
npm install ws 2>&1 | Out-Null
Write-Host "  ok ws"

Write-Host "[3/5] Registering agent..."
$body = '{"token":"' + $RegToken + '"}'
$resp = Invoke-RestMethod -Uri "$BaseUrl/api/agent/register" -Method Post -ContentType "application/json" -Body $body
$ActorId   = $resp.actor_id
$AgentName = $resp.name
$Secret    = $resp.secret
if (-not $ActorId) { Write-Error "Registration failed"; exit 1 }
Write-Host "  ok Actor #$ActorId ($AgentName)"

Write-Host "[4/5] Approving workspace trust..."
Set-Location $WorkDir
"1" | & claude --dangerously-skip-permissions --print -p "hello" 2>$null
Set-Location $AgentDir

Write-Host "[5/5] Setting up PM2..."
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2 }

@"
module.exports = {
  apps: [{
    name: '$AgentName',
    script: 'stoa.js',
    cwd: require('os').homedir() + '/stoa-agent',
    env: {
      STOA_URL: '$StoaUrl',
      STOA_TYPE: 'ai',
      STOA_ACTOR_ID: String($ActorId),
      STOA_SECRET: '$Secret',
      STOA_WORK_DIR: require('os').homedir() + '/stoa-workspace',
    },
    restart_delay: 3000,
    max_restarts: 50,
    autorestart: true,
  }]
};
"@ | Out-File -Encoding utf8 "$AgentDir\\ecosystem.config.js"

try { pm2 stop $AgentName 2>$null } catch {}
try { pm2 delete $AgentName 2>$null } catch {}
pm2 start "$AgentDir\\ecosystem.config.js"
pm2 save

Write-Host ""
Write-Host "=== Done ==="
Write-Host "Actor  : #$ActorId ($AgentName)"
Write-Host "Status : pm2 status"
Write-Host "Logs   : pm2 logs $AgentName"
`;

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Windows CMD installer (proxies to PS1) ──
  if (req.method === 'GET' && url.pathname === '/install.cmd') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const nameParam = url.searchParams.get('name') ? `?name=${encodeURIComponent(url.searchParams.get('name'))}` : '';
    const script = `@echo off\r\npowershell -ExecutionPolicy Bypass -Command "irm ${baseUrl}/install.ps1${nameParam} | iex"\r\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Agent registration ──
  if (req.method === 'POST' && url.pathname === '/api/agent/register') {
    const body = await readBody(req);
    const { token } = JSON.parse(body);
    const entry = installTokens.get(token);
    if (!entry || entry.expires < Date.now()) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'invalid or expired token' }));
    }
    installTokens.delete(token);
    const suffix = crypto.randomBytes(3).toString('hex');
    const name = (entry.name || '').trim() || `stoa-${suffix}`;
    const secret = crypto.randomBytes(32).toString('hex');
    const result = db.prepare(
      `INSERT INTO actors (name, type, avatar_color, avatar_symbol, secret) VALUES (?, 'ai', '#4d9f9f', '◈', ?)`
    ).run(name, secret);
    return json(res, { actor_id: result.lastInsertRowid, name, secret });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/invites/') && url.pathname.endsWith('/resolve')) {
    const inviteId = url.pathname.split('/')[3];
    const body = await readBody(req);
    const { approved } = JSON.parse(body);
    const status = approved ? 'approved' : 'rejected';
    db.prepare("UPDATE invite_suggestions SET status=?, resolved_at=datetime('now') WHERE id=?").run(status, inviteId);

    if (approved) {
      const invite = db.prepare('SELECT * FROM invite_suggestions WHERE id=?').get(inviteId);
      db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id, invited_by) VALUES (?,?,?)').run(
        invite.room_id, invite.suggested_actor_id, invite.suggested_by_participant_id
      );
      broadcast(invite.room_id, { type: 'participant_joined', actor_id: invite.suggested_actor_id });
    }
    return json(res, { ok: true });
  }

  // GET /api/actors/:id/workdirs — list workdirs for an agent
  if (req.method === 'GET' && url.pathname.match(/^\/api\/actors\/\d+\/workdirs$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const rows = db.prepare(
      'SELECT id, path, label, is_default FROM agent_workdirs WHERE actor_id=? ORDER BY is_default DESC, id ASC'
    ).all(actorId);
    return json(res, rows);
  }

  // POST /api/actors/:id/workdirs — request agent to create a new workdir
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/workdirs$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const { path: dirPath, label } = JSON.parse(await readBody(req));
    if (!dirPath?.trim()) { res.writeHead(400); return res.end('path required'); }
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'create_workdir', path: dirPath.trim() }));
    const result = db.prepare(
      'INSERT OR IGNORE INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0)'
    ).run(actorId, dirPath.trim(), (label || '').trim() || null);
    return json(res, { id: result.lastInsertRowid, path: dirPath.trim(), label: label || null, is_default: false });
  }

  // POST /api/actors/:id/force-update — ask agent to check for updates immediately
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/force-update$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'force_update' }));
    return json(res, { ok: true });
  }

  // POST /api/actors/:id/rescan — ask agent to re-scan workdirs & skills
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/rescan$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'request_scan' }));
    return json(res, { ok: true });
  }

  // GET /api/actors/:id/skills — list skills for an agent
  if (req.method === 'GET' && url.pathname.match(/^\/api\/actors\/\d+\/skills$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const rows = db.prepare(
      'SELECT s.*, w.path as workdir_path FROM agent_skills s LEFT JOIN agent_workdirs w ON w.id=s.workdir_id WHERE s.actor_id=? ORDER BY s.scope, s.name'
    ).all(actorId);
    return json(res, rows);
  }

  res.writeHead(404);
  res.end('Not found');
  } catch (err) {
    console.error('[http] unhandled error:', err.message);
    if (!res.headersSent) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, pingInterval: 20000 });
const roomClients = new Map();    // roomId → Set<ws>
const globalClients = new Set();  // all browser ws connections
const agentClients = new Map();   // actor_id → ws
const pendingAgents = new Map();    // message_id → { resolve, reject }
const pendingActorMeta = new Map(); // message_id → { name, avatar_color, avatar_symbol }

function broadcastGlobal(data) {
  const str = JSON.stringify(data);
  for (const client of globalClients) {
    if (client.readyState === 1) client.send(str);
  }
}

function broadcastServerRestart(newPort, newWsUrl) {
  const payload = JSON.stringify({ type: 'server_restart', new_port: newPort, new_ws_url: newWsUrl });
  for (const client of globalClients) {
    if (client.readyState === 1) client.send(payload);
  }
  for (const [, agentWs] of agentClients) {
    if (agentWs.readyState === 1) agentWs.send(payload);
  }
  console.log(`[server] Port change → ${newPort}, notified ${globalClients.size} browsers + ${agentClients.size} agents`);
}

wss.on('connection', ws => {
  let subscribedRoom = null;
  let agentActorId = null;
  let isHumanClient = false;

  ws.on('error', () => {}); // prevent unhandled error crash on abrupt disconnect

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Human client subscribes to global events (sent on WS open)
    if (msg.type === 'subscribe_global') {
      if (!isHumanClient) { isHumanClient = true; globalClients.add(ws); }
    }

    // ── Human client joins a room
    if (msg.type === 'join_room') {
      if (!isHumanClient) { isHumanClient = true; globalClients.add(ws); }
      subscribedRoom = msg.room_id;
      if (!roomClients.has(subscribedRoom)) roomClients.set(subscribedRoom, new Set());
      roomClients.get(subscribedRoom).add(ws);
      const messages = db.prepare(`
        SELECT * FROM (
          SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
          FROM messages m
          JOIN room_participants rp ON rp.id=m.participant_id
          JOIN actors a ON a.id=rp.actor_id
          WHERE m.room_id=? AND m.state IN ('complete','streaming','requesting')
            AND (m.content != '' OR m.image_url IS NOT NULL OR m.state IN ('streaming','requesting'))
          ORDER BY m.created_at DESC LIMIT 100
        ) AS recent ORDER BY created_at ASC
      `).all(subscribedRoom);
      ws.send(JSON.stringify({ type: 'history', messages }));
    }

    if (msg.type === 'send_message') {
      if (msg.content?.startsWith('/')) {
        await handleSkillCommand(msg.room_id, msg.content, ws);
      } else {
        await handleHumanMessage(msg.room_id, msg.content, msg.imageUrl || null, msg.fileUrl || null, msg.fileName || null, msg.reply_to || null, ws);
      }
    }

    if (msg.type === 'stop_generation') {
      // Cancel the active sequence for this room
      const seq = activeSequences.get(msg.room_id);
      if (seq) seq.cancelled = true;

      const msgRow = db.prepare(
        'SELECT rp.actor_id FROM messages m JOIN room_participants rp ON rp.id=m.participant_id WHERE m.id=?'
      ).get(msg.message_id);
      if (msgRow) {
        const agentWs = agentClients.get(msgRow.actor_id);
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: 'cancel_generation', message_id: msg.message_id, room_id: msg.room_id }));
        }
      }
    }

    if (msg.type === 'invite_suggest' && agentActorId) {
      await handleInviteSuggest(msg.room_id, msg.suggested_by_participant_id, msg.suggested_actor_id, msg.reason);
    }

    // ── AI agent connects and identifies itself
    if (msg.type === 'agent_connect') {
      const actor = db.prepare(`SELECT id, secret FROM actors WHERE id=? AND type='ai'`).get(msg.actor_id);
      if (!actor) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'actor not found' }));
        ws.close(); return;
      }
      if (actor.secret) {
        const provided = String(msg.secret || '');
        const valid = provided.length === actor.secret.length &&
          crypto.timingSafeEqual(Buffer.from(actor.secret), Buffer.from(provided));
        if (!valid) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'invalid secret' }));
          ws.close(); return;
        }
      }
      agentActorId = msg.actor_id;
      agentClients.set(agentActorId, ws);
      console.log(`[agent] Actor #${agentActorId} connected`);
      ws.send(JSON.stringify({ type: 'agent_ready' }));
      const connectedActor = db.prepare('SELECT id, name, type, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(agentActorId);
      if (connectedActor) broadcastGlobal({ type: 'actor_status', actor: { ...connectedActor, online: true } });
    }

    // ── Agent reports scan results
    if (msg.type === 'agent_scan_result' && agentActorId) {
      const { workdirs = [], globalSkills = [] } = msg;
      // UPSERT workdirs — preserve IDs so room references stay valid
      const upsertWorkdir = db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,?) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label, is_default=excluded.is_default'
      );
      const getWorkdirId = db.prepare(
        'SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?'
      );
      const insertSkill = db.prepare(
        'INSERT OR IGNORE INTO agent_skills (actor_id, workdir_id, name, description, scope) VALUES (?,?,?,?,?)'
      );
      const deleteWorkdirSkills = db.prepare(
        'DELETE FROM agent_skills WHERE actor_id=? AND workdir_id=?'
      );
      const scannedPaths = new Set();
      for (const wd of workdirs) {
        const label = wd.path.split(/[\/\\]/).pop() || wd.path;
        upsertWorkdir.run(agentActorId, wd.path, label, wd.is_default ? 1 : 0);
        const row = getWorkdirId.get(agentActorId, wd.path);
        scannedPaths.add(wd.path);
        deleteWorkdirSkills.run(agentActorId, row.id);
        for (const sk of (wd.skills || [])) {
          insertSkill.run(agentActorId, row.id, sk.name, sk.description || null, sk.scope || 'project');
        }
      }
      // Remove workdirs no longer reported (only if not referenced by any room)
      const staleWds = db.prepare('SELECT id, path FROM agent_workdirs WHERE actor_id=?').all(agentActorId);
      const staleIds = staleWds.filter(wd => !scannedPaths.has(wd.path)).map(wd => wd.id);
      if (staleIds.length) {
        const inUseIds = new Set(
          db.prepare(`SELECT DISTINCT workdir_id FROM rooms WHERE workdir_id IN (${staleIds.map(() => '?').join(',')})`)
            .all(...staleIds).map(r => r.workdir_id)
        );
        const toDelete = staleIds.filter(id => !inUseIds.has(id));
        if (toDelete.length) {
          const ph = toDelete.map(() => '?').join(',');
          db.prepare(`DELETE FROM agent_skills WHERE workdir_id IN (${ph})`).run(...toDelete);
          db.prepare(`DELETE FROM agent_workdirs WHERE id IN (${ph})`).run(...toDelete);
        }
      }
      // Insert global skills
      db.prepare('DELETE FROM agent_skills WHERE actor_id=? AND workdir_id IS NULL').run(agentActorId);
      for (const sk of globalSkills) {
        insertSkill.run(agentActorId, null, sk.name, sk.description || null, 'global');
      }
      console.log(`[agent] Actor #${agentActorId} reported ${workdirs.length} workdirs, ${globalSkills.length} global skills`);
    }

    // ── Agent streams a token
    if (msg.type === 'agent_token' && agentActorId) {
      broadcast(msg.room_id, { type: 'message_token', message_id: msg.message_id, token: msg.token });
    }

    // ── Agent reports a tool call
    if (msg.type === 'agent_tool' && agentActorId) {
      broadcast(msg.room_id, { type: 'message_tool', message_id: msg.message_id, tool: msg.tool });
    }

    // ── Agent reports state change (requesting / streaming)
    if (msg.type === 'agent_state' && agentActorId) {
      const actorMeta = pendingActorMeta.get(msg.message_id) || {};
      broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: msg.state, ...actorMeta });
    }

    // ── Agent finished responding
    if (msg.type === 'agent_complete' && agentActorId) {
      if (!msg.content?.trim()) {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msg.message_id);
        broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: 'error' });
        pendingAgents.get(msg.message_id)?.resolve('');
        pendingAgents.delete(msg.message_id);
        pendingActorMeta.delete(msg.message_id);
        return;
      }
      db.prepare(
        "UPDATE messages SET content=?, file_url=?, file_name=?, state='complete', completed_at=datetime('now') WHERE id=?"
      ).run(msg.content, msg.file_url || null, msg.file_name || null, msg.message_id);
      if (msg.claude_session_id) {
        const row = db.prepare(`
          SELECT m.participant_id, w.path as workdir
          FROM messages m JOIN rooms r ON r.id=m.room_id LEFT JOIN agent_workdirs w ON w.id=r.workdir_id
          WHERE m.id=?
        `).get(msg.message_id);
        if (row) saveSession(row.participant_id, msg.claude_session_id, row.workdir);
      }
      const completePayload = { type: 'message_complete', message_id: msg.message_id, content: msg.content };
      if (msg.file_url) { completePayload.file_url = msg.file_url; completePayload.file_name = msg.file_name; }
      broadcast(msg.room_id, completePayload);
      broadcastGlobal({ type: 'room_activity', room_id: msg.room_id });
      pendingAgents.get(msg.message_id)?.resolve(msg.content);
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }

    // ── Agent error
    if (msg.type === 'agent_error' && agentActorId) {
      db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msg.message_id);
      broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: 'error' });
      pendingAgents.get(msg.message_id)?.reject(new Error(msg.error));
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }
  });

  ws.on('close', () => {
    if (subscribedRoom) roomClients.get(subscribedRoom)?.delete(ws);
    if (isHumanClient) globalClients.delete(ws);
    if (agentActorId) {
      agentClients.delete(agentActorId);
      const cleaned = db.prepare(
        "UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — agent disconnected)' ELSE content END WHERE state IN ('streaming','requesting') AND participant_id IN (SELECT rp.id FROM room_participants rp WHERE rp.actor_id=?)"
      ).run(agentActorId);
      if (cleaned.changes) console.log(`[agent] Cleaned ${cleaned.changes} orphaned message(s) from Actor #${agentActorId}`);
      console.log(`[agent] Actor #${agentActorId} disconnected`);
      broadcastGlobal({ type: 'actor_status', actor: { id: agentActorId, online: false } });
    }
  });
});

// ─── Message handling ─────────────────────────────────────────────────────────

function resolveAgentOrder(content, agents) {
  const mentions = [];
  for (const agent of agents) {
    const idx = content.indexOf('@' + agent.name);
    if (idx !== -1) mentions.push({ agent, idx });
  }
  if (mentions.length > 0) {
    mentions.sort((a, b) => a.idx - b.idx);
    return mentions.map(m => m.agent);
  }
  // No mentions → shuffle all agents
  const shuffled = [...agents];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const activeSequences = new Map(); // roomId → { cancelled: bool }

async function triggerAgentsSequential(roomId, agents, content, replyTo, imageUrl, fileUrl, fileName) {
  const maxTurns = parseInt(process.env.MAX_AI_TURNS || '5');
  const seq = { cancelled: false };
  activeSequences.set(roomId, seq);
  let turnCount = 0;

  for (let i = 0; i < Math.min(agents.length, maxTurns); i++) {
    if (seq.cancelled) break;
    turnCount++;
    const currentAgent = agents[i];
    await triggerAiResponse(roomId, currentAgent, content, replyTo, imageUrl, fileUrl, fileName);
    if (seq.cancelled) break;

    const lastMsg = db.prepare(`
      SELECT m.content FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      WHERE rp.actor_id=? AND m.room_id=? AND m.state='complete'
      ORDER BY m.id DESC LIMIT 1
    `).get(currentAgent.actor_id, roomId);

    if (lastMsg?.content) {
      const allAiInRoom = db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
      `).all(roomId);
      for (const other of allAiInRoom) {
        if (other.actor_id !== currentAgent.actor_id && lastMsg.content.includes('@' + other.name)) {
          const alreadyQueued = agents.slice(i + 1).some(a => a.actor_id === other.actor_id);
          if (!alreadyQueued) agents.push(other);
        }
      }

      if (i < agents.length - 1) {
        content = content + '\n\n' + `[${agents[i].name} sudah merespons: ${lastMsg.content}]`;
      }
    }

    if (turnCount >= maxTurns) break;
  }

  activeSequences.delete(roomId);
}

async function handleHumanMessage(roomId, content, imageUrl, fileUrl, fileName, replyTo, senderWs) {
  // Get Ahmad's participant ID
  const parts = db.prepare(
    "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
  ).all(roomId);
  if (!parts.length) return;
  const humanParticipantId = parts[0].id;

  // Save human message
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, image_url, file_url, file_name, reply_to, state) VALUES (?,?,?,?,?,?,?,'complete')`
  ).run(roomId, humanParticipantId, content, imageUrl || null, fileUrl || null, fileName || null, replyTo || null);
  const messageId = result.lastInsertRowid;

  // Get message with actor info for broadcast
  const row = db.prepare(`
    SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
    FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
    WHERE m.id=?`).get(messageId);
  if (row.reply_to) {
    const replied = db.prepare(`SELECT m.id, m.content, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id=?`).get(row.reply_to);
    if (replied) row.reply_msg = replied;
  }
  broadcast(roomId, { type: 'message_new', message: row });
  broadcastGlobal({ type: 'room_activity', room_id: roomId });

  const allAiParts = db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
  `).all(roomId);

  if (allAiParts.length > 0) {
    const ordered = resolveAgentOrder(content, allAiParts);
    triggerAgentsSequential(roomId, ordered, content, messageId, imageUrl, fileUrl, fileName);
  }
}

async function handleSkillCommand(roomId, rawCommand, senderWs) {
  // Parse: /skill-name [ai-name]
  const parts = rawCommand.slice(1).trim().split(/\s+/);
  const skillName = parts[0].toLowerCase();
  const targetName = parts.slice(1).join(' ').trim().toLowerCase() || null;

  // Cari AI target di room
  const allAis = targetName
    ? db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai' AND LOWER(a.name)=?
      `).all(roomId, targetName)
    : db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai'
      `).all(roomId);

  if (!allAis.length) {
    const msg = targetName
      ? `AI "${targetName}" tidak ada di room ini.`
      : 'Tidak ada AI di room ini.';
    senderWs.send(JSON.stringify({ type: 'system_notice', text: msg }));
    return;
  }

  // Check skill exists for at least one of the target AIs
  const aiIds = allAis.map(a => a.actor_id);
  const placeholders = aiIds.map(() => '?').join(',');
  const skill = db.prepare(
    `SELECT 1 FROM agent_skills WHERE name=? AND actor_id IN (${placeholders}) LIMIT 1`
  ).get(skillName, ...aiIds);

  if (!skill) {
    senderWs.send(JSON.stringify({
      type: 'system_notice',
      text: `Skill /${skillName} tidak ditemukan. Ketik / untuk melihat daftar skill.`,
    }));
    return;
  }

  // Broadcast notice bahwa skill dipanggil
  broadcast(roomId, {
    type: 'skill_invoked',
    skill_name: skillName,
    targets: allAis.map(a => a.name),
  });

  // Send skill invocation as prompt — agent's Claude Code session handles the skill
  const promptText = `/${skillName}`;

  for (const ai of allAis) {
    await triggerSkillResponse(roomId, ai, promptText);
  }
}

async function triggerSkillResponse(roomId, ai, prompt) {
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,'','streaming')`
  ).run(roomId, ai.participant_id);
  const msgId = result.lastInsertRowid;

  // Resolve workdir: use room's workdir only if it belongs to this agent, else agent's default
  const wdRow = db.prepare(
    'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
  ).get(roomId);
  const defaultWd = db.prepare(
    'SELECT path FROM agent_workdirs WHERE actor_id=? AND is_default=1 LIMIT 1'
  ).get(ai.actor_id);
  const workdir = (wdRow?.path && wdRow.actor_id === ai.actor_id) ? wdRow.path : (defaultWd?.path || null);
  const sessionId = getSession(ai.participant_id, workdir);

  broadcast(roomId, {
    type: 'message_state',
    message_id: msgId,
    actor_name: ai.name,
    avatar_color: ai.avatar_color,
    avatar_symbol: ai.avatar_symbol,
    avatar_url: ai.avatar_url || null,
    state: 'streaming',
  });

  const agentWs = agentClients.get(ai.actor_id);

  if (agentWs && agentWs.readyState === 1) {
    await new Promise((resolve, reject) => {
      pendingAgents.set(msgId, { resolve, reject });
      pendingActorMeta.set(msgId, { actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      agentWs.send(JSON.stringify({
        type: 'agent_trigger',
        room_id: roomId,
        message_id: msgId,
        participant_id: ai.participant_id,
        claude_session_id: sessionId,
        prompt,
        workdir: workdir || undefined,
      }));
    });
  } else {
    const meta = { actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null };
    let fullContent = '';
    try {
      await spawnClaude({
        prompt,
        onToken: token => {
          fullContent += token;
          broadcast(roomId, { type: 'message_token', message_id: msgId, token });
        },
        onState: state => {
          broadcast(roomId, { type: 'message_state', message_id: msgId, state, ...meta });
        },
        onTool: tool => {
          broadcast(roomId, { type: 'message_tool', message_id: msgId, tool });
        },
      });
      if (!fullContent.trim()) {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
        return;
      }
      db.prepare("UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?").run(fullContent, msgId);
      broadcast(roomId, { type: 'message_complete', message_id: msgId, content: fullContent });
    } catch {
      db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
      broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
    }
  }
}

async function triggerAiResponse(roomId, ai, prompt, replyTo, imageUrl = null, fileUrl = null, fileName = null) {

  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, state, reply_to) VALUES (?,?,'','streaming',?)`
  ).run(roomId, ai.participant_id, replyTo);
  const msgId = result.lastInsertRowid;

  broadcast(roomId, {
    type: 'message_state',
    message_id: msgId,
    actor_name: ai.name,
    avatar_color: ai.avatar_color,
    avatar_symbol: ai.avatar_symbol,
    avatar_url: ai.avatar_url || null,
    state: 'streaming',
  });

  const agentWs = agentClients.get(ai.actor_id);
  console.log(`[trigger] ${ai.name} actor_id=${ai.actor_id} agentConnected=${!!agentWs} readyState=${agentWs?.readyState}`);

  // Build context-aware prompt
  const history = db.prepare(`
    SELECT a.name, m.content, m.image_url, m.file_url, m.file_name FROM messages m
    JOIN room_participants rp ON rp.id=m.participant_id
    JOIN actors a ON a.id=rp.actor_id
    WHERE m.room_id=? AND m.state='complete' ORDER BY m.created_at DESC LIMIT 10
  `).all(roomId);
  const ctx = history.reverse().map(r => {
    let line = `[${r.name}]: ${r.content || ''}`;
    if (r.image_url) line += ' [mengirim gambar]';
    if (r.file_name) line += ` [melampirkan file: ${r.file_name}]`;
    return line;
  }).join('\n');

  const otherAIs = db.prepare(`
    SELECT a.name FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.id != ? AND a.type='ai'
  `).all(roomId, ai.actor_id);
  const otherAINames = otherAIs.map(p => p.name);
  const humanParts = db.prepare(`
    SELECT a.name FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
    WHERE rp.room_id=? AND a.type='human'
  `).all(roomId);
  const allOtherNames = [...humanParts.map(p => p.name), ...otherAINames];
  const othersLine = allOtherNames.length
    ? `Peserta lain di room ini: ${allOtherNames.join(', ')}.`
    : '';

  let replyCtx = '';
  if (replyTo) {
    const replied = db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo);
    if (replied) replyCtx = `\n[Pesan ini adalah reply ke pesan ${replied.name}: "${replied.content?.substring(0, 500)}"]\n`;
  }

  const fullPrompt = [
    `Kamu adalah ${ai.name}. Kamu sedang dalam percakapan di platform Stoa.`,
    othersLine,
    `\nRiwayat percakapan:\n${ctx}`,
    replyCtx,
    `\nBalas pesan terakhir secara natural dan langsung. Tidak perlu mention manusia (@nama) karena mereka pasti membaca.`,
    otherAINames.length
      ? `Jika ingin bicara ke AI lain, gunakan @NamaMereka (contoh: ${otherAINames.map(n => '@' + n).join(' atau ')}). Mention akan otomatis memicu mereka untuk merespons.`
      : '',
    `\nJika diminta mengirim file, sertakan marker [send:path/to/file] di response. Path harus absolute. Sistem akan otomatis upload dan menampilkan file di chat.`,
  ].filter(Boolean).join('\n');

  // Resolve workdir: use room's workdir only if it belongs to this agent, else agent's default
  const wdRow = db.prepare(
    'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
  ).get(roomId);
  const defaultWd = db.prepare(
    'SELECT path FROM agent_workdirs WHERE actor_id=? AND is_default=1 LIMIT 1'
  ).get(ai.actor_id);
  const workdir = (wdRow?.path && wdRow.actor_id === ai.actor_id) ? wdRow.path : (defaultWd?.path || null);

  if (agentWs && agentWs.readyState === 1) {
    // ── Route to connected agent client
    const sessionId = getSession(ai.participant_id, workdir);
    await new Promise((resolve, reject) => {
      pendingAgents.set(msgId, { resolve, reject });
      pendingActorMeta.set(msgId, { actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      agentWs.send(JSON.stringify({
        type: 'agent_trigger',
        room_id: roomId,
        message_id: msgId,
        participant_id: ai.participant_id,
        claude_session_id: sessionId,
        prompt: fullPrompt,
        imageUrl: imageUrl  || undefined,
        fileUrl:  fileUrl   || undefined,
        fileName: fileName  || undefined,
        workdir: workdir    || undefined,
      }));
      console.log(`[trigger] sent to ${ai.name} agent, msgId=${msgId}`);
    });

  } else {
    // ── Fallback: spawn claude directly (no agent connected)
    console.log(`[trigger] ${ai.name} fallback to direct spawn`);
    let fullContent = '';
    const sessionId = getSession(ai.participant_id, workdir);

    try {
      const imageFilePath = imageUrl ? path.join(__dirname, imageUrl) : null;
      const TEXT_EXTS = new Set(['.md','.txt','.json','.csv','.html','.js','.ts','.py','.yaml','.yml','.sh','.css']);
      let spawnPrompt = fullPrompt;
      if (fileUrl && fileName && TEXT_EXTS.has(path.extname(fileName).toLowerCase())) {
        const filePath = path.join(__dirname, fileUrl);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          spawnPrompt = `${fullPrompt}\n\n---\nIsi file \`${fileName}\`:\n\`\`\`\n${fileContent}\n\`\`\``;
        }
      }
      const finalSessionId = await spawnClaude({
        prompt: spawnPrompt,
        sessionId,
        imageFilePath,
        onToken: token => {
          fullContent += token;
          broadcast(roomId, { type: 'message_token', message_id: msgId, token });
        },
        onState: state => {
          broadcast(roomId, { type: 'message_state', message_id: msgId, state });
        },
        onTool: tool => {
          broadcast(roomId, { type: 'message_tool', message_id: msgId, tool });
        },
      });

      if (!fullContent.trim()) {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
        return;
      }
      saveSession(ai.participant_id, finalSessionId, workdir);
      db.prepare(
        "UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?"
      ).run(fullContent, msgId);
      broadcast(roomId, { type: 'message_complete', message_id: msgId, content: fullContent });

    } catch (err) {
      db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
      broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
    }
  }
}


async function handleInviteSuggest(roomId, byParticipantId, suggestedActorId, reason) {
  const result = db.prepare(
    'INSERT INTO invite_suggestions (room_id, suggested_by_participant_id, suggested_actor_id, reason) VALUES (?,?,?,?)'
  ).run(roomId, byParticipantId, suggestedActorId, reason);
  const actor = db.prepare('SELECT name, avatar_symbol FROM actors WHERE id=?').get(suggestedActorId);
  broadcast(roomId, {
    type: 'invite_suggestion',
    invite_id: result.lastInsertRowid,
    suggested_actor: actor,
    reason,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function broadcast(roomId, data) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', c => {
      bytes += c.length;
      if (bytes > maxBytes) { req.destroy(); reject(new Error('Request body too large')); return; }
      body += c;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── Idle session cleanup ─────────────────────────────────────────────────────

setInterval(() => {
  const timeout = parseInt(getSetting('idle_timeout_seconds') ?? '300');
  db.prepare(
    "UPDATE ai_sessions SET status='idle' WHERE status='active' AND last_active_at < datetime('now', '-' || ? || ' seconds')"
  ).run(timeout);
}, 60_000);

// On startup: orphaned streaming/requesting messages are dead — mark them as error
const orphaned = db.prepare("UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — server restart)' ELSE content END WHERE state IN ('streaming','requesting')").run();
if (orphaned.changes) console.log(`[startup] Cleaned ${orphaned.changes} orphaned message(s)`);

server.listen(PORT, () => {
  console.log(`Stoa running → http://localhost:${PORT}`);
});
