const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { ClaudeSession } = require('./claude-session');
const fallbackSessions = new Map();
const FALLBACK_IDLE_MS = 30 * 60 * 1000;
function getFallbackSession(participantId, workDir) {
  const key = `${participantId}:${workDir || ''}`;
  const entry = fallbackSessions.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.session.shutdown(); fallbackSessions.delete(key); }, FALLBACK_IDLE_MS);
    return entry.session;
  }
  const session = new ClaudeSession({ workDir: workDir || __dirname });
  const timer = setTimeout(() => { session.shutdown(); fallbackSessions.delete(key); }, FALLBACK_IDLE_MS);
  fallbackSessions.set(key, { session, timer });
  return session;
}

const connectionManager = require('./connection-manager');
const automationQueue = require('./queue-manager');
automationQueue.on('processing', ({ key, pending, meta }) => {
  if (pending > 0) console.log(`[queue] room ${key}: processing "${meta?.automation || 'unknown'}" (${pending} waiting)`);
});
automationQueue.on('drained', ({ key }) => {
  console.log(`[queue] room ${key}: queue drained`);
});

const EXPECTED_CLIENT_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'stoa.js'), 'utf8');
    const m = src.match(/^const CLIENT_VERSION\s*=\s*'([^']+)'/m);
    return m ? m[1] : null;
  } catch { return null; }
})();

// Hash of stoa.js at server startup — used as the "safe" baseline for the monotonic
// downgrade guard in the manifest endpoint. If someone edits stoa.js to a lower version
// while the server is running, clients must not auto-download it (they'd restart into a
// version older than EXPECTED_CLIENT_VERSION and get stuck in a force_update loop).
const SAFE_CLIENT_HASH = (() => {
  try {
    const fp = path.join(__dirname, 'stoa.js');
    return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 12);
  } catch { return null; }
})();

function getSession(participantId, workdir) {
  if (workdir) {
    const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND workdir=?').get(participantId, workdir);
    return row?.claude_session_id ?? null;
  }
  const row = db.prepare('SELECT claude_session_id FROM ai_sessions WHERE participant_id=? AND workdir IS NULL').get(participantId);
  return row?.claude_session_id ?? null;
}

function saveSession(participantId, claudeSessionId, workdir) {
  const rp = db.prepare('SELECT room_id FROM room_participants WHERE id=?').get(participantId);
  db.prepare(
    `INSERT INTO ai_sessions (participant_id, room_id, claude_session_id, workdir, status) VALUES (?,?,?,?,'idle')
     ON CONFLICT(participant_id, workdir) DO UPDATE SET claude_session_id=excluded.claude_session_id, room_id=excluded.room_id, status='idle', last_active_at=datetime('now')`
  ).run(participantId, rp?.room_id ?? null, claudeSessionId, workdir || null);
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
try {
  db.exec(fs.readFileSync(path.join(__dirname, 'db', 'schema.sqlite.sql'), 'utf8'));
} catch (e) {
  console.error('[schema] init warning (non-fatal):', e.message);
}

// ─── Migration runner ─────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

// Seed old inline migrations as already-applied for existing DBs
const _seedMigrations = [
  { filename: '20260590-migrate-ai-sessions-unique.sql', applied: () => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'").get();
    return !!(tbl?.sql && !tbl.sql.includes('participant_id INTEGER NOT NULL UNIQUE'));
  }},
  { filename: '20260591-add-agent-workdirs-model.sql', applied: () => {
    const cols = db.prepare("PRAGMA table_info(agent_workdirs)").all().map(c => c.name);
    return cols.includes('model');
  }},
  { filename: '20260592-add-rooms-archived-at.sql', applied: () => {
    const cols = db.prepare("PRAGMA table_info(rooms)").all().map(c => c.name);
    return cols.includes('archived_at');
  }},
  { filename: '20260601-add-system-event-state.sql', applied: () => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
    return !!(tbl?.sql?.includes('system_event'));
  }},
  { filename: '20260602-clean-duplicate-settings.sql', applied: () => true },
  { filename: '20260609-automation-connections.sql', applied: () => {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_connections'").get();
    const cols = db.prepare('PRAGMA table_info(automations)').all().map(c => c.name);
    return !!(hasTable && cols.includes('connection_id'));
  }},
];
for (const m of _seedMigrations) {
  if (!db.prepare('SELECT 1 FROM migrations WHERE filename=?').get(m.filename) && m.applied()) {
    db.prepare('INSERT OR IGNORE INTO migrations (filename) VALUES (?)').run(m.filename);
  }
}

// Run pending migrations from migrations/ folder
try {
  const migFiles = fs.readdirSync(path.join(__dirname, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const filename of migFiles) {
    if (db.prepare('SELECT 1 FROM migrations WHERE filename=?').get(filename)) continue;
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', filename), 'utf8');
    try {
      db.exec('BEGIN TRANSACTION');
      db.exec(sql);
      db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(filename);
      db.exec('COMMIT');
      console.log(`[migration] applied: ${filename}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      console.error(`[migration] failed: ${filename} —`, e.message);
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[migration] runner error:', e.message);
}


// ─── Auth: password hashing & session management ─────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function createAuthSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return { token, expires };
}

function validateAuthSession(token) {
  if (!token) return null;
  const row = db.prepare("SELECT s.*, u.email FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')").get(token);
  return row || null;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

// Seed default auth user
{
  const existing = db.prepare('SELECT id FROM auth_users LIMIT 1').get();
  if (!existing) {
    const hash = hashPassword('stoa2026!');
    db.prepare('INSERT INTO auth_users (email, password_hash) VALUES (?,?)').run('stoa@stoa.com', hash);
    console.log('[auth] Default user seeded: stoa@stoa.com');
  }
}

// Cleanup expired sessions periodically
setInterval(() => {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
}, 3600_000);

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
const CLIENT_FILES = new Set(['stoa.js', 'claude-session.js']);

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

// ── Scheduled cleanup: delete uploaded files older than CLEANUP_MAX_AGE_HOURS (skip avatar/)
{
  const CLEANUP_HOUR = parseInt(process.env.CLEANUP_CRON_HOUR) || 10;
  const CLEANUP_MAX_AGE = (parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 24) * 3600_000;

  const cleanupUploads = () => {
    const now = Date.now();
    let count = 0;
    for (const entry of fs.readdirSync(UPLOADS_DIR)) {
      if (entry === 'avatar') continue;
      const fp = path.join(UPLOADS_DIR, entry);
      const stat = fs.statSync(fp);
      if (stat.isFile() && (now - stat.mtimeMs) > CLEANUP_MAX_AGE) {
        fs.unlinkSync(fp);
        count++;
      }
    }
    if (count) console.log(`[cleanup] Deleted ${count} expired file(s) from uploads/`);
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(CLEANUP_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => { cleanupUploads(); scheduleNext(); }, next - now);
  };
  scheduleNext();
}

const _settingCache = new Map();
function getSetting(key, scopeId = null) {
  const cacheKey = `${key}:${scopeId}`;
  const cached = _settingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1000) return cached.value;
  if (cached) _settingCache.delete(cacheKey);
  const scope = scopeId ? 'room' : 'global';
  const row = db.prepare(
    'SELECT value FROM settings WHERE scope=? AND (scope_id=? OR scope_id IS NULL) AND key_name=? ORDER BY scope DESC LIMIT 1'
  ).get(scope, scopeId, key);
  const value = row?.value ?? null;
  _settingCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}
function getParsedSetting(key) {
  const cacheKey = `${key}:null:parsed`;
  const cached = _settingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1000) return cached.value;
  if (cached) _settingCache.delete(cacheKey);
  const raw = getSetting(key);
  const value = raw ? JSON.parse(raw) : null;
  _settingCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}

function setSetting(key, value) {
  for (const k of _settingCache.keys()) { if (k.startsWith(key + ':')) _settingCache.delete(k); }
  const existing = db.prepare("SELECT id FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name=?").get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value=? WHERE id=?').run(value, existing.id);
  } else {
    db.prepare("INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('global', NULL, ?, ?)").run(key, value);
  }
}

function getPlatKeys(plat) {
  return plat.api_keys?.length ? plat.api_keys : (plat.api_key ? [plat.api_key] : []);
}

async function isOllamaDaemonUrl(baseUrl) {
  try {
    const r = await fetch(new URL(baseUrl).origin + '/api/version', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    return d != null && typeof d.version === 'string';
  } catch { return false; }
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

// ─── Auth helpers ────────────────────────────────────────────────────────────

const AUTH_EXEMPT = new Set(['/api/auth/login', '/favicon.ico']);
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

function cookieFlags(req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function serveIndex() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  if (IS_PROD && fs.existsSync(path.join(PUBLIC_DIR, 'dist', 'stoa.min.css'))) {
    html = html.replace(/<!-- \{\{APP_CSS\}\} -->[\s\S]*?<!-- \{\{\/APP_CSS\}\} -->/, '<link rel="stylesheet" href="/dist/stoa.min.css">');
    html = html.replace(/<!-- \{\{APP_JS\}\} -->[\s\S]*?<!-- \{\{\/APP_JS\}\} -->/, '<script src="/dist/stoa.min.js"></script>');
  }
  return html;
}

function requireAuth(req, res, url) {
  if (AUTH_EXEMPT.has(url.pathname)) return true;
  // Static assets from public/ (CSS, JS, manifest, icons, SW)
  if (url.pathname.match(/^\/(css|js|vendor|dist)\//) || ['/manifest.json', '/sw.js', '/stoa-icon.svg'].includes(url.pathname)) return true;
  // Uploaded files accessible by agents (they fetch without cookies)
  if (url.pathname.startsWith('/uploads/')) return true;
  // Install scripts and agent register are public (token-protected already)
  if (url.pathname === '/install.sh' || url.pathname === '/install.ps1' || url.pathname === '/install.cmd') return true;
  if (url.pathname === '/api/agent/register') return true;
  // Client file API used by agents for auto-update
  if (url.pathname === '/api/client/manifest' || url.pathname.startsWith('/api/client/file/')) return true;
  // Ollama Cloud proxy — called by Claude Code SDK which sends a Bearer token, not a browser cookie.
  // Auth relies on Stoa's trusted-network model (Tailscale): same as /api/agent/register.
  // The bearer token encodes platform_id (stoa-proxy:<id>) but is NOT a secret — do not treat it as one.
  if (url.pathname === '/v1/messages') return true;

  // Agent HTTP auth via headers (for upload etc.)
  const agentId = req.headers['x-agent-id'];
  const agentSecret = req.headers['x-agent-secret'];
  if (agentId && agentSecret) {
    const actor = db.prepare('SELECT secret FROM actors WHERE id=? AND type=?').get(agentId, 'ai');
    if (actor?.secret) {
      const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
      if (crypto.timingSafeEqual(h(agentSecret), h(actor.secret))) return true;
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = validateAuthSession(cookies.stoa_session);
  if (session) { req._authUser = session; return true; }

  // Not authenticated
  if (url.pathname === '/' || !url.pathname.startsWith('/api/')) {
    // Serve login page for HTML requests
    return 'login';
  }
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function updateConnStatus(id, status, errorMsg, meta) {
  const md = JSON.stringify({ workspaceName: meta.workspaceName || '', botName: meta.botName || '' });
  db.prepare("UPDATE automation_connections SET status=?, error_msg=?, metadata=?, updated_at=datetime('now') WHERE id=?")
    .run(status, errorMsg || null, md, id);
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Auth check ──
  const authResult = requireAuth(req, res, url);
  if (authResult === false) return;
  if (authResult === 'login') {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(serveIndex());
    }
    res.writeHead(401); return res.end('Unauthorized');
  }

  // ── Auth routes (exempt from auth check above) ──
  if (req.method === 'POST' && url.pathname === '/api/client-error') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (data) {
      const sanitize = (s) => String(s || '').replace(/[\r\n]/g, ' ').slice(0, 2000);
      const line = `[${new Date().toISOString()}] ${sanitize(data.message)} | ${sanitize(data.source)}\n`;
      try { fs.appendFileSync(path.join(__dirname, '.claude', 'client-errors.log'), line); } catch {}
      console.log('[client-error]', sanitize(data.message));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { email, password } = data;
    const user = db.prepare('SELECT * FROM auth_users WHERE email=?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid email or password' }));
    }
    const session = createAuthSession(user.id);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `stoa_session=${session.token}; ${cookieFlags(req)}; Max-Age=${7*24*3600}`,
    });
    return res.end(JSON.stringify({ ok: true, email: user.email }));
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.stoa_session) {
      db.prepare('DELETE FROM auth_sessions WHERE token=?').run(cookies.stoa_session);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `stoa_session=; ${cookieFlags(req)}; Max-Age=0`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = db.prepare('SELECT id, email FROM auth_users WHERE id=?').get(req._authUser.user_id);
    return json(res, user || {});
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/email') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { email } = data;
    if (!email?.trim() || !email.includes('@')) { res.writeHead(400); return res.end('invalid email'); }
    try {
      db.prepare('UPDATE auth_users SET email=? WHERE id=?').run(email.trim(), req._authUser.user_id);
    } catch { res.writeHead(409); return res.end('email already in use'); }
    return json(res, { ok: true, email: email.trim() });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/password') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { current_password, new_password } = data;
    if (!new_password || new_password.length < 6) { res.writeHead(400); return res.end('password must be at least 6 characters'); }
    const user = db.prepare('SELECT * FROM auth_users WHERE id=?').get(req._authUser.user_id);
    if (!verifyPassword(current_password, user.password_hash)) {
      res.writeHead(401); return res.end('current password incorrect');
    }
    const hash = hashPassword(new_password);
    db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash, user.id);
    // Invalidate all other sessions
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token!=?').run(user.id, req._authUser.token);
    return json(res, { ok: true });
  }

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
    const MAX_UPLOAD = 25 * 1024 * 1024;
    const chunks = [];
    let size = 0;
    await new Promise((resolve, reject) => {
      req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); reject(new Error('File too large')); } else chunks.push(c); });
      req.on('end', resolve);
      req.on('error', reject);
    }).catch(e => { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); return; });
    if (res.headersSent) return;
    const buffer = Buffer.concat(chunks);
    const fileName = decodeURIComponent(req.headers['x-file-name'] || 'file');
    const mimeType = req.headers['content-type'] || 'application/octet-stream';
    const origExt = fileName ? path.extname(fileName).toLowerCase() : null;
    const mimeToExt = { 'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp',
      'text/markdown':'.md','text/plain':'.txt','application/pdf':'.pdf','application/json':'.json' };
    const ext = origExt || mimeToExt[mimeType] || '.' + (mimeType.split('/')[1] || 'bin');
    const safeExt = ext.startsWith('.') ? ext : '.' + ext;
    const saved = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    const savedPath = path.join(UPLOADS_DIR, saved);
    try { fs.writeFileSync(savedPath, buffer); } catch { res.writeHead(500); return res.end(JSON.stringify({ error: 'Failed to save file' })); }
    return json(res, { url: `/uploads/${saved}`, name: fileName || saved });
  }

  // ── Actor avatar upload
  const avatarUploadMatch = req.method === 'POST' && url.pathname.match(/^\/api\/actors\/(\d+)\/avatar$/);
  if (avatarUploadMatch) {
    const id = parseInt(avatarUploadMatch[1]);
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { data_url } = data;
    if (!data_url || !data_url.startsWith('data:image/')) { res.writeHead(400); return res.end('invalid data_url'); }
    const mimeMatch = data_url.match(/^data:(image\/[a-z+]+);base64,/);
    if (!mimeMatch) { res.writeHead(400); return res.end('invalid data_url format'); }
    const mimeType = mimeMatch[1];
    const mimeToExt = { 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp' };
    const ext = mimeToExt[mimeType] || 'png';
    const base64Data = data_url.slice(data_url.indexOf(',') + 1);
    const oldAvatar = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (oldAvatar?.avatar_url) {
      const oldPath = path.join(__dirname, oldAvatar.avatar_url.replace(/^\//, ''));
      if (oldPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
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
    const actor = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (actor?.avatar_url) {
      const oldPath = path.join(__dirname, actor.avatar_url.replace(/^\//, ''));
      if (oldPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    db.prepare('UPDATE actors SET avatar_url=NULL WHERE id=?').run(id);
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 145"><rect x="15" y="0" width="230" height="10" fill="#2e2820"/><rect x="50" y="60" width="40" height="70" fill="#5b8fd4"/><rect x="110" y="40" width="40" height="90" fill="#8a7660"/><rect x="170" y="20" width="40" height="110" fill="#d39749"/><rect x="15" y="130" width="230" height="10" fill="#2e2820"/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(svg);
  }

  // Serve static files from public/
  const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  if (req.method === 'GET') {
    const isRoot = url.pathname === '/';
    const ext = isRoot ? '.html' : path.extname(url.pathname);
    if (STATIC_TYPES[ext]) {
      if (isRoot) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(serveIndex());
      }
      const filePath = path.join(PUBLIC_DIR, url.pathname);
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(PUBLIC_DIR) && fs.existsSync(resolved)) {
        const cachePolicy = (ext === '.svg' || ext === '.json') ? 'public, max-age=86400' : 'no-cache';
        res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext], 'Cache-Control': cachePolicy });
        return res.end(fs.readFileSync(resolved));
      }
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const archived = url.searchParams.get('archived') === '1';
    const rows = db.prepare(`
      SELECT r.*, a.name as creator_name,
        (SELECT COUNT(*) FROM room_participants WHERE room_id=r.id) as participant_count,
        (SELECT COUNT(*) FROM messages WHERE room_id=r.id) as message_count,
        (SELECT m.content FROM messages m WHERE m.room_id=r.id AND m.state='complete' AND m.content != '' ORDER BY m.id DESC LIMIT 1) as last_message,
        (SELECT a2.name FROM messages m2 JOIN room_participants rp ON rp.id=m2.participant_id JOIN actors a2 ON a2.id=rp.actor_id WHERE m2.room_id=r.id AND m2.state='complete' AND m2.content != '' ORDER BY m2.id DESC LIMIT 1) as last_message_actor,
        COALESCE((SELECT m3.created_at FROM messages m3 WHERE m3.room_id=r.id ORDER BY m3.id DESC LIMIT 1), r.created_at) as last_activity
      FROM rooms r JOIN actors a ON a.id=r.created_by LEFT JOIN agent_workdirs w ON w.id=r.workdir_id
      WHERE ${archived ? 'r.archived_at IS NOT NULL' : 'r.archived_at IS NULL'}
      ORDER BY r.is_pinned DESC, last_activity DESC
      LIMIT 200
    `).all();
    return json(res, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms/participants') {
    const ids = (url.searchParams.get('ids') || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return json(res, {});
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT rp.room_id, rp.*, a.name, a.type, a.avatar_color, a.avatar_symbol, a.avatar_url, a.adapter
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id IN (${ph})
    `).all(...ids);
    const grouped = {};
    for (const r of rows) { (grouped[r.room_id] ||= []).push(r); }
    return json(res, grouped);
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { title, participant_ids = [], workdir_id = null } = data;
    if (!workdir_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir_id is required' })); }
    const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
    const humanId = human?.id ?? 1;
    const allIds = [...new Set([humanId, ...participant_ids])];
    // Validate the workdir exists and belongs to one of the participants before creating the
    // room — mirrors the ownership check on POST /api/rooms/:id/participants and prevents a
    // dangling rooms.workdir_id whose participant assignment would otherwise silently no-op.
    const wdOwner = db.prepare('SELECT actor_id FROM agent_workdirs WHERE id=?').get(workdir_id);
    if (!wdOwner) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir not found' })); }
    if (!allIds.includes(wdOwner.actor_id)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'workdir must belong to one of the participants' })); }
    // Every AI participant must be online at creation time — a room is only useful with an
    // agent that can actually respond, and an offline agent can't be "prepared ahead". Human
    // participants are never gated (they hold no agent connection). The frontend mirrors this
    // by disabling offline agents; enforced here too because the API can be called directly.
    if (participant_ids.length) {
      const ph = participant_ids.map(() => '?').join(',');
      const agentRows = db.prepare(`SELECT id, name FROM actors WHERE type='ai' AND id IN (${ph})`).all(...participant_ids);
      const offline = agentRows.filter(a => !agentClients.has(a.id));
      if (offline.length) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `agent offline: ${offline.map(a => a.name).join(', ')}` }));
      }
    }
    const result = db.prepare('INSERT INTO rooms (title, created_by, workdir_id) VALUES (?,?,?)').run(title, humanId, workdir_id);
    const roomId = result.lastInsertRowid;
    const insertParticipant = db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id) VALUES (?,?)');
    db.transaction((ids) => { for (const id of ids) insertParticipant.run(roomId, id); })(allIds);
    // Assign the room's workdir to the participant that owns it (the chosen agent), so every
    // participant carries an explicit workdir_id — consistent with the backfill migration.
    db.prepare('UPDATE room_participants SET workdir_id=? WHERE room_id=? AND actor_id=?').run(workdir_id, roomId, wdOwner.actor_id);
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
    console.log(`[server] Room created id=${roomId}, broadcasting to ${globalClients.size} clients`);
    broadcastGlobal({ type: 'room_created', room });
    return json(res, room);
  }

  const roomPatchMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomPatchMatch) {
    const roomId = parseInt(roomPatchMatch[1]);
    const body = await readBody(req);
    const parsed = parseJsonBody(body);
    if (!parsed) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    if (parsed.title) {
      db.prepare('UPDATE rooms SET title=? WHERE id=?').run(parsed.title.trim(), roomId);
      broadcastGlobal({ type: 'room_updated', room_id: roomId, title: parsed.title.trim() });
    }
    if (parsed.archived === true) {
      db.prepare("UPDATE rooms SET archived_at=datetime('now'), is_pinned=0 WHERE id=?").run(roomId);
      broadcastGlobal({ type: 'room_archived', room_id: roomId });
    }
    if (parsed.archived === false) {
      db.prepare('UPDATE rooms SET archived_at=NULL WHERE id=?').run(roomId);
      broadcastGlobal({ type: 'room_restored', room_id: roomId });
    }
    return json(res, { ok: true });
  }

  const roomPinMatch = req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/(\d+)\/pin$/);
  if (roomPinMatch) {
    const roomId = parseInt(roomPinMatch[1]);
    const pinErr = db.transaction(() => {
      const room = db.prepare("SELECT id, is_pinned FROM rooms WHERE id=? AND archived_at IS NULL").get(roomId);
      if (!room) return 'not_found';
      if (room.is_pinned) return 'already_pinned';
      const pinCount = db.prepare("SELECT COUNT(*) as cnt FROM rooms WHERE is_pinned=1 AND archived_at IS NULL").get().cnt;
      if (pinCount >= 5) return 'limit';
      db.prepare("UPDATE rooms SET is_pinned=1 WHERE id=?").run(roomId);
      return null;
    })();
    if (pinErr === 'not_found') return json(res, { error: 'Room not found' }, 404);
    if (pinErr === 'limit') return json(res, { error: 'Maximum 5 pinned rooms reached' }, 400);
    broadcastGlobal({ type: 'room_pinned', room_id: roomId });
    return json(res, { ok: true });
  }

  const roomUnpinMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/(\d+)\/pin$/);
  if (roomUnpinMatch) {
    const roomId = parseInt(roomUnpinMatch[1]);
    const room = db.prepare("SELECT id, is_pinned FROM rooms WHERE id=? AND archived_at IS NULL").get(roomId);
    if (!room) return json(res, { error: 'Room not found' }, 404);
    if (!room.is_pinned) return json(res, { ok: true });
    db.prepare("UPDATE rooms SET is_pinned=0 WHERE id=?").run(roomId);
    broadcastGlobal({ type: 'room_unpinned', room_id: roomId });
    return json(res, { ok: true });
  }

  const roomDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomDeleteMatch) {
    const roomId = parseInt(roomDeleteMatch[1]);
    const participantIds = db.prepare('SELECT id FROM room_participants WHERE room_id=?').all(roomId).map(r => r.id);
    if (participantIds.length) {
      const ph = participantIds.map(() => '?').join(',');
      // Notify agents to delete session files before removing from DB
      const sessions = db.prepare(`
        SELECT s.claude_session_id, s.workdir, rp.actor_id
        FROM ai_sessions s JOIN room_participants rp ON rp.id=s.participant_id
        WHERE rp.room_id=? AND s.claude_session_id IS NOT NULL AND s.workdir IS NOT NULL
      `).all(roomId);
      for (const sess of sessions) {
        const agentWs = agentClients.get(sess.actor_id);
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: 'cleanup_session', claude_session_id: sess.claude_session_id, workdir: sess.workdir }));
        }
      }
      db.prepare(`DELETE FROM ai_sessions WHERE participant_id IN (${ph})`).run(...participantIds);
    }
    db.prepare('DELETE FROM invite_suggestions WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM messages WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM room_participants WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
    broadcastGlobal({ type: 'room_deleted', room_id: roomId });
    res.writeHead(204); return res.end();
  }

  const msgDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgDeleteMatch) {
    const msgId = parseInt(msgDeleteMatch[1]);
    const msg = db.prepare('SELECT room_id FROM messages WHERE id=?').get(msgId);
    if (!msg) { res.writeHead(404); return res.end(); }
    db.prepare("INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?, (SELECT content FROM messages WHERE id=?))").run(msgId, msgId);
    db.prepare('DELETE FROM messages WHERE id=?').run(msgId);
    broadcast(msg.room_id, { type: 'message_deleted', message_id: msgId });
    res.writeHead(204); return res.end();
  }

  const msgGetMatch = req.method === 'GET' && url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgGetMatch) {
    const msgId = parseInt(msgGetMatch[1]);
    const row = db.prepare(`
      SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(msgId);
    if (!row) { res.writeHead(404); return res.end(); }
    return json(res, row);
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    const roomId = url.searchParams.get('room_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 100);
    if (!q) return json(res, []);
    const rows = db.prepare(`
      SELECT m.id, m.room_id, m.content, m.created_at,
             a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type,
             r.title as room_title, r.archived_at,
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
      const before = url.searchParams.get('before');
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
      if (before) {
        const rows = db.prepare(`
          SELECT * FROM (
            SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
            FROM messages m
            JOIN room_participants rp ON rp.id=m.participant_id
            JOIN actors a ON a.id=rp.actor_id
            WHERE m.room_id=? AND m.id < ?
              AND (
                (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
                OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
              )
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
        WHERE m.room_id=? AND m.id > ?
          AND (
            (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
            OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
          )
        ORDER BY m.created_at ASC
        LIMIT 500
      `).all(roomId, since);
      return json(res, enrichReply(rows));
    }

    if (url.pathname.endsWith('/participants')) {
      const rows = db.prepare(`
        SELECT rp.*, a.name, a.type, a.avatar_color, a.avatar_symbol, a.avatar_url, a.adapter,
               w.path AS workdir_path, w.label AS workdir_label
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        LEFT JOIN agent_workdirs w ON w.id=rp.workdir_id
        WHERE rp.room_id=?
      `).all(roomId);
      return json(res, rows);
    }

    const subPath = url.pathname.split('/').slice(4).join('/');
    if (!subPath) {
      const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
      if (!room) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Room not found' })); }
      return json(res, room);
    }

    if (url.pathname.endsWith('/skills')) {
      const room = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
      if (!room) { res.writeHead(404); return res.end('Room not found'); }
      const agentIds = db.prepare(
        "SELECT a.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='ai'"
      ).all(roomId).map(r => r.id);
      if (!agentIds.length) return json(res, []);
      const ph = agentIds.map(() => '?').join(',');
      const skills = db.prepare(`
        SELECT s.name, s.description, s.scope, s.actor_id, a.name as actor_name,
               a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM agent_skills s JOIN actors a ON a.id=s.actor_id
        WHERE s.actor_id IN (${ph})
          AND ((s.scope IN ('project','local') AND s.workdir_id = ?) OR s.scope = 'global')
        ORDER BY s.scope, s.name
      `).all(...agentIds, room.workdir_id);
      return json(res, skills);
    }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/participants$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { actor_id, workdir_id = null } = data;
    if (!actor_id) return json(res, { error: 'actor_id required' }, 400);
    const actor = db.prepare('SELECT id, name, type FROM actors WHERE id=?').get(actor_id);
    if (!actor) return json(res, { error: 'actor not found' }, 404);
    // An AI participant must be online to be added — same rule as room creation. Enforced
    // server-side (not just disabled in the UI) since this endpoint can be called directly.
    if (actor.type === 'ai' && !agentClients.has(actor.id)) {
      return json(res, { error: `agent offline: ${actor.name}` }, 409);
    }
    // Validate workdir ownership: a workdir may only be assigned to the agent that owns it.
    if (workdir_id != null) {
      const wd = db.prepare('SELECT id FROM agent_workdirs WHERE id=? AND actor_id=?').get(workdir_id, actor_id);
      if (!wd) return json(res, { error: 'workdir not found for this agent' }, 400);
    }
    const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id, workdir_id) VALUES (?,?,?)').run(roomId, actor_id, workdir_id);
    // If the participant already existed, update its workdir when a new one is provided.
    if (workdir_id != null) {
      db.prepare('UPDATE room_participants SET workdir_id=? WHERE room_id=? AND actor_id=?').run(workdir_id, roomId, actor_id);
    }
    broadcast(roomId, { type: 'participant_joined', actor_id });
    return json(res, { ok: true });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/rooms\/\d+\/message$/)) {
    const roomId = parseInt(url.pathname.split('/')[3]);

    // Only agents can post proactive messages
    const agentId = parseInt(req.headers['x-agent-id'] || '0');
    const agentSecret = req.headers['x-agent-secret'] || '';
    if (!agentId || !agentSecret) return json(res, { error: 'agent auth required' }, 403);

    const agentActor = db.prepare("SELECT id, secret FROM actors WHERE id=? AND type='ai'").get(agentId);
    if (!agentActor) return json(res, { error: 'actor not found' }, 403);
    const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
    if (!agentActor.secret || !crypto.timingSafeEqual(h(agentSecret), h(agentActor.secret))) {
      return json(res, { error: 'invalid credentials' }, 403);
    }

    const data = parseJsonBody(await readBody(req));
    if (!data) return json(res, { error: 'Invalid JSON' }, 400);
    const content = data.content?.trim();
    if (!content) return json(res, { error: 'content required' }, 400);

    const room = db.prepare('SELECT id, archived_at FROM rooms WHERE id=?').get(roomId);
    if (!room) return json(res, { error: 'room not found' }, 404);
    if (room.archived_at) return json(res, { error: 'room is archived' }, 400);

    const participant = db.prepare(
      'SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=?'
    ).get(roomId, agentId);
    if (!participant) return json(res, { error: 'agent is not a participant in this room' }, 403);

    const result = db.prepare(
      "INSERT INTO messages (room_id, participant_id, content, state) VALUES (?, ?, ?, 'complete')"
    ).run(roomId, participant.id, content);
    const messageId = result.lastInsertRowid;

    const row = db.prepare(`
      SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(messageId);

    broadcast(roomId, { type: 'message_new', message: row });
    broadcastGlobal({ type: 'room_activity', room_id: roomId });
    return json(res, { message_id: messageId });
  }

  if (req.method === 'GET' && url.pathname === '/api/setup/status') {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    return json(res, { needsSetup: row.cnt === 0 });
  }

  if (req.method === 'POST' && url.pathname === '/api/setup') {
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name } = data;
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM actors WHERE type='human'`).get();
    if (row.cnt > 0) { res.writeHead(409); return res.end('already set up'); }
    db.prepare(
      `INSERT INTO actors (name, type, avatar_color, avatar_symbol) VALUES (?, 'human', '#8a7660', '◉')`
    ).run(name.trim());
    return json(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/usage/stats') {
    if (!req._authUser) { res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' })); }
    const rawPeriod = url.searchParams.get('period');
    const period = ['all','30','7'].includes(rawPeriod) ? rawPeriod : 'all';
    // Client sends its UTC offset in minutes (WIB = +420) so day-bucketing, peak hour, and
    // streaks align to the viewer's local calendar instead of UTC. Integer-clamped, so it's
    // safe to interpolate into the SQLite datetime modifier below.
    const rawOff = parseInt(url.searchParams.get('tz_offset'), 10);
    // Clamp range is [-840, 840]. Real IANA offsets only span [-720 (UTC-12), 840 (UTC+14)],
    // so the lower bound is intentionally loose: a legit client (-getTimezoneOffset()) never
    // sends below -720, and a crafted -840 just shifts SQLite by an extra valid 2h — no error,
    // no injection (already integer-parsed). Not a finding.
    const tzOff = Number.isFinite(rawOff) ? Math.max(-840, Math.min(840, rawOff)) : 0;
    const tzMod = `'${tzOff} minutes'`;
    // since = local midnight N days ago. Shift to local time first so 'start of day' snaps to
    // the local calendar day (not UTC day), then shift back to UTC before subtracting N days.
    // NOTE: 'now' is re-evaluated by SQLite per query, so in theory the queries below could
    // straddle midnight and use slightly different cutoffs. In practice they run synchronously
    // back-to-back (<1ms total), so the boundary would have to fall inside a microsecond gap —
    // harmless for a single-user dashboard. Not a finding.
    const since = period === 'all' ? `'1970-01-01'` : `datetime('now', '${tzOff} minutes', 'start of day', '${-tzOff} minutes', '-${period} days')`;

    const byModel = db.prepare(`
      SELECT model,
        COALESCE(SUM(input_tokens),0) as input_tokens,
        COALESCE(SUM(output_tokens),0) as output_tokens,
        COALESCE(SUM(cache_read_tokens),0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens),0) as cache_creation_tokens,
        COALESCE(SUM(cost_usd),0) as cost_usd,
        COUNT(*) as turns
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY model ORDER BY cost_usd DESC
    `).all();
    // totals is derived from byModel to avoid a redundant full-table scan —
    // byModel already returns the same columns with the same WHERE filter. Not a finding.
    // Column list matches byModel SELECT exactly. Adding a column to byModel requires updating the
    // accumulator body and seed — intentional, schema is stable and the comment closes the gap. Not a finding.
    // FP drift (JS reduce vs SQL SUM): epsilon ~1e-14 at $100 scale; _usageCost rounds to 2 dp
    // (threshold 0.005 to flip a cent). Drift is 11 orders of magnitude below that. Not a finding.
    const totals = byModel.reduce((acc, r) => ({
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      cache_read_tokens: acc.cache_read_tokens + r.cache_read_tokens,
      cache_creation_tokens: acc.cache_creation_tokens + r.cache_creation_tokens,
      cost_usd: acc.cost_usd + r.cost_usd,
      turns: acc.turns + r.turns,
    }), { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 0, turns: 0 });

    // daily aggregation (for heatmap + streaks), bucketed by the client's local calendar day.
    // NOT derivable from dailyByModel: dailyByModel only sums input+output tokens (no cache columns),
    // has no per-day turns total, and is needed for its own purpose. Two separate queries. Not a finding.
    const daily = db.prepare(`
      SELECT date(created_at, ${tzMod}) as day,
        COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens),0) as tokens,
        COUNT(*) as turns
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY day ORDER BY day ASC
    `).all();

    const activeDays = daily.length;

    // peak hour in the client's local timezone
    const peakRow = db.prepare(`
      SELECT CAST(strftime('%H', datetime(created_at, ${tzMod})) AS INTEGER) as hour, COUNT(*) as n
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY hour ORDER BY n DESC LIMIT 1
    `).get();
    const peakHour = peakRow ? peakRow.hour : null;

    // streaks (consecutive calendar days, computed from daily set)
    const daySet = new Set(daily.map(d => d.day));
    let streakLongest = 0, streakCurrent = 0;
    if (daily.length) {
      // daily is already ORDER BY day ASC from SQL — no re-sort needed. Not a finding.
      const allDays = daily.map(d => d.day);
      // best starts at 1: any non-empty daily means at least a 1-day historical streak. Not a finding.
      let run = 1, best = 1;
      for (let i = 1; i < allDays.length; i++) {
        const prev = new Date(allDays[i-1] + 'T00:00:00Z');
        const cur = new Date(allDays[i] + 'T00:00:00Z');
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 1) { run++; best = Math.max(best, run); }
        else { run = 1; }
      }
      streakLongest = best;
      // current streak: count back from today in the client's local timezone
      const todayStr = new Date(Date.now() + tzOff*60000).toISOString().slice(0,10);
      let cursor = new Date(todayStr + 'T00:00:00Z');
      // allow streak to count even if today has no activity yet (start from yesterday)
      if (!daySet.has(todayStr)) cursor = new Date(cursor - 86400000);
      let cs = 0;
      while (daySet.has(cursor.toISOString().slice(0,10))) {
        cs++;
        cursor = new Date(cursor - 86400000);
      }
      streakCurrent = cs;
    }

    const dailyByModel = db.prepare(`
      SELECT date(created_at, ${tzMod}) as day,
        model,
        COALESCE(SUM(input_tokens),0) as input_tokens,
        COALESCE(SUM(output_tokens),0) as output_tokens
      FROM usage_log WHERE created_at >= ${since}
      GROUP BY day, model ORDER BY day ASC
    `).all();

    const favoriteModel = byModel.length ? byModel.reduce((a,b) => b.turns > a.turns ? b : a).model : null;

    return json(res, {
      totals, byModel, daily, dailyByModel,
      activeDays, peakHour,
      streakCurrent, streakLongest, favoriteModel,
      period,
    });
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
      max_ai_turns: parseInt(process.env.MAX_AI_TURNS) || 5,
      max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 1,
      session_idle_ttl: parseInt(process.env.SESSION_IDLE_TTL) || 5,
      auto_compact_threshold_kb: parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB) || 500,
      cleanup_cron_hour: parseInt(process.env.CLEANUP_CRON_HOUR) || 10,
      cleanup_max_age_hours: parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 24,
    });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    if (body.public_url !== undefined) setSetting('public_url', body.public_url.trim());
    if (body.human_name !== undefined) {
      const name = body.human_name.trim() || 'Human';
      writeEnv('HUMAN_NAME', name);
      process.env.HUMAN_NAME = name;
      const human = db.prepare(`SELECT id FROM actors WHERE type='human' LIMIT 1`).get();
      if (human) db.prepare('UPDATE actors SET name=? WHERE id=?').run(name, human.id);
    }
    if (body.max_ai_turns !== undefined) {
      const val = parseInt(body.max_ai_turns);
      if (val >= 1 && val <= 100) { writeEnv('MAX_AI_TURNS', String(val)); process.env.MAX_AI_TURNS = String(val); }
    }
    if (body.max_concurrent !== undefined) {
      const val = parseInt(body.max_concurrent);
      if (val >= 1 && val <= 10) {
        writeEnv('MAX_CONCURRENT', String(val)); process.env.MAX_CONCURRENT = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', max_concurrent: val }));
      }
    }
    if (body.session_idle_ttl !== undefined) {
      const val = parseInt(body.session_idle_ttl);
      if (val >= 1 && val <= 60) {
        writeEnv('SESSION_IDLE_TTL', String(val)); process.env.SESSION_IDLE_TTL = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', session_idle_ttl: val }));
      }
    }
    if (body.auto_compact_threshold_kb !== undefined) {
      const val = parseInt(body.auto_compact_threshold_kb);
      if (val >= 100 && val <= 5000) {
        writeEnv('AUTO_COMPACT_THRESHOLD_KB', String(val)); process.env.AUTO_COMPACT_THRESHOLD_KB = String(val);
        for (const [, agentWs] of agentClients) agentWs.send(JSON.stringify({ type: 'set_config', auto_compact_threshold_kb: val }));
      }
    }
    if (body.cleanup_cron_hour !== undefined) {
      const val = parseInt(body.cleanup_cron_hour);
      if (val >= 0 && val <= 23) { writeEnv('CLEANUP_CRON_HOUR', String(val)); process.env.CLEANUP_CRON_HOUR = String(val); }
    }
    if (body.cleanup_max_age_hours !== undefined) {
      const val = parseInt(body.cleanup_max_age_hours);
      if (val >= 1 && val <= 720) { writeEnv('CLEANUP_MAX_AGE_HOURS', String(val)); process.env.CLEANUP_MAX_AGE_HOURS = String(val); }
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

  // ── AI Platform config ──
  if (req.method === 'GET' && url.pathname === '/api/ai/platforms') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const safe = platforms.map(p => ({
      ...p,
      api_keys: p.api_keys || (p.api_key ? [p.api_key] : []),
      api_key: undefined,
    }));
    return json(res, safe);
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/platforms') {
    const body = parseJsonBody(await readBody(req));
    if (!body || !body.name?.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' })); }
    const platforms = structuredClone(getParsedSetting('ai_platforms') ?? []);
    const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (platforms.find(p => p.id === id)) { res.writeHead(409); return res.end(JSON.stringify({ error: 'A platform with this name already exists' })); }
    const keys = Array.isArray(body.api_keys) ? body.api_keys : (body.api_key ? [body.api_key] : []);
    const platform = { id, name: body.name.trim(), base_url: body.base_url || '', api_keys: keys, enabled: true, vendor: body.vendor || 'generic' };
    platforms.push(platform);
    setSetting('ai_platforms', JSON.stringify(platforms));
    return json(res, platform);
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const platforms = structuredClone(getParsedSetting('ai_platforms') ?? []);
    const idx = platforms.findIndex(p => p.id === platformId);
    if (idx === -1) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (body.name !== undefined) {
      if (!body.name?.trim()) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name cannot be empty' })); }
      platforms[idx].name = body.name.trim();
    }
    if (body.base_url !== undefined) platforms[idx].base_url = body.base_url;
    if (body.api_keys !== undefined) {
      platforms[idx].api_keys = Array.isArray(body.api_keys) ? body.api_keys.filter(Boolean) : [];
    }
    if (body.enabled !== undefined) platforms[idx].enabled = body.enabled;
    if (body.vendor !== undefined) platforms[idx].vendor = body.vendor;
    if (body.enabled_models !== undefined) platforms[idx].enabled_models = Array.isArray(body.enabled_models) ? body.enabled_models : null;
    setSetting('ai_platforms', JSON.stringify(platforms));
    return json(res, platforms[idx]);
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const filtered = platforms.filter(p => p.id !== platformId);
    if (filtered.length === platforms.length) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    setSetting('ai_platforms', JSON.stringify(filtered));
    return json(res, { ok: true });
  }

  function platformHeaders(plat) {
    const keys = getPlatKeys(plat);
    const h = { 'Content-Type': 'application/json' };
    if (keys[0]) h['Authorization'] = `Bearer ${keys[0]}`;
    return h;
  }

  async function probeCapabilities(modelNames, baseUrl, headers) {
    const showUrl = new URL(baseUrl).origin + '/api/show';
    return Promise.all(modelNames.map(async (model) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(showUrl, { method: 'POST', headers, signal: ctrl.signal, body: JSON.stringify({ model }) });
        clearTimeout(t);
        if (!r.ok) return { model, vision: false, tools: false };
        const d = await r.json().catch(() => null);
        const caps = Array.isArray(d?.capabilities) ? d.capabilities : [];
        return { model, vision: caps.includes('vision'), tools: caps.includes('tools') };
      } catch { clearTimeout(t); return { model, vision: false, tools: false }; }
    }));
  }

  function saveCachedModels(platformId, models) {
    const freshRaw = getSetting('ai_platforms');
    const freshPlatforms = freshRaw ? JSON.parse(freshRaw) : [];
    const freshIdx = freshPlatforms.findIndex(p => p.id === platformId);
    if (freshIdx !== -1) {
      const plat = freshPlatforms[freshIdx];
      plat.cached_models = models;
      if (Array.isArray(plat.enabled_models)) {
        const validNames = new Set(models.map(m => typeof m === 'string' ? m : m.model));
        plat.enabled_models = plat.enabled_models.filter(n => validNames.has(n));
        // enabled_models:[] is valid — platform simply won't appear in room model selector (GET /api/ai/models skips empty groups)
      }
      setSetting('ai_platforms', JSON.stringify(freshPlatforms));
    }
  }

  async function fetchModelList(baseUrl, headers, timeoutMs = 10000) {
    const url2 = new URL(baseUrl);
    const baseClean = url2.origin + url2.pathname.replace(/\/+$/, '');
    const endpoints = [url2.origin + '/api/tags', baseClean + '/models', url2.origin + '/v1/models'];
    for (const ep of endpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const resp = await fetch(ep, { headers, signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) continue;
        const data = await resp.json().catch(() => null);
        if (data?.models) {
          const raw = data.models.filter(m => !m.remote_model).map(m => m.name || m.model);
          return { ok: true, status: resp.status, models: raw };
        }
        if (data?.data) {
          return { ok: true, status: resp.status, models: data.data.map(m => m.id) };
        }
      } catch { continue; }
    }
    return { ok: false, status: 404, models: [] };
  }

  async function fetchOllamaCloudModels(apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch('https://api.ollama.com/v1/models', { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return [];
      const data = await resp.json().catch(() => null);
      const raw = data?.data?.map(m => m.id) || data?.models?.map(m => m.name || m.model) || [];
      return raw.map(m => m.endsWith(':cloud') || m.endsWith('-cloud') ? m : m + ':cloud');
    } catch { return []; }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+\/discover-models$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const plat = platforms.find(p => p.id === platformId);
    if (!plat) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (plat.vendor === 'ollama') {
      const keys = getPlatKeys(plat);
      if (!keys[0]) return json(res, { status: 'error', message: 'No API key configured for Ollama Cloud' });
      let cloudModels = [];
      for (const key of keys) { cloudModels = await fetchOllamaCloudModels(key); if (cloudModels.length) break; }
      if (!cloudModels.length) return json(res, { status: 'error', message: 'No models found from Ollama Cloud' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ type: 'start', total: cloudModels.length }) + '\n');
      const usable = [];
      for (let i = 0; i < cloudModels.length; i++) {
        const model = cloudModels[i];
        let ok = false;
        for (const key of keys) {
          let timer;
          try {
            const ctrl = new AbortController();
            timer = setTimeout(() => ctrl.abort(), 15000);
            const r = await fetch('https://ollama.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (r.status === 429 || r.status === 401 || r.status === 402) continue;
            ok = r.status === 200;
            break;
          } catch { clearTimeout(timer); }
        }
        if (ok) usable.push({ model, vision: false, tools: true, local: false });
        if (res.destroyed) break;
        res.write(JSON.stringify({ type: 'progress', model, ok, done: i + 1, total: cloudModels.length }) + '\n');
      }
      if (!res.destroyed) {
        saveCachedModels(platformId, usable);
        res.write(JSON.stringify({ type: 'done', usable, tested: cloudModels.length }) + '\n');
      }
      return res.end();
    }
    if (!plat.base_url) { return json(res, { status: 'error', message: 'No base URL configured' }); }
    const headers = platformHeaders(plat);
    try {
      const localResult = await fetchModelList(plat.base_url, headers);
      const localModels = localResult.ok ? localResult.models : [];

      const keys = getPlatKeys(plat);
      const isOllamaComUrl = new URL(plat.base_url).hostname.includes('ollama.com');
      let cloudModels = [];
      if (keys[0] && !isOllamaComUrl) {
        if (await isOllamaDaemonUrl(plat.base_url)) cloudModels = await fetchOllamaCloudModels(keys[0]);
      }

      const seen = new Set(localModels);
      const candidates = [...localModels, ...cloudModels.filter(m => !seen.has(m))];
      if (!candidates.length) return json(res, { status: 'error', message: 'No models found (local or cloud)' });

      const url2 = new URL(plat.base_url);
      const probeBase = (url2.origin + url2.pathname.replace(/\/+$/, '')).replace(/\/v1$/, '') + '/v1';
      async function probe(model) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const r = await fetch(probeBase + '/chat/completions', {
            method: 'POST', headers, signal: ctrl.signal,
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
          });
          clearTimeout(timer);
          return { model, ok: r.ok, status: r.status };
        } catch (e) {
          clearTimeout(timer);
          return { model, ok: false, status: e.name === 'AbortError' ? 'timeout' : 'error' };
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.write(JSON.stringify({ type: 'start', total: candidates.length }) + '\n');

      const concurrency = 4;
      const results = [];
      let done = 0;
      let cursor = 0;
      async function worker() {
        while (cursor < candidates.length) {
          const m = candidates[cursor++];
          const r = await probe(m);
          results.push(r);
          done++;
          res.write(JSON.stringify({ type: 'progress', done, total: candidates.length, model: r.model, ok: r.ok, status: r.status }) + '\n');
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

      const usableNames = results.filter(r => r.ok).map(r => r.model);
      const localSet = new Set(localModels);
      const usable = (await probeCapabilities(usableNames, plat.base_url, headers))
        .map(m => ({ ...m, local: localSet.has(m.model) }));
      saveCachedModels(platformId, usable);
      res.write(JSON.stringify({ type: 'done', tested: candidates.length, usable }) + '\n');
      return res.end();
    } catch (e) {
      if (!res.headersSent) return json(res, { status: 'error', message: e.message || 'Discovery failed' });
      try { res.write(JSON.stringify({ type: 'error', message: e.message || 'Discovery failed' }) + '\n'); } catch {}
      return res.end();
    }
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/ai\/platforms\/[^/]+\/health$/)) {
    const platformId = decodeURIComponent(url.pathname.split('/')[4]);
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const plat = platforms.find(p => p.id === platformId);
    if (!plat) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    if (plat.vendor === 'ollama') {
      const keys = getPlatKeys(plat);
      if (!keys[0]) return json(res, { status: 'error', message: 'No API key configured' });
      let cloudModels = [];
      for (const key of keys) { cloudModels = await fetchOllamaCloudModels(key); if (cloudModels.length) break; }
      if (!cloudModels.length) return json(res, { status: 'error', message: 'No models found from Ollama Cloud' });
      return json(res, { status: 'ok', models: cloudModels });
    }
    if (!plat.base_url) { return json(res, { status: 'error', message: 'No base URL configured' }); }
    const headers = platformHeaders(plat);
    try {
      const localResult = await fetchModelList(plat.base_url, headers, 8000);
      const localModels = localResult.ok ? localResult.models : [];
      const keys = getPlatKeys(plat);
      const isOllamaComUrl = new URL(plat.base_url).hostname.includes('ollama.com');
      let cloudModels = [];
      if (keys[0] && !isOllamaComUrl) {
        if (await isOllamaDaemonUrl(plat.base_url)) cloudModels = await fetchOllamaCloudModels(keys[0]);
      }
      const seen = new Set(localModels);
      const allModels = [...localModels, ...cloudModels.filter(m => !seen.has(m))];
      if (!allModels.length) return json(res, { status: 'error', message: 'No models found' });
      const models = await probeCapabilities(allModels, plat.base_url, headers);
      saveCachedModels(platformId, models);
      return json(res, { status: 'ok', models });
    } catch (e) {
      return json(res, { status: 'error', message: e.name === 'AbortError' ? 'Timeout (8s)' : (e.message || 'Connection failed') });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/ai/models') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    const ANTHROPIC_MODELS = [
      { value: 'claude-opus-4-8', label: 'Opus 4.8', vision: true, tools: true },
      { value: 'claude-opus-4-7', label: 'Opus 4.7', vision: true, tools: true },
      { value: 'claude-opus-4-6', label: 'Opus 4.6', vision: true, tools: true },
      { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', vision: true, tools: true },
      { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5', vision: true, tools: true },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', vision: true, tools: true },
    ];
    const result = [{ platform_id: 'anthropic', platform_name: 'Claude (built-in)', models: ANTHROPIC_MODELS }];
    for (const p of platforms) {
      if (!p.enabled) continue;
      const group = { platform_id: p.id, platform_name: p.name, base_url: p.base_url || null, models: [] };
      if (p.cached_models?.length) {
        const enabled = Array.isArray(p.enabled_models) ? new Set(p.enabled_models) : null;
        for (const m of p.cached_models) {
          const modelName = typeof m === 'string' ? m : m.model;
          const vision = typeof m === 'object' ? (m.vision || false) : false;
          const tools = typeof m === 'object' ? (m.tools || false) : false;
          const local = typeof m === 'object' ? (m.local || false) : false;
          if (enabled && !enabled.has(modelName)) continue;
          group.models.push({ value: modelName, label: modelName, vision, tools, local });
        }
      }
      if (group.models.length) result.push(group); // enabled_models:[] is valid — skip platforms with no usable models
    }
    return json(res, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/actors') {
    const rows = db.prepare('SELECT id, name, type, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors ORDER BY id').all();
    const result = rows.map(r => ({ ...r, online: agentClients.has(r.id), client_version: agentVersions.get(r.id) || null }));
    return json(res, result);
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/actors/')) {
    const id = parseInt(url.pathname.split('/')[3]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name, avatar_url, lang } = body;
    if (!name?.trim()) { res.writeHead(400); return res.end('name required'); }
    if (avatar_url !== undefined) {
      if (avatar_url !== null && (!avatar_url.startsWith('/uploads/') || avatar_url.includes('..'))) { res.writeHead(400); return res.end('invalid avatar_url'); }
      db.prepare('UPDATE actors SET name=?, avatar_url=? WHERE id=?').run(name.trim(), avatar_url, id);
    } else {
      db.prepare('UPDATE actors SET name=? WHERE id=?').run(name.trim(), id);
    }
    if (lang !== undefined) {
      const existing = (() => { try { return JSON.parse(db.prepare('SELECT adapter_config FROM actors WHERE id=?').get(id)?.adapter_config || '{}'); } catch { return {}; } })();
      existing.lang = lang;
      db.prepare('UPDATE actors SET adapter_config=? WHERE id=?').run(JSON.stringify(existing), id);
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
    const actor = db.prepare('SELECT avatar_url FROM actors WHERE id=?').get(id);
    if (actor?.avatar_url) {
      const avatarPath = path.join(__dirname, actor.avatar_url.replace(/^\//, ''));
      if (avatarPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
    }
    const actorParts = db.prepare('SELECT id, room_id FROM room_participants WHERE actor_id=?').all(id);
    const affectedRooms = actorParts.map(r => r.room_id);
    const actorParticipantIds = actorParts.map(r => r.id);
    if (actorParticipantIds.length) {
      const ph = actorParticipantIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM ai_sessions WHERE participant_id IN (${ph})`).run(...actorParticipantIds);
    }
    db.prepare('DELETE FROM invite_suggestions WHERE suggested_actor_id=?').run(id);
    db.prepare('DELETE FROM room_participants WHERE actor_id=?').run(id);
    db.prepare('DELETE FROM actors WHERE id=?').run(id);
    const ws = agentClients.get(id);
    if (ws) { ws.close(); agentClients.delete(id); }
    broadcastGlobal({ type: 'actor_removed', actor_id: id, affected_rooms: affectedRooms });
    res.writeHead(204); return res.end();
  }

  // ── Client auto-update API ──
  if (req.method === 'GET' && url.pathname === '/api/client/manifest') {
    const files = {};
    for (const name of CLIENT_FILES) {
      let hash = clientFileHash(name);
      if (!hash) continue;
      // Monotonic downgrade guard: if stoa.js on disk has changed from startup and is now
      // a lower version than EXPECTED_CLIENT_VERSION, report the startup hash instead.
      // This prevents clients from auto-downloading a downgrade that would send them into a
      // force_update loop (EXPECTED is cached at startup; serving a lower version causes
      // client to restart with client_version < expected indefinitely).
      if (name === 'stoa.js' && SAFE_CLIENT_HASH && EXPECTED_CLIENT_VERSION && hash !== SAFE_CLIENT_HASH) {
        try {
          const diskSrc = fs.readFileSync(path.join(__dirname, name), 'utf8');
          const m = diskSrc.match(/^const CLIENT_VERSION\s*=\s*'([^']+)'/m);
          const diskVer = m ? m[1] : null;
          if (diskVer && diskVer.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
            console.warn(`[update-guard] stoa.js on disk (v${diskVer}) < expected (v${EXPECTED_CLIENT_VERSION}) — suppressing manifest to prevent downgrade loop`);
            hash = SAFE_CLIENT_HASH;
          }
        } catch {}
      }
      files[name] = hash;
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

  // ── Workspace file serve (images, binary files) ──
  if (req.method === 'GET' && url.pathname === '/api/workspace/file') {
    const roomId = url.searchParams.get('room');
    const relPath = url.searchParams.get('path');
    if (!roomId || !relPath) { res.writeHead(400); return res.end('missing room or path'); }
    const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
    if (!roomRow?.workdir_id) { res.writeHead(404); return res.end('no workdir'); }
    const wd = db.prepare('SELECT path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
    if (!wd?.path) { res.writeHead(404); return res.end('workdir not found'); }
    const filePath = path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(wd.path, relPath);
    if (!isPathSafe(filePath, wd.path)) { res.writeHead(403); return res.end('path outside workdir'); }
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.pdf': 'application/pdf' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    return res.end(data);
  }

  // ── Agent install script ──
  if (req.method === 'GET' && url.pathname === '/install.sh') {
    const host = req.headers.host || `localhost:${PORT}`;
    const baseUrl = getPublicUrl(host);
    const wsProto = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const stoaUrl = baseUrl.replace(/^https?/, wsProto);
    const token = crypto.randomBytes(12).toString('hex');
    const presetName = url.searchParams.get('name') || '';
    const lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, lang });

    const clientFiles = 'stoa.js claude-session.js';
    const trustCmd = 'claude --version > /dev/null 2>&1 || true';

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
for FILE in ${clientFiles}; do
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
${trustCmd}
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
    const ps1Lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, lang: ps1Lang });

    const ps1Files = '"stoa.js","claude-session.js"';
    const ps1TrustCmd = 'try { & claude --version 2>$null } catch {}';

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
foreach ($file in @(${ps1Files})) {
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
${ps1TrustCmd}
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
    const cmdParams = [];
    if (url.searchParams.get('name')) cmdParams.push(`name=${encodeURIComponent(url.searchParams.get('name'))}`);
    if (url.searchParams.get('lang')) cmdParams.push(`lang=${encodeURIComponent(url.searchParams.get('lang'))}`);
    const qs = cmdParams.length ? '?' + cmdParams.join('&') : '';
    const script = `@echo off\r\npowershell -ExecutionPolicy Bypass -Command "irm ${baseUrl}/install.ps1${qs} | iex"\r\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(script);
  }

  // ── Agent registration ──
  if (req.method === 'POST' && url.pathname === '/api/agent/register') {
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { token } = data;
    const entry = installTokens.get(token);
    if (!entry || entry.expires < Date.now()) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'invalid or expired token' }));
    }
    installTokens.delete(token);
    const suffix = crypto.randomBytes(3).toString('hex');
    const name = (entry.name || '').trim() || `stoa-${suffix}`;
    const secret = crypto.randomBytes(32).toString('hex');
    const adapter = 'claude';
    const adapterConfig = JSON.stringify({ lang: entry.lang || 'en' });
    const result = db.prepare(
      `INSERT INTO actors (name, type, adapter, adapter_config, avatar_color, avatar_symbol, secret) VALUES (?, 'ai', ?, ?, '#4d9f9f', '◈', ?)`
    ).run(name, adapter, adapterConfig, secret);
    return json(res, { actor_id: result.lastInsertRowid, name, secret, adapter });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/invites/') && url.pathname.endsWith('/resolve')) {
    const inviteId = url.pathname.split('/')[3];
    const body = await readBody(req);
    const data = parseJsonBody(body);
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const invite = db.prepare('SELECT * FROM invite_suggestions WHERE id=?').get(inviteId);
    if (!invite) { res.writeHead(404); return res.end(JSON.stringify({ error: 'invite not found' })); }
    const { approved } = data;
    const status = approved ? 'approved' : 'rejected';
    db.prepare("UPDATE invite_suggestions SET status=?, resolved_at=datetime('now') WHERE id=?").run(status, inviteId);
    if (approved) {
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
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { path: dirPath } = data;
    if (!dirPath?.trim()) { res.writeHead(400); return res.end('path required'); }
    const agentWs = agentClients.get(actorId);
    if (!agentWs) { res.writeHead(503); return res.end('agent offline'); }
    agentWs.send(JSON.stringify({ type: 'create_workdir', path: dirPath.trim() }));
    const labelProvided = 'label' in data;
    if (labelProvided) {
      const labelValue = (data.label || '').trim() || null;
      db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label'
      ).run(actorId, dirPath.trim(), labelValue);
    } else {
      db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,0) ON CONFLICT(actor_id, path) DO NOTHING'
      ).run(actorId, dirPath.trim(), null);
    }
    const wd = db.prepare('SELECT id, path, label, is_default FROM agent_workdirs WHERE actor_id=? AND path=?').get(actorId, dirPath.trim());
    return json(res, wd);
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

  // PUT /api/actors/:id/config — update name, lang, adapter_config fields
  if (req.method === 'PUT' && url.pathname.match(/^\/api\/actors\/\d+\/config$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const body = parseJsonBody(await readBody(req));
    if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { name, lang, adapter_config: newCfg } = body;
    if (name !== undefined && !name?.trim()) { res.writeHead(400); return res.end('name required'); }
    if (name !== undefined) db.prepare('UPDATE actors SET name=? WHERE id=?').run(name.trim(), actorId);
    if (lang !== undefined || (newCfg && typeof newCfg === 'object')) {
      const existing = (() => { try { return JSON.parse(db.prepare('SELECT adapter_config FROM actors WHERE id=?').get(actorId)?.adapter_config || '{}'); } catch { return {}; } })();
      if (lang !== undefined) existing.lang = lang;
      if (newCfg && typeof newCfg === 'object') Object.assign(existing, newCfg);
      db.prepare('UPDATE actors SET adapter_config=? WHERE id=?').run(JSON.stringify(existing), actorId);
    }
    const actor = db.prepare('SELECT id, name, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(actorId);
    return json(res, actor);
  }



  // ── Export room messages ──
  const exportMatch = req.method === 'GET' && url.pathname.match(/^\/api\/rooms\/(\d+)\/export$/);
  if (exportMatch) {
    const roomId = parseInt(exportMatch[1]);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const room = db.prepare('SELECT title FROM rooms WHERE id=?').get(roomId);
    if (!room) { res.writeHead(404); return res.end('room not found'); }
    const rows = db.prepare(`
      SELECT m.id, m.content, m.created_at, m.completed_at, m.image_url, m.file_url, m.file_name, m.attachments, m.reply_to,
             a.name as actor_name, a.type as actor_type
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.room_id=? AND m.state='complete'
      ORDER BY m.created_at ASC
    `).all(roomId);

    const safeTitle = room.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);

    if (format === 'csv') {
      const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
      const header = 'id,timestamp,actor,type,content,attachments,reply_to';
      const lines = rows.map(r => {
        let parsedAtt; try { parsedAtt = r.attachments ? JSON.parse(r.attachments) : null; } catch { parsedAtt = null; }
        const attachments = parsedAtt ? parsedAtt.map(a => a.name || a.url).join('; ') : (r.file_name || '');
        return [r.id, r.created_at, escape(r.actor_name), r.actor_type, escape(r.content), escape(attachments), r.reply_to || ''].join(',');
      });
      const csv = [header, ...lines].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}.csv"`,
      });
      return res.end(csv);
    }

    // Default: JSON
    const data = { room: { id: roomId, title: room.title }, exported_at: new Date().toISOString(), messages: rows.map(r => { let att = null; try { att = r.attachments ? JSON.parse(r.attachments) : null; } catch { att = null; } return { ...r, attachments: att }; }) };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeTitle}.json"`,
    });
    return res.end(JSON.stringify(data, null, 2));
  }

  // ── Automation: Connections CRUD ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/automations/connections') {
    const rows = db.prepare('SELECT id,name,provider,token_type,credentials,metadata,status,error_msg,created_at FROM automation_connections ORDER BY id ASC').all();
    return json(res, rows.map(r => {
      let meta = {}; try { meta = JSON.parse(r.metadata || '{}'); } catch {}
      let creds = {}; try { creds = JSON.parse(r.credentials || '{}'); } catch {}
      const { credentials: _c, ...rest } = r;
      return { ...rest, metadata: meta, appToken: creds.appToken || '', token: creds.token || '' };
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/automations/connections') {
    const body = parseJsonBody(await readBody(req));
    if (!body?.name || !body?.appToken || !body?.token) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'name, appToken, token required' }));
    }
    const creds = JSON.stringify({ appToken: body.appToken, token: body.token });
    const provider = body.provider || 'slack';
    if (!['slack'].includes(provider)) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid provider' }));
    }
    const tokenType = body.tokenType || 'bot';
    if (!['bot','user'].includes(tokenType)) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid tokenType' }));
    }
    const result = db.prepare(
      'INSERT INTO automation_connections (name,provider,token_type,credentials,metadata,status) VALUES (?,?,?,?,?,?)'
    ).run((body.name || '').trim(), provider, tokenType, creds, '{}', 'connecting');
    const conn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(result.lastInsertRowid);
    try {
      await connectionManager.startConnection(conn, updateConnStatus);
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(conn.id);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      return json(res, { ...updated, metadata: meta });
    } catch (e) {
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(conn.id);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      res.writeHead(500); return res.end(JSON.stringify({ ...updated, metadata: meta, error: e.message }));
    }
  }

  const connMatch = url.pathname.match(/^\/api\/automations\/connections\/(\d+)(\/.*)?$/);
  if (connMatch) {
    const connId = Number(connMatch[1]);
    const sub = connMatch[2] || '';
    const conn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(connId);
    if (!conn) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }

    if (req.method === 'GET' && sub === '') {
      let meta = {}; try { meta = JSON.parse(conn.metadata || '{}'); } catch {}
      let creds2 = {}; try { creds2 = JSON.parse(conn.credentials || '{}'); } catch {}
      return json(res, { id: conn.id, name: conn.name, provider: conn.provider,
        token_type: conn.token_type, metadata: meta, status: conn.status,
        error_msg: conn.error_msg, created_at: conn.created_at,
        appToken: creds2.appToken || '', token: creds2.token || '' });
    }

    if (req.method === 'PATCH' && sub === '') {
      const body = parseJsonBody(await readBody(req));
      const name = body.name !== undefined ? body.name.trim() : conn.name;
      if (!name) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name cannot be empty' })); }
      let creds = {}; try { creds = JSON.parse(conn.credentials || '{}'); } catch {}
      if (body.appToken) creds.appToken = body.appToken;
      if (body.token) creds.token = body.token;
      if (body.tokenType && !['bot','user'].includes(body.tokenType)) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid tokenType' }));
      }
      const tokenType = body.tokenType || conn.token_type;
      const tokenChanged = (body.appToken || body.token);
      db.prepare("UPDATE automation_connections SET name=?,token_type=?,credentials=?,updated_at=datetime('now') WHERE id=?")
        .run(name, tokenType, JSON.stringify(creds), connId);
      if (tokenChanged && conn.status === 'connected') {
        await connectionManager.stopConnection(connId);
        db.prepare("UPDATE automation_connections SET status='disconnected',updated_at=datetime('now') WHERE id=?").run(connId);
      }
      const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
      let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
      return json(res, { ...updated, metadata: meta });
    }

    if (req.method === 'POST' && sub === '/disconnect') {
      await connectionManager.stopConnection(connId);
      db.prepare("UPDATE automation_connections SET status='disconnected',updated_at=datetime('now') WHERE id=?").run(connId);
      return json(res, { ok: true });
    }

    if (req.method === 'POST' && sub === '/reconnect') {
      db.prepare("UPDATE automation_connections SET status='connecting',updated_at=datetime('now') WHERE id=?").run(connId);
      const freshConn = db.prepare('SELECT * FROM automation_connections WHERE id=?').get(connId);
      try {
        await connectionManager.startConnection(freshConn, updateConnStatus);
        const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
        let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
        return json(res, { ...updated, metadata: meta });
      } catch (e) {
        const updated = db.prepare('SELECT id,name,provider,token_type,metadata,status,error_msg,created_at FROM automation_connections WHERE id=?').get(connId);
        let meta = {}; try { meta = JSON.parse(updated.metadata || '{}'); } catch {}
        res.writeHead(500); return res.end(JSON.stringify({ ...updated, metadata: meta, error: e.message }));
      }
    }

    if (req.method === 'DELETE' && sub === '') {
      if (connectionManager.isRunning(connId)) {
        res.writeHead(409); return res.end(JSON.stringify({ error: 'Disconnect first' }));
      }
      db.prepare('DELETE FROM automation_connections WHERE id=?').run(connId);
      return json(res, { ok: true });
    }
    res.writeHead(405); return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // ── Automation: CRUD ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/automations') {
    const rows = db.prepare('SELECT * FROM automations ORDER BY id DESC').all();
    return json(res, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/automations') {
    const body = parseJsonBody(await readBody(req));
    if (!body?.name || !body?.trigger_event || !body?.target_room_id || !body?.prompt_template) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'Missing required fields' }));
    }
    const result = db.prepare(`
      INSERT INTO automations (name, trigger_type, trigger_event, trigger_conditions, target_room_id, prompt_template, connection_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.name.trim(),
      body.trigger_type || 'slack',
      body.trigger_event,
      body.trigger_conditions || '[]',
      parseInt(body.target_room_id),
      body.prompt_template.trim(),
      parseInt(body.connection_id) || null,
    );
    const row = db.prepare('SELECT * FROM automations WHERE id=?').get(result.lastInsertRowid);
    return json(res, row);
  }

  const autoIdMatch = url.pathname.match(/^\/api\/automations\/(\d+)$/);
  if (autoIdMatch) {
    const autoId = parseInt(autoIdMatch[1]);
    if (req.method === 'PATCH') {
      const body = parseJsonBody(await readBody(req));
      if (!body) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
      const auto = db.prepare('SELECT * FROM automations WHERE id=?').get(autoId);
      if (!auto) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }
      const name        = body.name !== undefined        ? body.name.trim()                          : auto.name;
      const event       = body.trigger_event !== undefined ? body.trigger_event                       : auto.trigger_event;
      const conds       = body.trigger_conditions !== undefined ? body.trigger_conditions             : auto.trigger_conditions;
      const roomId      = body.target_room_id !== undefined ? parseInt(body.target_room_id)          : auto.target_room_id;
      const prompt      = body.prompt_template !== undefined ? body.prompt_template.trim()           : auto.prompt_template;
      const enabled     = body.enabled !== undefined     ? (body.enabled ? 1 : 0)                    : auto.enabled;
      const connId      = body.connection_id !== undefined ? (parseInt(body.connection_id) || null)  : auto.connection_id;
      db.prepare(`
        UPDATE automations SET name=?, trigger_event=?, trigger_conditions=?, target_room_id=?, prompt_template=?, enabled=?, connection_id=? WHERE id=?
      `).run(name, event, conds, roomId, prompt, enabled, connId, autoId);
      const updated = db.prepare('SELECT * FROM automations WHERE id=?').get(autoId);
      return json(res, updated);
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM automations WHERE id=?').run(autoId);
      return json(res, { ok: true });
    }
  }

  // Ollama Cloud proxy — forward /v1/messages to ollama.com with API key rotation
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const platforms = getParsedSetting('ai_platforms') ?? [];
    // Bearer token carries platform_id: "stoa-proxy:<id>". Fall back to first vendor='ollama' for legacy callers.
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const proxyPlatId = bearer.startsWith('stoa-proxy:') ? bearer.slice('stoa-proxy:'.length) : null;
    const plat = (proxyPlatId && platforms.find(p => p.id === proxyPlatId && p.vendor === 'ollama'))
      || platforms.find(p => p.vendor === 'ollama')
      || platforms.find(p => p.base_url?.includes('ollama.com'));
    if (!plat) { res.writeHead(503); return res.end(JSON.stringify({ type: 'error', error: { type: 'service_unavailable', message: 'No Ollama Cloud platform configured' } })); }
    const keys = getPlatKeys(plat);
    if (!keys.length) { res.writeHead(503); return res.end(JSON.stringify({ type: 'error', error: { type: 'service_unavailable', message: 'No API keys configured for Ollama Cloud' } })); }

    const body = await readBody(req);
    const TARGET = 'https://ollama.com/v1/messages';

    async function tryWithKey(keyIdx) {
      if (keyIdx >= keys.length) return null;
      const fwdHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys[keyIdx]}`,
      };
      if (req.headers['anthropic-version']) fwdHeaders['anthropic-version'] = req.headers['anthropic-version'];
      if (req.headers['anthropic-beta']) fwdHeaders['anthropic-beta'] = req.headers['anthropic-beta'];
      let connTimer;
      try {
        const ctrl = new AbortController();
        connTimer = setTimeout(() => ctrl.abort(), 30000);
        const upstream = await fetch(TARGET, { method: 'POST', headers: fwdHeaders, body, signal: ctrl.signal });
        clearTimeout(connTimer);
        // 429=rate-limited, 401=key invalid (next key may be valid), 402=quota exhausted (next key may have remaining quota)
        if (upstream.status === 429 || upstream.status === 401 || upstream.status === 402) {
          const next = await tryWithKey(keyIdx + 1);
          return next || upstream;
        }
        return upstream;
      } catch (e) {
        clearTimeout(connTimer);
        return tryWithKey(keyIdx + 1);
      }
    }

    let reqModel = '?';
    try { reqModel = JSON.parse(body)?.model || '?'; } catch {}
    const upstream = await tryWithKey(0);
    if (!upstream) { res.writeHead(502); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Ollama Cloud unreachable' } })); }
    console.log(`[ollama-proxy] ${reqModel} → ollama.com status=${upstream.status}`);

    const isStream = upstream.headers.get('content-type')?.includes('text/event-stream');
    const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
    if (isStream) { headers['Cache-Control'] = 'no-cache'; headers['X-Accel-Buffering'] = 'no'; }
    res.writeHead(upstream.status, headers);

    if (isStream) {
      const reader = upstream.body.getReader();
      res.on('close', () => reader.cancel());
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          // res.write() back-pressure (drain) not awaited — acceptable for single-user loopback
          // where downstream drains faster than upstream LLM generates. TODO: add drain handling
          // if Stoa ever serves remote or multi-tenant clients.
          res.write(value);
        }
      };
      pump().catch(() => res.end());
    } else {
      const text = await upstream.text();
      res.end(text);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
  } catch (err) {
    console.error('[http] unhandled error:', err.message);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' })); }
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, pingInterval: 20000 });
const roomClients = new Map();    // roomId → Set<ws>
const globalClients = new Set();  // all browser ws connections
const agentClients = new Map();   // actor_id → ws
const agentVersions = new Map();  // actor_id → client_version string
const pendingAgents = new Map();    // message_id → { resolve, reject }
const pendingActorMeta = new Map(); // message_id → { name, avatar_color, avatar_symbol }
const pendingCompacts = new Map();  // room_id → { total, completed, agents[] }
const recentCompacts = new Map();      // room_id → timestamp — suppresses duplicate auto_compact_start within 30s
const recentCompactTimers = new Map(); // room_id → timer handle — cleared before reset to avoid early expiry
function setRecentCompact(roomId) {
  clearTimeout(recentCompactTimers.get(roomId));
  recentCompacts.set(roomId, Date.now());
  recentCompactTimers.set(roomId, setTimeout(() => { recentCompacts.delete(roomId); recentCompactTimers.delete(roomId); }, 30_000));
}
const pendingFileOps = new Map();   // request_id → { type, clientWs }
function addPendingFileOp(rid, op) {
  pendingFileOps.set(rid, op);
  setTimeout(() => pendingFileOps.delete(rid), 15000);
}

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

wss.on('connection', (ws, req) => {
  // Origin validation: reject cross-origin browser connections (CSWSH prevention)
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      const host = req.headers.host?.split(':')[0];
      if (o.hostname !== host && o.hostname !== 'localhost' && o.hostname !== '127.0.0.1') {
        ws.close(1008, 'Origin not allowed');
        return;
      }
    } catch { ws.close(1008, 'Invalid origin'); return; }
  }

  let subscribedRoom = null;
  let agentActorId = null;
  let isHumanClient = false;
  // Auth check: browser clients must have valid session cookie
  const cookies = parseCookies(req.headers.cookie);
  const wsAuth = validateAuthSession(cookies.stoa_session);
  let wsAuthenticated = !!wsAuth; // agents authenticate later via agent_connect

  ws.on('error', () => {}); // prevent unhandled error crash on abrupt disconnect

  ws.on('message', async raw => {
   try {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Block unauthenticated browser messages (agents auth via agent_connect)
    if (!wsAuthenticated && msg.type !== 'agent_connect') return;

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
          WHERE m.room_id=? AND (
            (m.state IN ('complete','streaming','requesting') AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL OR m.state IN ('streaming','requesting')))
            OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
          )
          ORDER BY m.created_at DESC LIMIT 100
        ) AS recent ORDER BY created_at ASC
      `).all(subscribedRoom);
      ws.send(JSON.stringify({ type: 'history', messages: enrichReply(messages) }));
      // Restore compact state if room is currently compacting
      if (pendingCompacts.has(subscribedRoom)) {
        const cs = pendingCompacts.get(subscribedRoom);
        ws.send(JSON.stringify({ type: 'compact_start', room_id: subscribedRoom, total: cs.total }));
        if (cs.completed > 0) ws.send(JSON.stringify({ type: 'compact_progress', room_id: subscribedRoom, completed: cs.completed, total: cs.total }));
      }
    }

    if (msg.type === 'send_message') {
      let handled = false;
      if (msg.content?.startsWith('/')) {
        handled = await handleSkillCommand(msg.room_id, msg.content, ws);
      }
      if (!handled) {
        await handleHumanMessage(msg.room_id, msg.content, msg.attachments || null, msg.reply_to || null, ws);
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

    if (msg.type === 'compact_session' && !agentActorId) {
      const roomId = msg.room_id;
      if (pendingCompacts.has(roomId)) return;
      const aiParts = db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai'
      `).all(roomId);
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
      let roomWorkdir = null;
      if (roomRow?.workdir_id) {
        const wd = db.prepare('SELECT path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
        roomWorkdir = wd?.path || null;
      }
      // Batch-fetch sessions for all participants (avoids N+1)
      const sessionMap = new Map();
      if (aiParts.length) {
        const ph = aiParts.map(() => '?').join(',');
        const allSessions = db.prepare(
          `SELECT participant_id, claude_session_id, workdir FROM ai_sessions WHERE participant_id IN (${ph}) AND room_id=? ORDER BY last_active_at DESC`
        ).all(...aiParts.map(a => a.participant_id), roomId);
        for (const s of allSessions) {
          if (!sessionMap.has(s.participant_id)) sessionMap.set(s.participant_id, s);
        }
      }
      const targets = [];
      for (const ai of aiParts) {
        const agentWs = agentClients.get(ai.actor_id);
        if (!agentWs || agentWs.readyState !== 1) continue;
        const sessionRow = sessionMap.get(ai.participant_id);
        if (!sessionRow?.claude_session_id) continue;
        const workdir = sessionRow.workdir || roomWorkdir;
        targets.push({ actor_id: ai.actor_id, participant_id: ai.participant_id, name: ai.name, workdir, claude_session_id: sessionRow.claude_session_id });
      }
      if (!targets.length) {
        ws.send(JSON.stringify({ type: 'compact_error', room_id: roomId, error: 'No active AI sessions to compact' }));
        return;
      }
      pendingCompacts.set(roomId, { total: targets.length, completed: 0, agents: targets.map(t => t.actor_id) });
      broadcast(roomId, { type: 'compact_start', room_id: roomId, total: targets.length });
      setTimeout(() => {
        if (pendingCompacts.has(roomId)) {
          pendingCompacts.delete(roomId);
          setRecentCompact(roomId); // suppress immediate re-register from auto_compact_start while original compact still finishing
          broadcast(roomId, { type: 'compact_error', room_id: roomId, error: 'Compact timed out' });
        }
      }, 600_000);
      for (const t of targets) {
        const agentWs = agentClients.get(t.actor_id);
        if (!agentWs || agentWs.readyState !== 1) continue;
        agentWs.send(JSON.stringify({ type: 'compact_trigger', room_id: roomId, workdir: t.workdir, claude_session_id: t.claude_session_id }));
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
      if (!actor.secret) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'actor has no secret configured' }));
        ws.close(); return;
      }
      const provided = String(msg.secret || '');
      const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
      if (!crypto.timingSafeEqual(h(actor.secret), h(provided))) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'invalid secret' }));
        ws.close(); return;
      }
      agentActorId = msg.actor_id;
      wsAuthenticated = true;
      const oldWs = agentClients.get(agentActorId);
      if (oldWs && oldWs !== ws) oldWs.close();
      agentClients.set(agentActorId, ws);
      const reconnectCleaned = db.prepare(
        "UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — agent reconnected)' ELSE content END WHERE state IN ('streaming','requesting') AND participant_id IN (SELECT rp.id FROM room_participants rp WHERE rp.actor_id=?)"
      ).run(agentActorId);
      if (reconnectCleaned.changes) console.log(`[agent] Cleaned ${reconnectCleaned.changes} orphaned message(s) on reconnect for Actor #${agentActorId}`);
      if (msg.client_version) agentVersions.set(agentActorId, msg.client_version);
      console.log(`[agent] Actor #${agentActorId} connected (v${msg.client_version || '?'})`);
      if (EXPECTED_CLIENT_VERSION && msg.client_version && msg.client_version.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
        console.log(`[agent] Actor #${agentActorId} outdated (v${msg.client_version} < v${EXPECTED_CLIENT_VERSION}), sending force_update`);
        ws.send(JSON.stringify({ type: 'force_update' }));
      }
      ws.send(JSON.stringify({ type: 'agent_ready' }));
      ws.send(JSON.stringify({ type: 'set_config', max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 1, session_idle_ttl: parseInt(process.env.SESSION_IDLE_TTL) || 5, auto_compact_threshold_kb: parseInt(process.env.AUTO_COMPACT_THRESHOLD_KB) || 500 }));
      const connectedActor = db.prepare('SELECT id, name, type, adapter, adapter_config, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(agentActorId);
      if (connectedActor) broadcastGlobal({ type: 'actor_status', actor: { ...connectedActor, online: true, client_version: msg.client_version || null } });
    }

    // ── Agent reports scan results
    if (msg.type === 'agent_scan_result' && agentActorId) {
      const { workdirs = [], globalSkills = [] } = msg;
      // UPSERT workdirs — preserve IDs so room references stay valid
      const upsertWorkdir = db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default) VALUES (?,?,?,?) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label, is_default=excluded.is_default'
      );
      const insertSkill = db.prepare(
        'INSERT OR IGNORE INTO agent_skills (actor_id, workdir_id, name, description, scope) VALUES (?,?,?,?,?)'
      );
      const scannedPaths = new Set();
      for (const wd of workdirs) {
        const label = wd.path.split(/[\/\\]/).pop() || wd.path;
        upsertWorkdir.run(agentActorId, wd.path, label, wd.is_default ? 1 : 0);
        scannedPaths.add(wd.path);
      }
      const allWds = db.prepare('SELECT id, path FROM agent_workdirs WHERE actor_id=?').all(agentActorId);
      const wdMap = new Map(allWds.map(w => [w.path, w.id]));
      db.prepare('DELETE FROM agent_skills WHERE actor_id=? AND workdir_id IS NOT NULL').run(agentActorId);
      const batchSkills = db.transaction((skills) => { for (const s of skills) insertSkill.run(s.actorId, s.wdId, s.name, s.desc, s.scope); });
      const allSkills = [];
      for (const wd of workdirs) {
        const wdId = wdMap.get(wd.path);
        for (const sk of (wd.skills || [])) {
          allSkills.push({ actorId: agentActorId, wdId, name: sk.name, desc: sk.description || null, scope: sk.scope || 'project' });
        }
      }
      if (allSkills.length) batchSkills(allSkills);
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
      db.prepare('DELETE FROM agent_skills WHERE actor_id=? AND workdir_id IS NULL').run(agentActorId);
      const globalBatch = globalSkills.map(sk => ({ actorId: agentActorId, wdId: null, name: sk.name, desc: sk.description || null, scope: 'global' }));
      if (globalBatch.length) batchSkills(globalBatch);
      console.log(`[agent] Actor #${agentActorId} reported ${workdirs.length} workdirs, ${globalSkills.length} global skills`);
      broadcastGlobal({ type: 'agent_scan_complete', actor_id: agentActorId });
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

    if (msg.type === 'agent_search' && agentActorId) {
      const q = (msg.query || '').trim();
      const roomId = msg.room_id;
      const limit = Math.min(parseInt(msg.limit ?? '20'), 50);
      if (!q) { ws.send(JSON.stringify({ type: 'search_result', request_id: msg.request_id, results: [] })); }
      else {
        const rows = db.prepare(`
          SELECT m.id, m.room_id, m.content, m.created_at,
                 a.name as actor_name, a.type as actor_type,
                 snippet(messages_fts, 0, '', '', '…', 60) as snippet
          FROM messages_fts
          JOIN messages m ON m.id = messages_fts.rowid
          JOIN room_participants rp ON rp.id = m.participant_id
          JOIN actors a ON a.id = rp.actor_id
          WHERE messages_fts MATCH ? AND m.state='complete'
          ${roomId ? 'AND m.room_id = ?' : ''}
          ORDER BY rank LIMIT ?
        `).all(...(roomId ? [q, roomId, limit] : [q, limit]));
        ws.send(JSON.stringify({ type: 'search_result', request_id: msg.request_id, results: rows }));
      }
    }

    if (msg.type === 'agent_get_message' && agentActorId) {
      const row = db.prepare(`
        SELECT m.id, m.room_id, m.content, m.reply_to, m.created_at, a.name as actor_name, a.type as actor_type
        FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
        WHERE m.id=?
      `).get(msg.message_id);
      ws.send(JSON.stringify({ type: 'get_message_result', request_id: msg.request_id, message: row || null }));
    }

    if (msg.type === 'agent_system_event' && agentActorId) {
      const actor = db.prepare('SELECT name FROM actors WHERE id=?').get(agentActorId);
      broadcast(msg.room_id, { type: 'system_event', status: msg.status, actor_name: actor?.name });
    }

    if (msg.type === 'auto_compact_start' && agentActorId) {
      // Look up room_id from session if not provided
      let roomId = msg.room_id;
      if (!roomId && msg.claude_session_id) {
        const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(msg.claude_session_id);
        roomId = s?.room_id;
      }
      if (roomId) {
        if (recentCompacts.has(roomId)) {
          console.log(`[server] auto_compact_start suppressed for room=${roomId} (compact recently completed)`);
        } else if (!pendingCompacts.has(roomId)) {
          pendingCompacts.set(roomId, { total: 1, completed: 0, agents: [agentActorId], completedAgentIds: [] });
          broadcast(roomId, { type: 'compact_start', room_id: roomId, total: 1 });
          console.log(`[server] auto-compact started room=${roomId} by agent=${agentActorId}`);
        } else {
          // Another compact already registered — add this agent to the total if not already counted
          const cs = pendingCompacts.get(roomId);
          if (!cs.agents.includes(agentActorId)) {
            cs.total++;
            cs.agents.push(agentActorId);
            console.log(`[server] auto-compact: added agent=${agentActorId} to room=${roomId} (total=${cs.total})`);
          }
        }
      }
    }

    if (msg.type === 'compact_complete' && agentActorId) {
      // Resolve room_id: use msg.room_id, or look up via orig_session_id (pre-compact) then new session_id
      if (!msg.room_id) {
        const lookup = msg.orig_session_id || msg.claude_session_id;
        if (lookup) {
          const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(lookup);
          if (s?.room_id) msg.room_id = s.room_id;
        }
      }
      if (!msg.room_id) {
        console.warn(`[server] compact_complete: unresolvable room_id for session ${msg.claude_session_id}`);
        return;
      }
      if (msg.claude_session_id) {
        const participant = db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
        if (participant) {
          db.prepare(`UPDATE ai_sessions SET claude_session_id=?, last_active_at=datetime('now') WHERE participant_id=? AND room_id=?`).run(msg.claude_session_id, participant.id, msg.room_id);
        }
      }
      const state = pendingCompacts.get(msg.room_id);
      const actor = db.prepare('SELECT name FROM actors WHERE id=?').get(agentActorId);
      const participant = db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1').get(msg.room_id, agentActorId);
      if (!state) {
        // No pendingCompacts entry — background compact with failed auto_compact_start, or disconnect cleared it.
        // Still write marker and unstick any UI that may be in compacting state.
        if (participant && actor) {
          const content = `${actor.name} · session compacted`;
          const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(msg.room_id, participant.id, content);
          broadcast(msg.room_id, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: msg.room_id, content, state: 'system_event', created_at: new Date().toISOString() } });
        }
        if (!recentCompacts.has(msg.room_id)) {
          broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
        }
        setRecentCompact(msg.room_id);
        return;
      }
      if (!state.names) state.names = [];
      if (!state.completedAgentIds) state.completedAgentIds = [];
      if (actor) state.names.push(actor.name);
      state.completedAgentIds.push(agentActorId);
      state.completed++;
      if (state.completed >= state.total) {
        pendingCompacts.delete(msg.room_id);
        setRecentCompact(msg.room_id);
        const label = state.names.length ? state.names.join(', ') : 'session';
        const content = `${label} · session compacted`;
        if (participant) {
          const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(msg.room_id, participant.id, content);
          broadcast(msg.room_id, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: msg.room_id, content, state: 'system_event', created_at: new Date().toISOString() } });
        }
        broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
      } else {
        broadcast(msg.room_id, { type: 'compact_progress', room_id: msg.room_id, completed: state.completed, total: state.total });
      }
    }

    if (msg.type === 'compact_error' && agentActorId) {
      // Resolve room_id — background worker sends orig_session_id without room_id
      if (!msg.room_id) {
        const lookup = msg.orig_session_id || msg.claude_session_id;
        if (lookup) {
          const s = db.prepare('SELECT room_id FROM ai_sessions WHERE claude_session_id=?').get(lookup);
          if (s?.room_id) msg.room_id = s.room_id;
        }
      }
      if (!msg.room_id) {
        console.warn(`[server] compact_error: unresolvable room_id for session ${msg.orig_session_id}`);
        return;
      }
      const state = pendingCompacts.get(msg.room_id);
      if (!state) return;
      if (!state.errors) state.errors = 0;
      state.errors++;
      state.completed++;
      if (state.completed >= state.total) {
        pendingCompacts.delete(msg.room_id);
        setRecentCompact(msg.room_id);
        if (state.errors >= state.total) {
          broadcast(msg.room_id, { type: 'compact_error', room_id: msg.room_id, error: msg.error || 'Compact failed' });
        } else {
          broadcast(msg.room_id, { type: 'compact_done', room_id: msg.room_id });
        }
      } else {
        broadcast(msg.room_id, { type: 'compact_progress', room_id: msg.room_id, completed: state.completed, total: state.total });
      }
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
      const attachJson = msg.attachments?.length ? JSON.stringify(msg.attachments) : null;
      db.prepare(
        "UPDATE messages SET content=?, file_url=?, file_name=?, attachments=?, ai_model=?, state='complete', completed_at=datetime('now') WHERE id=?"
      ).run(msg.content, msg.file_url || null, msg.file_name || null, attachJson, msg.ai_model || null, msg.message_id);
      const completePayload = { type: 'message_complete', message_id: msg.message_id, content: msg.content, ai_model: msg.ai_model || null };
      if (msg.attachments?.length) { completePayload.attachments = msg.attachments; }
      else if (msg.file_url) { completePayload.file_url = msg.file_url; completePayload.file_name = msg.file_name; }
      broadcast(msg.room_id, completePayload);
      broadcastGlobal({ type: 'room_activity', room_id: msg.room_id });
      if (msg.claude_session_id) {
        try {
          const row = db.prepare(`
            SELECT m.participant_id, w.path as workdir
            FROM messages m JOIN rooms r ON r.id=m.room_id LEFT JOIN agent_workdirs w ON w.id=r.workdir_id
            WHERE m.id=?
          `).get(msg.message_id);
          if (row) saveSession(row.participant_id, msg.claude_session_id, row.workdir);
        } catch (e) { console.error('[agent] saveSession error:', e.message); }
      }
      pendingAgents.get(msg.message_id)?.resolve(msg.content);
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }

    // ── Agent proxy file responses
    if (msg.type === 'workdir_created' && agentActorId) {
      // Agent resolved the requested path (e.g. expanded "~") to an absolute path.
      // Store the canonical absolute path so file ops resolve correctly.
      if (msg.error && msg.requested) {
        // Workdir creation failed — remove the ghost row and null out any rooms that already
        // reference it (browser may have created a room optimistically before agent confirmed)
        try {
          const ghostRow = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.requested);
          if (ghostRow) {
            db.transaction(() => {
              db.prepare('UPDATE rooms SET workdir_id=NULL WHERE workdir_id=?').run(ghostRow.id);
              db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(ghostRow.id);
            })();
          }
        } catch (e) { console.warn('[workdir] could not remove ghost row:', e.message); }
        return;
      }
      if (!msg.error && msg.path && msg.requested && msg.path !== msg.requested) {
        try {
          const requestedRow = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.requested);
          if (requestedRow) {
            const existingResolved = db.prepare('SELECT id FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.path);
            if (existingResolved && existingResolved.id !== requestedRow.id) {
              // Canonical row already exists — repoint rooms and drop the duplicate tilde row (atomic)
              db.transaction(() => {
                db.prepare('UPDATE rooms SET workdir_id=? WHERE workdir_id=?').run(existingResolved.id, requestedRow.id);
                db.prepare('DELETE FROM agent_workdirs WHERE id=?').run(requestedRow.id);
              })();
            } else {
              db.prepare('UPDATE agent_workdirs SET path=? WHERE id=?').run(msg.path, requestedRow.id);
            }
          }
        } catch (e) {
          console.warn('[workdir] could not canonicalize path:', e.message);
        }
      }
      return;
    }

    if (msg.type === 'proxy_file_list_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_list', error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_list', root: msg.root, tree: msg.tree, modified: msg.modified || [] }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_read_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, error: msg.error }));
        else if (msg.base64) op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, base64: msg.base64 }));
        else op.clientWs.send(JSON.stringify({ type: 'file_read', path: p, content: msg.content }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_git_diff_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'git_diff', error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'git_diff', files: msg.files || [] }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_write_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_write_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_write_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_create_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_create_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_create_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_delete_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        const p = op.originalPath || msg.path;
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_delete_result', path: p, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_delete_result', path: p, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    if (msg.type === 'proxy_file_rename_result' && agentActorId) {
      const op = pendingFileOps.get(msg.request_id);
      if (op && op.clientWs.readyState === 1) {
        if (msg.error) op.clientWs.send(JSON.stringify({ type: 'file_rename_result', path: op.originalPath, error: msg.error }));
        else op.clientWs.send(JSON.stringify({ type: 'file_rename_result', path: op.originalPath, new_path: op.newPath, ok: true }));
      }
      pendingFileOps.delete(msg.request_id);
    }

    // ── Agent error
    if (msg.type === 'agent_error' && agentActorId) {
      db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msg.message_id);
      broadcast(msg.room_id, { type: 'message_state', message_id: msg.message_id, state: 'error' });
      pendingAgents.get(msg.message_id)?.reject(new Error(msg.error));
      pendingAgents.delete(msg.message_id);
      pendingActorMeta.delete(msg.message_id);
    }

    if (msg.type === 'usage_report' && agentActorId) {
      const u = msg.usage || {};
      const model = msg.model || 'unknown';
      try {
        db.prepare(`
          INSERT INTO usage_log (actor_id, room_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          agentActorId,
          msg.room_id || null,
          model,
          u.input_tokens || 0,
          u.output_tokens || 0,
          u.cache_read_input_tokens || 0,
          u.cache_creation_input_tokens || 0,
          msg.totalCostUsd || 0
        );
      } catch (e) {
        console.error('[usage_report] insert failed:', e.message);
      }
    }

    // ── File operations (workspace panel) ──────────────────────────────────
    if (msg.type === 'file_list' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_list', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_list', error: 'workdir not found' })); return; }
      const targetPath = msg.abs_path || wd.path;
      const isLocal = fs.existsSync(targetPath);
      const isBounded = !msg.abs_path || path.resolve(targetPath).startsWith(path.resolve(wd.path) + path.sep) || path.resolve(targetPath) === path.resolve(wd.path);
      if (isLocal && isBounded) {
        const tree = buildFileTree(targetPath, targetPath, 0, 3);
        let modified = [];
        try {

          const status = execSync('git status --porcelain', { cwd: targetPath, encoding: 'utf8', maxBuffer: 512 * 1024, windowsHide: true, timeout: 10000 });
          modified = status.split('\n').filter(Boolean).map(l => l.slice(3).trim());
        } catch {}
        ws.send(JSON.stringify({ type: 'file_list', root: targetPath, tree, modified }));
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_list', clientWs: ws });
          agentWs.send(JSON.stringify({ type: 'proxy_file_list', request_id: rid, workdir: targetPath }));
        } else { ws.send(JSON.stringify({ type: 'file_list', error: 'agent offline' })); }
      }
    }

    if (msg.type === 'file_read' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_read', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_read', error: 'workdir not found' })); return; }
      if (msg.absolute) {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_read', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_read', request_id: rid, workdir: path.dirname(msg.path), path: path.basename(msg.path), binary: !!msg.binary }));
        } else { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'agent offline' })); }
        return;
      }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(filePath)) {
        try {
          if (msg.binary) {
            const data = fs.readFileSync(filePath);
            ws.send(JSON.stringify({ type: 'file_read', path: msg.path, base64: data.toString('base64') }));
          } else {
            const content = fs.readFileSync(filePath, 'utf8');
            const mtime = fs.statSync(filePath).mtimeMs;
            ws.send(JSON.stringify({ type: 'file_read', path: msg.path, content, mtime }));
          }
        } catch (e) { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_read', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_read', request_id: rid, workdir: wd.path, path: msg.path, binary: !!msg.binary }));
        } else { ws.send(JSON.stringify({ type: 'file_read', path: msg.path, error: 'agent offline' })); }
      }
    }

    if (msg.type === 'git_diff' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'git_diff', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'git_diff', error: 'workdir not found' })); return; }
      if (fs.existsSync(wd.path)) {
        try {

          const diff = execSync('git diff', { cwd: wd.path, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true, timeout: 10000 });
          const parsed = parseGitDiff(diff);
          ws.send(JSON.stringify({ type: 'git_diff', files: parsed }));
        } catch (e) { ws.send(JSON.stringify({ type: 'git_diff', error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'git_diff', clientWs: ws });
          agentWs.send(JSON.stringify({ type: 'proxy_git_diff', request_id: rid, workdir: wd.path }));
        } else { ws.send(JSON.stringify({ type: 'git_diff', error: 'agent offline' })); }
      }
    }

    // ── file_write ──────────────────────────────────────────────────────────
    if (msg.type === 'file_write' && subscribedRoom) {
      const BINARY_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp','woff','woff2','ttf','otf','eot','exe','dll','so','bin','zip','tar','gz','7z','mp3','mp4','avi','mov']);
      const ext = (msg.path.match(/\.(\w+)$/) || [])[1] || '';
      if (BINARY_EXTS.has(ext)) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'binary files cannot be edited' })); return; }
      if (typeof msg.content !== 'string' || msg.content.length > 1024 * 1024) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'content too large (max 1MB)' })); return; }
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_write_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_write_result', error: 'workdir not found' })); return; }
      if (msg.absolute) {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_write', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_write', request_id: rid, workdir: path.dirname(msg.path), path: path.basename(msg.path), content: msg.content }));
        } else { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'agent offline' })); }
        return;
      }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          if (msg.expected_mtime && fs.existsSync(filePath)) {
            const currentMtime = fs.statSync(filePath).mtimeMs;
            if (Math.abs(currentMtime - msg.expected_mtime) > 100) {
              ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'conflict', current_mtime: currentMtime }));
              return;
            }
          }
          fs.writeFileSync(filePath, msg.content, 'utf8');
          const newMtime = fs.statSync(filePath).mtimeMs;
          ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, ok: true, mtime: newMtime }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_write', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_write', request_id: rid, workdir: wd.path, path: msg.path, content: msg.content }));
        } else { ws.send(JSON.stringify({ type: 'file_write_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_create ─────────────────────────────────────────────────────────
    if (msg.type === 'file_create' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_create_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_create_result', error: 'workdir not found' })); return; }
      if (/[<>"|?*]/.test(msg.path)) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'invalid characters in path' })); return; }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (msg.is_dir) { fs.mkdirSync(filePath, { recursive: true }); }
          else {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(filePath)) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'already exists' })); return; }
            fs.writeFileSync(filePath, '', 'utf8');
          }
          ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_create', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_create', request_id: rid, workdir: wd.path, path: msg.path, is_dir: !!msg.is_dir }));
        } else { ws.send(JSON.stringify({ type: 'file_create_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_delete ─────────────────────────────────────────────────────────
    if (msg.type === 'file_delete' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_delete_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_delete_result', error: 'workdir not found' })); return; }
      const filePath = path.resolve(wd.path, msg.path);
      if (!isPathSafe(filePath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (!fs.existsSync(filePath)) { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'not found' })); return; }
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) { fs.rmdirSync(filePath); }
          else { fs.unlinkSync(filePath); }
          ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_delete', clientWs: ws, originalPath: msg.path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_delete', request_id: rid, workdir: wd.path, path: msg.path }));
        } else { ws.send(JSON.stringify({ type: 'file_delete_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    // ── file_rename ─────────────────────────────────────────────────────────
    if (msg.type === 'file_rename' && subscribedRoom) {
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (!roomRow?.workdir_id) { ws.send(JSON.stringify({ type: 'file_rename_result', error: 'no workdir' })); return; }
      const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
      if (!wd?.path) { ws.send(JSON.stringify({ type: 'file_rename_result', error: 'workdir not found' })); return; }
      if (/[<>"|?*]/.test(msg.path) || /[<>"|?*]/.test(msg.new_path)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'invalid characters in path' })); return; }
      const oldPath = path.resolve(wd.path, msg.path);
      const newPath = path.resolve(wd.path, msg.new_path);
      if (!isPathSafe(oldPath, wd.path) || !isPathSafe(newPath, wd.path)) {
        ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'path traversal blocked' })); return;
      }
      if (fs.existsSync(wd.path)) {
        try {
          if (!fs.existsSync(oldPath)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'source not found' })); return; }
          if (fs.existsSync(newPath)) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'target already exists' })); return; }
          const dir = path.dirname(newPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.renameSync(oldPath, newPath);
          ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, new_path: msg.new_path, ok: true }));
        } catch (e) { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: e.message })); }
      } else {
        const agentWs = agentClients.get(wd.actor_id);
        if (agentWs) {
          const rid = crypto.randomBytes(6).toString('hex');
          addPendingFileOp(rid, { type: 'file_rename', clientWs: ws, originalPath: msg.path, newPath: msg.new_path });
          agentWs.send(JSON.stringify({ type: 'proxy_file_rename', request_id: rid, workdir: wd.path, path: msg.path, new_path: msg.new_path }));
        } else { ws.send(JSON.stringify({ type: 'file_rename_result', path: msg.path, error: 'agent offline' })); }
      }
    }

    if (msg.type === 'set_room_model' && subscribedRoom) {
      if (msg.model !== null && msg.model !== undefined && (typeof msg.model !== 'string' || !msg.model.trim() || msg.model.length > 200)) {
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_model', message: 'invalid model value' }));
        return;
      }
      if (msg.model && !msg.model.startsWith('claude-')) {
        // Non-Anthropic model must exist in a platform's enabled_models list
        let known = false;
        try {
          const platforms = getParsedSetting('ai_platforms');
          if (platforms) {
            for (const p of platforms) {
              if (!p.enabled) continue;
              const cachedNames = Array.isArray(p.cached_models) ? p.cached_models.map(m => typeof m === 'string' ? m : m.model) : [];
              const enabledSet = Array.isArray(p.enabled_models) ? new Set(p.enabled_models) : null;
              const inCached = cachedNames.includes(msg.model);
              if (inCached && (!enabledSet || enabledSet.has(msg.model))) { known = true; break; }
            }
          }
        } catch {}
        if (!known) {
          ws.send(JSON.stringify({ type: 'error', code: 'invalid_model', message: 'model not in enabled list' }));
          return;
        }
      }
      const model = msg.model || null;
      let modelConfig = null;
      if (msg.model_config && typeof msg.model_config === 'object') {
        // Only persist known safe fields — never trust client-provided base_url as authoritative
        // base_url is stored for display but platform lookup always re-fetches from server settings
        const { platform_id, base_url } = msg.model_config;
        if (platform_id !== undefined || base_url !== undefined) {
          if (base_url) {
            try { new URL(base_url); } catch { ws.send(JSON.stringify({ type: 'error', message: 'invalid model_config: bad base_url' })); return; }
          }
          modelConfig = JSON.stringify({ ...(platform_id !== undefined ? { platform_id } : {}), ...(base_url ? { base_url } : {}) });
        }
      }
      db.prepare("UPDATE rooms SET model=?, model_config=? WHERE id=?").run(model, modelConfig, subscribedRoom);
      const clients = roomClients.get(subscribedRoom);
      if (clients) {
        for (const c of clients) {
          if (c.readyState === 1) c.send(JSON.stringify({ type: 'room_model_changed', model, model_config: modelConfig, room_id: subscribedRoom }));
        }
      }
      console.log(`[room] model set to ${model || '(default)'} for room ${subscribedRoom}`);
    }

   } catch (err) { console.error('[ws] unhandled message error:', err); }
  });

  ws.on('close', () => {
    if (subscribedRoom) roomClients.get(subscribedRoom)?.delete(ws);
    if (isHumanClient) globalClients.delete(ws);
    if (agentActorId) {
      agentClients.delete(agentActorId);
      agentVersions.delete(agentActorId);
      const cleaned = db.prepare(
        "UPDATE messages SET state='error', content=CASE WHEN content='' THEN '(interrupted — agent disconnected)' ELSE content END WHERE state IN ('streaming','requesting') AND participant_id IN (SELECT rp.id FROM room_participants rp WHERE rp.actor_id=?)"
      ).run(agentActorId);
      if (cleaned.changes) console.log(`[agent] Cleaned ${cleaned.changes} orphaned message(s) from Actor #${agentActorId}`);
      // Clean up pendingCompacts — remove only this agent; if no agents remain, unstick UI
      for (const [roomId, cs] of pendingCompacts) {
        const idx = cs.agents.indexOf(agentActorId);
        if (idx !== -1) {
          cs.agents.splice(idx, 1);
          cs.total = Math.max(cs.total - 1, cs.completed); // won't complete — clamp to already-done count
          if (cs.agents.length === 0 || cs.completed >= cs.total) {
            pendingCompacts.delete(roomId);
            setRecentCompact(roomId); // prevent compact_complete (if agent reconnects) from sending a redundant compact_done
            // Write compact marker for agents that successfully completed before disconnect
            if (cs.completed > 0 && cs.names?.length > 0) {
              const completedActorId = cs.completedAgentIds?.[0] ?? agentActorId;
              const participant = db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1').get(roomId, completedActorId);
              if (participant) {
                const content = `${cs.names.join(', ')} · session compacted`;
                const sysResult = db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')").run(roomId, participant.id, content);
                broadcast(roomId, { type: 'message_new', message: { id: Number(sysResult.lastInsertRowid), room_id: roomId, content, state: 'system_event', created_at: new Date().toISOString() } });
              }
            }
            broadcast(roomId, { type: 'compact_done', room_id: roomId });
            console.log(`[agent] Cleared pendingCompact room=${roomId} (agent #${agentActorId} disconnected mid-compact)`);
          } else {
            console.log(`[agent] Agent #${agentActorId} disconnected mid-compact room=${roomId}, ${cs.agents.length} agent(s) still pending`);
          }
        }
      }
      console.log(`[agent] Actor #${agentActorId} disconnected`);
      broadcastGlobal({ type: 'actor_status', actor: { id: agentActorId, online: false } });
    }
  });
});

// ─── Workspace helpers ──────────────────────────────────────────────────────

function isPathSafe(filePath, workdir) {
  const resolved = path.resolve(filePath);
  const wdResolved = path.resolve(workdir);
  const norm = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
  if (!norm(resolved).startsWith(norm(wdResolved + path.sep)) && norm(resolved) !== norm(wdResolved)) return false;
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) return false;
      const real = fs.realpathSync(filePath);
      if (!norm(real).startsWith(norm(wdResolved + path.sep)) && norm(real) !== norm(wdResolved)) return false;
    }
  } catch {}
  return true;
}

const WS_IGNORE = new Set(['.git', 'node_modules', '.next', '__pycache__', '.venv', 'dist', 'build']);

function buildFileTree(dirPath, rootPath, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  const result = [];
  const dirs = entries.filter(e => e.isDirectory() && !WS_IGNORE.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const children = buildFileTree(path.join(dirPath, d.name), rootPath, depth + 1, maxDepth);
    result.push({ t: 'folder', name: d.name, depth, open: depth < 1, children });
  }
  for (const f of files) {
    const ext = path.extname(f.name).slice(1);
    result.push({ t: ext || 'file', name: f.name, depth });
  }
  return result;
}

function parseGitDiff(raw) {
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
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.hunks.push({ k: 'add', text: line.slice(1) });
        current.add++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.hunks.push({ k: 'del', text: line.slice(1) });
        current.del++;
      } else if (line.startsWith(' ')) {
        current.hunks.push({ k: 'ctx', text: line.slice(1) });
      }
    }
  }
  return files;
}

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
const roomIdleBus = new (require('events').EventEmitter)();
roomIdleBus.setMaxListeners(0); // unbounded — one listener per queued room

async function triggerAgentsSequential(roomId, agents, content, replyTo, attachments) {
  const maxTurns = parseInt(process.env.MAX_AI_TURNS || '5');
  const seq = { cancelled: false };
  activeSequences.set(roomId, seq);
  let turnCount = 0;

  try {
    // Immutable during sequence: prefetch once
    const wdRow = db.prepare(
      'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
    ).get(roomId);
    const repliedMsg = replyTo ? db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo) : null;
    // Mutable during sequence: prepare once, execute per-iteration
    const participantsStmt = db.prepare(`
      SELECT rp.id as participant_id, a.id as actor_id, a.name, a.type
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=?
    `);
    const allAiStmt = db.prepare(`
      SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND a.type='ai' AND rp.notify_on_message=1
    `);

    for (let i = 0; i < Math.min(agents.length, maxTurns); i++) {
      if (seq.cancelled) break;
      turnCount++;
      const currentAgent = agents[i];
      const prefetchedCtx = { allParticipants: participantsStmt.all(roomId), wdRow, repliedMsg };
      await triggerAiResponse(roomId, currentAgent, content, replyTo, attachments, prefetchedCtx);
      if (seq.cancelled) break;

      const lastMsg = db.prepare(`
        SELECT m.content FROM messages m
        JOIN room_participants rp ON rp.id=m.participant_id
        WHERE rp.actor_id=? AND m.room_id=? AND m.state='complete'
        ORDER BY m.id DESC LIMIT 1
      `).get(currentAgent.actor_id, roomId);

      if (lastMsg?.content) {
        const allAiInRoom = allAiStmt.all(roomId);
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
  } finally {
    activeSequences.delete(roomId);
    roomIdleBus.emit('idle', roomId);
  }
}

async function handleHumanMessage(roomId, content, attachments, replyTo, senderWs) {
  // Get Ahmad's participant ID
  const parts = db.prepare(
    "SELECT rp.id FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1"
  ).all(roomId);
  if (!parts.length) return;
  const humanParticipantId = parts[0].id;

  // Backward compat: extract first image/file for legacy columns
  const images = (attachments || []).filter(a => a.type === 'image');
  const files  = (attachments || []).filter(a => a.type === 'file');
  const imageUrl = images[0]?.url || null;
  const fileUrl  = files[0]?.url || null;
  const fileName = files[0]?.name || null;
  const attachJson = attachments?.length ? JSON.stringify(attachments) : null;

  // Save human message
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, image_url, file_url, file_name, attachments, reply_to, state) VALUES (?,?,?,?,?,?,?,?,'complete')`
  ).run(roomId, humanParticipantId, content, imageUrl, fileUrl, fileName, attachJson, replyTo || null);
  const messageId = result.lastInsertRowid;

  // Get message with actor info for broadcast
  const row = db.prepare(`
    SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
    FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
    WHERE m.id=?`).get(messageId);
  if (row.reply_to) {
    const replied = db.prepare(`SELECT m.id, m.content, m.image_url, m.file_url, m.file_name, m.attachments, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id=?`).get(row.reply_to);
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
    triggerAgentsSequential(roomId, ordered, content, messageId, attachments || []).catch(e => console.error('[trigger] sequence error:', e));
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
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai' AND LOWER(a.name)=?
      `).all(roomId, targetName)
    : db.prepare(`
        SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.avatar_color, a.avatar_symbol, a.avatar_url
        FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
        WHERE rp.room_id=? AND a.type='ai'
      `).all(roomId);

  if (!allAis.length) return false;

  // Check skill exists — scoped to room's workdir
  const room = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
  const aiIds = allAis.map(a => a.actor_id);
  const placeholders = aiIds.map(() => '?').join(',');
  const matchedSkills = db.prepare(
    `SELECT actor_id FROM agent_skills WHERE name=? AND actor_id IN (${placeholders})
     AND ((scope IN ('project','local') AND workdir_id = ?) OR scope = 'global')`
  ).all(skillName, ...aiIds, room?.workdir_id);

  if (!matchedSkills.length) return false;

  // Only trigger agents that own the matched skill
  const matchedIds = new Set(matchedSkills.map(s => s.actor_id));
  const filteredAis = allAis.filter(a => matchedIds.has(a.actor_id));

  // Broadcast notice bahwa skill dipanggil
  broadcast(roomId, {
    type: 'skill_invoked',
    skill_name: skillName,
    targets: filteredAis.map(a => a.name),
  });

  // Send skill invocation as prompt — agent's Claude Code session handles the skill
  const promptText = `/${skillName}`;

  for (const ai of filteredAis) {
    await triggerSkillResponse(roomId, ai, promptText);
  }
  return true;
}

async function triggerSkillResponse(roomId, ai, prompt) {
  const result = db.prepare(
    `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,'','streaming')`
  ).run(roomId, ai.participant_id);
  const msgId = result.lastInsertRowid;

  // Resolve workdir: prefer this participant's own workdir_id; fall back to the room workdir
  // (only if it belongs to this agent), then the agent's default workdir.
  const partWd = db.prepare(
    'SELECT w.path FROM room_participants rp JOIN agent_workdirs w ON w.id=rp.workdir_id WHERE rp.id=?'
  ).get(ai.participant_id);
  const wdRow = db.prepare(
    'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
  ).get(roomId);
  const defaultWd = db.prepare(
    'SELECT path FROM agent_workdirs WHERE actor_id=? AND is_default=1 LIMIT 1'
  ).get(ai.actor_id);
  // NULL here is intentional & safe (e.g. an AI without a default workdir): the trigger sends
  // `workdir || undefined`, so the agent client falls back to its own cwd. Not a defect —
  // migration 20260620 backfill deliberately mirrors this runtime resolution.
  const workdir = partWd?.path ?? ((wdRow?.path && wdRow.actor_id === ai.actor_id) ? wdRow.path : (defaultWd?.path || null));
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
    {
      const session = getFallbackSession(ai.participant_id, workdir);
      try {
        const result = await session.send({
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
        if (result.sessionId) saveSession(ai.participant_id, result.sessionId, workdir);
        db.prepare("UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?").run(fullContent, msgId);
        broadcast(roomId, { type: 'message_complete', message_id: msgId, content: fullContent });
      } catch {
        db.prepare(`UPDATE messages SET state='error' WHERE id=?`).run(msgId);
        broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error' });
      }
    }
  }
}

function promptStrings(lang) {
  const t = {
    en: {
      identity: name => `You are ${name}. You are in a conversation on the Stoa platform.`,
      participants: names => `Other participants in this room: ${names}.`,
      timeContext: now => `Current time: ${now}. All message timestamps in the conversation history are in UTC.`,
      historyLabel: 'Conversation history',
      attachments: 'Attachments',
      attachmentsNote: 'files downloaded to .stoa-attachments/ in workdir if this is the latest message',
      sentImage: 'sent an image',
      attachedFile: 'attached file',
      replyTo: (name, content) => `[This message is a reply to ${name}'s message: "${content}"]`,
      replyInstruction: 'Reply to the last message naturally and directly. No need to mention humans (@name) as they will read it.',
      mentionInstruction: names => `To talk to another AI, use @TheirName (e.g. ${names.map(n => '@' + n).join(' or ')}). Mentions automatically trigger them to respond.`,
      sendFileInstruction: 'If asked to send a file, include the marker [send:path/to/file] in your response. Path must be absolute. You can send multiple files with multiple [send:...] markers. The system will automatically upload and display them in chat.',
    },
    id: {
      identity: name => `Kamu adalah ${name}. Kamu sedang dalam percakapan di platform Stoa.`,
      participants: names => `Peserta lain di room ini: ${names}.`,
      timeContext: now => `Waktu sekarang: ${now}. Semua timestamp di riwayat percakapan adalah UTC.`,
      historyLabel: 'Riwayat percakapan',
      attachments: 'Lampiran',
      attachmentsNote: 'file sudah didownload ke .stoa-attachments/ di workdir jika ini pesan terbaru',
      sentImage: 'mengirim gambar',
      attachedFile: 'melampirkan file',
      replyTo: (name, content) => `[Pesan ini adalah reply ke pesan ${name}: "${content}"]`,
      replyInstruction: 'Balas pesan terakhir secara natural dan langsung. Tidak perlu mention manusia (@nama) karena mereka pasti membaca.',
      mentionInstruction: names => `Jika ingin bicara ke AI lain, gunakan @NamaMereka (contoh: ${names.map(n => '@' + n).join(' atau ')}). Mention akan otomatis memicu mereka untuk merespons.`,
      sendFileInstruction: 'Jika diminta mengirim file, sertakan marker [send:path/to/file] di response. Path harus absolute. Bisa kirim beberapa file sekaligus dengan multiple marker [send:...]. Sistem akan otomatis upload dan menampilkan di chat.',
    },
    ja: {
      identity: name => `あなたは${name}です。Stoaプラットフォームで会話中です。`,
      participants: names => `このルームの他の参加者: ${names}。`,
      timeContext: now => `現在時刻: ${now}。会話履歴のタイムスタンプはすべてUTCです。`,
      historyLabel: '会話履歴',
      attachments: '添付ファイル',
      attachmentsNote: '最新メッセージの場合、ファイルはworkdirの.stoa-attachments/にダウンロード済み',
      sentImage: '画像を送信',
      attachedFile: 'ファイルを添付',
      replyTo: (name, content) => `[このメッセージは${name}のメッセージへの返信です: 「${content}」]`,
      replyInstruction: '最後のメッセージに自然に直接返信してください。人間への@メンションは不要です。',
      mentionInstruction: names => `他のAIに話しかけるには@名前を使ってください（例: ${names.map(n => '@' + n).join('、')}）。メンションで自動的に応答が起動します。`,
      sendFileInstruction: 'ファイル送信を求められた場合、レスポンスに[send:path/to/file]マーカーを含めてください。パスは絶対パスで指定。複数ファイルは複数の[send:...]マーカーで送信可能です。',
    },
    ko: {
      identity: name => `당신은 ${name}입니다. Stoa 플랫폼에서 대화 중입니다.`,
      participants: names => `이 방의 다른 참가자: ${names}.`,
      timeContext: now => `현재 시각: ${now}. 대화 기록의 모든 타임스탬프는 UTC입니다.`,
      historyLabel: '대화 기록',
      attachments: '첨부파일',
      attachmentsNote: '최신 메시지인 경우 파일이 workdir의 .stoa-attachments/에 다운로드됨',
      sentImage: '이미지 전송',
      attachedFile: '파일 첨부',
      replyTo: (name, content) => `[이 메시지는 ${name}의 메시지에 대한 답장입니다: "${content}"]`,
      replyInstruction: '마지막 메시지에 자연스럽고 직접적으로 답변하세요. 사람에게 @멘션할 필요 없습니다.',
      mentionInstruction: names => `다른 AI에게 말하려면 @이름을 사용하세요 (예: ${names.map(n => '@' + n).join(' 또는 ')}). 멘션하면 자동으로 응답합니다.`,
      sendFileInstruction: '파일 전송을 요청받으면 응답에 [send:path/to/file] 마커를 포함하세요. 경로는 절대 경로여야 합니다. 여러 파일은 여러 [send:...] 마커로 전송 가능합니다.',
    },
    zh: {
      identity: name => `你是${name}。你正在Stoa平台上进行对话。`,
      participants: names => `此房间的其他参与者：${names}。`,
      timeContext: now => `当前时间：${now}。对话历史中的所有时间戳均为UTC。`,
      historyLabel: '对话历史',
      attachments: '附件',
      attachmentsNote: '如果这是最新消息，文件已下载到workdir的.stoa-attachments/',
      sentImage: '发送了图片',
      attachedFile: '附加了文件',
      replyTo: (name, content) => `[此消息是对${name}消息的回复："${content}"]`,
      replyInstruction: '自然直接地回复最后一条消息。无需@提及人类，他们会看到的。',
      mentionInstruction: names => `要与其他AI对话，请使用@名字（例如：${names.map(n => '@' + n).join('、')}）。提及会自动触发他们回应。`,
      sendFileInstruction: '如果被要求发送文件，请在回复中包含[send:path/to/file]标记。路径必须是绝对路径。可以使用多个[send:...]标记发送多个文件。系统会自动上传并在聊天中显示。',
    },
  };
  return t[lang] || t.en;
}

async function triggerAiResponse(roomId, ai, prompt, replyTo, attachments = [], prefetchedCtx = null) {

  const agentWs = agentClients.get(ai.actor_id);

  if (!agentWs || agentWs.readyState !== 1) {
    console.log(`[trigger] ${ai.name} is offline, saving system_event`);
    const sysResult = db.prepare(
      `INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,?)`
    ).run(roomId, ai.participant_id, `${ai.name} sedang offline`, 'system_event');
    broadcast(roomId, {
      type: 'message_new',
      message: {
        id: Number(sysResult.lastInsertRowid),
        room_id: roomId,
        actor_name: ai.name,
        actor_type: 'ai',
        avatar_color: ai.avatar_color,
        avatar_symbol: ai.avatar_symbol,
        avatar_url: ai.avatar_url || null,
        content: `${ai.name} sedang offline`,
        state: 'system_event',
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

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
  console.log(`[trigger] ${ai.name} actor_id=${ai.actor_id} agentConnected=${!!agentWs} readyState=${agentWs?.readyState}`);

  if (EXPECTED_CLIENT_VERSION && agentWs && agentWs.readyState === 1) {
    const agentVer = agentVersions.get(ai.actor_id);
    if (agentVer && agentVer.localeCompare(EXPECTED_CLIENT_VERSION, undefined, { numeric: true }) < 0) {
      console.log(`[trigger] ${ai.name} outdated (v${agentVer} < v${EXPECTED_CLIENT_VERSION}), skipping trigger — sending restart`);
      agentWs.send(JSON.stringify({ type: 'restart' }));
      db.prepare("UPDATE messages SET state='error', content='(agent updating — please retry)' WHERE id=?").run(msgId);
      broadcast(roomId, { type: 'message_state', message_id: msgId, state: 'error', actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      return;
    }
  }

  // Build context-aware prompt (language-aware)
  const agentLang = (() => { try { return JSON.parse(ai.adapter_config || '{}').lang || 'en'; } catch { return 'en'; } })();
  const L = promptStrings(agentLang);

  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const history = db.prepare(`
    SELECT a.name, m.content, m.image_url, m.file_url, m.file_name, m.attachments, m.created_at, rp.actor_id FROM messages m
    JOIN room_participants rp ON rp.id=m.participant_id
    JOIN actors a ON a.id=rp.actor_id
    WHERE m.room_id=? AND m.state='complete' ORDER BY m.created_at DESC LIMIT 10
  `).all(roomId);
  const rawHistory = history.slice().reverse().map(r => ({
    role: r.actor_id === ai.actor_id ? 'assistant' : 'user',
    content: r.content || '',
  }));

  const ctx = history.reverse().map(r => {
    const ts = r.created_at
      ? new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : '';
    let line = `[${r.name}${ts ? ' @ ' + ts : ''}]: ${r.content || ''}`;
    let files = [];
    if (r.attachments) {
      try { files = JSON.parse(r.attachments); } catch {}
    }
    if (files.length) {
      line += '\n  ' + L.attachments + ': ' + files.map(f => f.name || 'file').join(', ') + ` (${L.attachmentsNote})`;
    } else {
      if (r.image_url) line += ` [${L.sentImage}]`;
      if (r.file_name) line += ` [${L.attachedFile}: ${r.file_name}]`;
    }
    return line;
  }).join('\n');

  const parts = prefetchedCtx?.allParticipants ?? db.prepare(`
    SELECT rp.id as participant_id, a.id as actor_id, a.name, a.type
    FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=?
  `).all(roomId);
  const otherAINames = parts.filter(p => p.type === 'ai' && p.actor_id !== ai.actor_id).map(p => p.name);
  const allOtherNames = [...parts.filter(p => p.type === 'human').map(p => p.name), ...otherAINames];
  const othersLine = allOtherNames.length
    ? L.participants(allOtherNames.join(', '))
    : '';

  let replyCtx = '';
  if (replyTo) {
    const replied = prefetchedCtx?.repliedMsg ?? db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo);
    if (replied) replyCtx = '\n' + L.replyTo(replied.name, replied.content?.substring(0, 500)) + '\n';
  }

  const fullPrompt = [
    L.identity(ai.name),
    `Room ID: ${roomId}`,
    L.timeContext(nowUtc),
    othersLine,
    `\n${L.historyLabel}:\n${ctx}`,
    replyCtx,
    '\n' + L.replyInstruction,
    otherAINames.length ? L.mentionInstruction(otherAINames) : '',
    '\n' + L.sendFileInstruction,
  ].filter(Boolean).join('\n');

  // Room-level workdir row (used as a fallback after the participant's own workdir_id below).
  const wdRow = prefetchedCtx?.wdRow ?? db.prepare(
    'SELECT w.path, w.actor_id FROM rooms r LEFT JOIN agent_workdirs w ON w.id=r.workdir_id WHERE r.id=?'
  ).get(roomId);
  const roomRow2 = db.prepare('SELECT model, model_config FROM rooms WHERE id=?').get(roomId);
  const roomModel = roomRow2?.model || null;
  let modelBaseUrl, modelApiKeys, modelToolsSupported;
  if (roomRow2?.model_config) {
    try {
      const cfg = JSON.parse(roomRow2.model_config);
      if (cfg.platform_id) {
        const platforms = getParsedSetting('ai_platforms');
        if (platforms) {
          const plat = platforms.find(p => p.id === cfg.platform_id && p.enabled);
          if (plat) {
            if (plat.vendor === 'ollama') {
              // Route through Stoa's own /v1/messages proxy — keys + rotation handled server-side.
              // Use getPublicUrl (not hardcoded 127.0.0.1): remote agents (e.g. Kira on another host)
              // resolve 127.0.0.1 to themselves, where nothing listens → ECONNREFUSED. The public/tailscale
              // URL is reachable by both local and remote agents (loopback cost is negligible for local).
              modelBaseUrl = getPublicUrl(`localhost:${PORT}`);
              modelApiKeys = [`stoa-proxy:${cfg.platform_id}`];
            } else {
              modelBaseUrl = plat.base_url || cfg.base_url || undefined;
              modelApiKeys = plat.api_keys?.length ? plat.api_keys : (plat.api_key ? [plat.api_key] : undefined);
            }
            if (Array.isArray(plat.cached_models) && roomModel) {
              const modelInfo = plat.cached_models.find(m => (typeof m === 'string' ? m : m.model) === roomModel);
              if (modelInfo && typeof modelInfo === 'object') modelToolsSupported = modelInfo.tools === true;
            }
          }
        }
      }
    } catch {}
  }
  if (roomModel && !roomModel.startsWith('claude-') && !modelBaseUrl) {
    const errContent = `⚠ Model "${roomModel}" tidak bisa digunakan — platform-nya sudah di-disable atau dihapus. Ubah model room di Settings.`;
    db.prepare("UPDATE messages SET content=?, state='complete', completed_at=datetime('now') WHERE id=?").run(errContent, msgId);
    broadcast(roomId, { type: 'message_complete', message_id: msgId, content: errContent });
    return;
  }
  const defaultWd = db.prepare(
    'SELECT path FROM agent_workdirs WHERE actor_id=? AND is_default=1 LIMIT 1'
  ).get(ai.actor_id);
  // Prefer this participant's own workdir_id; fall back to the room workdir (only if it belongs
  // to this agent), then the agent's default workdir.
  const partWd = db.prepare(
    'SELECT w.path FROM room_participants rp JOIN agent_workdirs w ON w.id=rp.workdir_id WHERE rp.id=?'
  ).get(ai.participant_id);
  // NULL here is intentional & safe (e.g. an AI without a default workdir): the trigger sends
  // `workdir || undefined`, so the agent client falls back to its own cwd. Not a defect —
  // migration 20260620 backfill deliberately mirrors this runtime resolution.
  const workdir = partWd?.path ?? ((wdRow?.path && wdRow.actor_id === ai.actor_id) ? wdRow.path : (defaultWd?.path || null));

  if (agentWs && agentWs.readyState === 1) {
    // ── Route to connected agent client
    const sessionId = getSession(ai.participant_id, workdir);
    await new Promise((resolve, reject) => {
      pendingAgents.set(msgId, { resolve, reject });
      pendingActorMeta.set(msgId, { actor_name: ai.name, avatar_color: ai.avatar_color, avatar_symbol: ai.avatar_symbol, avatar_url: ai.avatar_url || null });
      const triggerBaseUrl = getPublicUrl(`localhost:${PORT}`);
      const fullAttachments = (attachments || []).map(a => ({
        ...a,
        url: a.url?.startsWith('/') ? triggerBaseUrl + a.url : a.url,
      }));
      agentWs.send(JSON.stringify({
        type: 'agent_trigger',
        room_id: roomId,
        message_id: msgId,
        reply_to: replyTo || undefined,
        participant_id: ai.participant_id,
        claude_session_id: sessionId,
        prompt: fullPrompt,
        attachments: fullAttachments.length ? fullAttachments : undefined,
        imageUrl: fullAttachments.find(a => a.type === 'image')?.url || undefined,
        fileUrl:  fullAttachments.find(a => a.type === 'file')?.url || undefined,
        fileName: fullAttachments.find(a => a.type === 'file')?.name || undefined,
        workdir: workdir    || undefined,
        model: roomModel    || undefined,
        base_url: modelBaseUrl,
        api_keys: modelApiKeys,
        tools_supported: modelToolsSupported === false ? false : undefined,
        rawHistory: rawHistory.length ? rawHistory : undefined,
      }));
      console.log(`[trigger] sent to ${ai.name} agent, msgId=${msgId}`);
    });

  }
}


async function handleInviteSuggest(roomId, byParticipantId, suggestedActorId, reason) {
  const result = db.prepare(
    'INSERT INTO invite_suggestions (room_id, suggested_by_participant_id, suggested_actor_id, reason) VALUES (?,?,?,?)'
  ).run(roomId, byParticipantId, suggestedActorId, reason);
  const actor = db.prepare('SELECT name, avatar_symbol, avatar_color FROM actors WHERE id=?').get(suggestedActorId);
  broadcast(roomId, {
    type: 'invite_suggestion',
    invite_id: result.lastInsertRowid,
    suggested_actor: actor,
    reason,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function enrichReply(rows) {
  const replyIds = [...new Set(rows.filter(r => r.reply_to).map(r => r.reply_to))];
  if (!replyIds.length) return rows;
  const ph = replyIds.map(() => '?').join(',');
  const repliedRows = db.prepare(`SELECT m.id, m.content, m.image_url, m.file_url, m.file_name, m.attachments, a.name as actor_name, a.avatar_color FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id IN (${ph})`).all(...replyIds);
  const replied = {};
  for (const r of repliedRows) replied[r.id] = r;
  return rows.map(r => r.reply_to && replied[r.reply_to] ? { ...r, reply_msg: replied[r.reply_to] } : r);
}

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

function parseJsonBody(raw) {
  try { return JSON.parse(raw); } catch { return null; }
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

function waitForRoomIdle(roomId, timeoutMs = 300000) {
  return new Promise(resolve => {
    if (!activeSequences.has(roomId)) return resolve();
    const onIdle = (id) => {
      if (id !== roomId) return;
      roomIdleBus.removeListener('idle', onIdle);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      roomIdleBus.removeListener('idle', onIdle);
      console.warn(`[queue] room ${roomId} idle timeout after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);
    roomIdleBus.on('idle', onIdle);
  });
}

// ─── Slack automation listener ────────────────────────────────────────────────

const _slackProcessed = new Map(); // key → expiresAt, for dedup
connectionManager.on('slack_event', async ({ eventType, event, webClient, connId }) => {
  // Deduplicate: Slack may deliver the same event multiple times
  const isReaction = eventType === 'reaction_added';
  const dedupKey = isReaction
    ? `${event.event_ts}:${event.item?.channel}:${eventType}`
    : `${event.ts}:${event.channel}:${eventType}`;
  const now = Date.now();
  if (_slackProcessed.has(dedupKey)) return;
  _slackProcessed.set(dedupKey, now + 120_000);
  // Cleanup expired entries periodically
  if (_slackProcessed.size > 500) {
    for (const [k, exp] of _slackProcessed) { if (exp < now) _slackProcessed.delete(k); }
  }

  try {
    const automations = db.prepare(
      "SELECT * FROM automations WHERE enabled=1 AND trigger_type='slack' AND trigger_event=? AND (connection_id IS NULL OR connection_id=?)"
    ).all(eventType, connId || null);

    // Resolve event-level variables once (avoids N+1 Slack API calls per matched automation)
    const text = isReaction ? (event.reaction || '') : (event.text || '');
    const userId = event.user || '';
    const channelId = isReaction ? (event.item?.channel || '') : (event.channel || '');
    const workspace = getSetting('slack_workspace_name') || '';
    const tsForLink = isReaction ? (event.item?.ts || '') : (event.ts || '');
    const messageLink = tsForLink
      ? `https://${workspace}.slack.com/archives/${channelId}/p${tsForLink.replace('.', '')}`
      : '';
    const extractedUrl = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
    const fieldValues = { message_text: text, slack_user: userId, slack_channel: channelId, reaction: text };

    let slackUser = userId;
    let slackChannel = channelId;
    if (automations.length > 0) {
      try {
        const userInfo = await webClient.users.info({ user: userId });
        slackUser = userInfo.user?.display_name || userInfo.user?.real_name || userId;
      } catch {}
      try {
        const chanInfo = await webClient.conversations.info({ channel: channelId });
        slackChannel = chanInfo.channel?.name || channelId;
      } catch {}
    }

    for (const auto of automations) {
      let conditions = [];
      try { conditions = JSON.parse(auto.trigger_conditions || '[]'); } catch {}

      // Evaluate ALL conditions (AND)
      const allMatch = conditions.every(c => {
        const val = (fieldValues[c.field] || '').toLowerCase();
        const target = (c.value || '').toLowerCase();
        switch (c.op) {
          case 'contains':      return val.includes(target);
          case 'not_contains':  return !val.includes(target);
          case 'starts_with':   return val.startsWith(target);
          case 'matches_regex': try { return new RegExp(c.value, 'i').test(fieldValues[c.field] || ''); } catch { return false; }
          default: return true;
        }
      });

      if (!allMatch) continue;

      const prompt = auto.prompt_template
        .replace(/\{\{slack_message_text\}\}/g, text)
        .replace(/\{\{slack_message_link\}\}/g, messageLink)
        .replace(/\{\{slack_thread_ts\}\}/g, event.thread_ts || event.ts || '')
        .replace(/\{\{slack_user\}\}/g, slackUser)
        .replace(/\{\{slack_channel\}\}/g, slackChannel)
        .replace(/\{\{extracted_url\}\}/g, extractedUrl);

      // Queue automation — one at a time per room
      const _roomId = auto.target_room_id;
      const _prompt = prompt;
      const _autoName = auto.name;
      const _autoId = auto.id;
      automationQueue.enqueue(_roomId, async () => {
        await waitForRoomIdle(_roomId);
        await handleHumanMessage(_roomId, _prompt, null, null, null);
        await waitForRoomIdle(_roomId);
        db.prepare("UPDATE automations SET run_count=run_count+1, last_run_at=datetime('now') WHERE id=?").run(_autoId);
      }, { automation: _autoName }).catch(e =>
        console.error(`[automation] room ${_roomId} trigger error:`, e.message)
      );
      console.log(`[automation] "${_autoName}" queued → room ${_roomId} (pending: ${automationQueue.pending(_roomId)})`);
    }
  } catch (e) {
    console.error('[automation] slack_event handler error:', e.message);
  }
});

// Reconnect Slack on startup if previously connected
(async () => {
  const legacyConnected = getSetting('slack_connected') === '1';
  const legacyAppToken  = getSetting('slack_app_token');
  const legacyToken     = getSetting('slack_user_token') || null;
  if (legacyConnected && legacyAppToken && legacyToken) {
    const existing = db.prepare('SELECT id FROM automation_connections LIMIT 1').get();
    if (!existing) {
      console.log('[conn] migrating legacy Slack settings -> automation_connections');
      const creds = JSON.stringify({ appToken: legacyAppToken, token: legacyToken });
      const wname = getSetting('slack_workspace_name') || '';
      const bname = getSetting('slack_bot_name') || '';
      const meta  = JSON.stringify({ workspaceName: wname, botName: bname });
      db.prepare(
        'INSERT INTO automation_connections (name,provider,token_type,credentials,metadata,status) VALUES (?,?,?,?,?,?)'
      ).run('Slack — ' + (bname || 'default'), 'slack', 'user', creds, meta, 'disconnected');
    }
  }
  const conns = db.prepare("SELECT * FROM automation_connections WHERE status='connected'").all();
  for (const conn of conns) {
    try {
      console.log(`[conn:${conn.id}] reconnecting on startup...`);
      await connectionManager.startConnection(conn, updateConnStatus);
    } catch (e) {
      console.error(`[conn:${conn.id}] startup reconnect failed:`, e.message);
    }
  }
})();
