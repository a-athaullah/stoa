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
const { spawnGemini } = require('./gemini-adapter');

const EXPECTED_CLIENT_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'stoa.js'), 'utf8');
    const m = src.match(/^const CLIENT_VERSION\s*=\s*'([^']+)'/m);
    return m ? m[1] : null;
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
  db.prepare(
    `INSERT INTO ai_sessions (participant_id, claude_session_id, workdir, status) VALUES (?,?,?,'idle')
     ON CONFLICT(participant_id, workdir) DO UPDATE SET claude_session_id=excluded.claude_session_id, status='idle', last_active_at=datetime('now')`
  ).run(participantId, claudeSessionId, workdir || null);
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
db.exec(fs.readFileSync(path.join(__dirname, 'db', 'schema.sqlite.sql'), 'utf8'));

// Migrate ai_sessions: participant_id UNIQUE → UNIQUE(participant_id, workdir)
try {
  const hasOld = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'").get();
  if (hasOld?.sql?.includes('participant_id INTEGER NOT NULL UNIQUE')) {
    db.exec(`
      CREATE TABLE ai_sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL,
        claude_session_id TEXT NOT NULL,
        workdir TEXT DEFAULT NULL,
        status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle')),
        last_active_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (participant_id) REFERENCES room_participants(id),
        UNIQUE (participant_id, workdir)
      );
      INSERT INTO ai_sessions_new SELECT * FROM ai_sessions;
      DROP TABLE ai_sessions;
      ALTER TABLE ai_sessions_new RENAME TO ai_sessions;
    `);
    console.log('[db] migrated ai_sessions: UNIQUE(participant_id) → UNIQUE(participant_id, workdir)');
  }
} catch {}
try {
  const cols = db.prepare("PRAGMA table_info(agent_workdirs)").all().map(c => c.name);
  if (!cols.includes('model')) {
    db.prepare("ALTER TABLE agent_workdirs ADD COLUMN model TEXT DEFAULT NULL").run();
    console.log('[db] added agent_workdirs.model column');
  }
} catch {}

try {
  const cols = db.prepare("PRAGMA table_info(rooms)").all().map(c => c.name);
  if (!cols.includes('archived_at')) {
    db.prepare("ALTER TABLE rooms ADD COLUMN archived_at TEXT DEFAULT NULL").run();
    console.log('[db] added rooms.archived_at column');
  }
} catch {}

// Add missing indexes for existing databases
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)");
} catch {}

// Migrate messages CHECK constraint to allow 'system_event' state
try {
  const tblSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
  if (tblSql?.sql && !tblSql.sql.includes('system_event')) {
    const cols = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
    const colList = cols.join(', ');
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(`
        CREATE TABLE messages_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL,
          participant_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          state TEXT DEFAULT 'complete' CHECK(state IN ('requesting','streaming','complete','error','system_event')),
          reply_to INTEGER DEFAULT NULL,
          image_url TEXT DEFAULT NULL,
          file_url TEXT DEFAULT NULL,
          file_name TEXT DEFAULT NULL,
          attachments TEXT DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT DEFAULT NULL,
          FOREIGN KEY (room_id) REFERENCES rooms(id),
          FOREIGN KEY (participant_id) REFERENCES room_participants(id)
        );
        INSERT INTO messages_new (${colList}) SELECT ${colList} FROM messages;
        DROP TABLE messages;
        ALTER TABLE messages_new RENAME TO messages;
      `);
      // Recreate indexes
      db.exec("CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_messages_room_state ON messages(room_id, state)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_messages_participant ON messages(participant_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)");
      // Recreate FTS triggers (dropped with old table)
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
        END;
      `);
      db.exec('COMMIT');
      console.log('[db] migrated messages: added system_event to state CHECK');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('[db] messages migration failed, rolled back:', e.message);
    }
  }
} catch {}

// Clean up duplicate settings rows caused by NULL scope_id UNIQUE bug
try {
  const dupes = db.prepare("SELECT key_name FROM settings WHERE scope='global' AND scope_id IS NULL GROUP BY key_name HAVING COUNT(*) > 1").all();
  for (const { key_name } of dupes) {
    const keep = db.prepare("SELECT id FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name=? ORDER BY id DESC LIMIT 1").get(key_name);
    db.prepare("DELETE FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name=? AND id!=?").run(key_name, keep.id);
  }
  if (dupes.length) console.log(`[migration] cleaned ${dupes.length} duplicate settings keys`);
} catch {}

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
const CLIENT_FILES = new Set(['stoa.js', 'claude-session.js', 'gemini-session.js', 'gemini-adapter.js']);

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

function getSetting(key, scopeId = null) {
  const scope = scopeId ? 'room' : 'global';
  const row = db.prepare(
    'SELECT value FROM settings WHERE scope=? AND (scope_id=? OR scope_id IS NULL) AND key_name=? ORDER BY scope DESC LIMIT 1'
  ).get(scope, scopeId, key);
  return row?.value ?? null;
}

function setSetting(key, value) {
  const existing = db.prepare("SELECT id FROM settings WHERE scope='global' AND scope_id IS NULL AND key_name=?").get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value=? WHERE id=?').run(value, existing.id);
  } else {
    db.prepare("INSERT INTO settings (scope, scope_id, key_name, value) VALUES ('global', NULL, ?, ?)").run(key, value);
  }
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
    fs.writeFileSync(savedPath, buffer);
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
      const oldPath = path.resolve(__dirname, oldAvatar.avatar_url);
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
      const oldPath = path.resolve(__dirname, actor.avatar_url);
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
      SELECT r.*, a.name as creator_name, w.model as workdir_model,
        (SELECT COUNT(*) FROM room_participants WHERE room_id=r.id) as participant_count,
        (SELECT COUNT(*) FROM messages WHERE room_id=r.id) as message_count,
        (SELECT m.content FROM messages m WHERE m.room_id=r.id AND m.state='complete' AND m.content != '' ORDER BY m.id DESC LIMIT 1) as last_message,
        (SELECT a2.name FROM messages m2 JOIN room_participants rp ON rp.id=m2.participant_id JOIN actors a2 ON a2.id=rp.actor_id WHERE m2.room_id=r.id AND m2.state='complete' AND m2.content != '' ORDER BY m2.id DESC LIMIT 1) as last_message_actor,
        COALESCE((SELECT m3.created_at FROM messages m3 WHERE m3.room_id=r.id ORDER BY m3.id DESC LIMIT 1), r.created_at) as last_activity
      FROM rooms r JOIN actors a ON a.id=r.created_by LEFT JOIN agent_workdirs w ON w.id=r.workdir_id
      WHERE ${archived ? 'r.archived_at IS NOT NULL' : 'r.archived_at IS NULL'}
      ORDER BY last_activity DESC
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
    const result = db.prepare('INSERT INTO rooms (title, created_by, workdir_id) VALUES (?,?,?)').run(title, humanId, workdir_id);
    const roomId = result.lastInsertRowid;
    const allIds = [...new Set([humanId, ...participant_ids])];
    const insertParticipant = db.prepare('INSERT OR IGNORE INTO room_participants (room_id, actor_id) VALUES (?,?)');
    db.transaction((ids) => { for (const id of ids) insertParticipant.run(roomId, id); })(allIds);
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
      db.prepare("UPDATE rooms SET archived_at=datetime('now') WHERE id=?").run(roomId);
      broadcastGlobal({ type: 'room_archived', room_id: roomId });
    }
    if (parsed.archived === false) {
      db.prepare('UPDATE rooms SET archived_at=NULL WHERE id=?').run(roomId);
      broadcastGlobal({ type: 'room_restored', room_id: roomId });
    }
    return json(res, { ok: true });
  }

  const roomDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomDeleteMatch) {
    const roomId = parseInt(roomDeleteMatch[1]);
    const participantIds = db.prepare('SELECT id FROM room_participants WHERE room_id=?').all(roomId).map(r => r.id);
    if (participantIds.length) {
      const ph = participantIds.map(() => '?').join(',');
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
            WHERE m.room_id=? AND m.id < ? AND m.state='complete'
              AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL)
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
          AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL)
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
    const { actor_id } = data;
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
      const avatarPath = path.resolve(__dirname, actor.avatar_url);
      if (avatarPath.startsWith(path.join(__dirname, 'uploads')) && fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
    }
    const affectedRooms = db.prepare('SELECT room_id FROM room_participants WHERE actor_id=?').all(id).map(r => r.room_id);
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

  // ── Workspace file serve (images, binary files) ──
  if (req.method === 'GET' && url.pathname === '/api/workspace/file') {
    const roomId = url.searchParams.get('room');
    const relPath = url.searchParams.get('path');
    if (!roomId || !relPath) { res.writeHead(400); return res.end('missing room or path'); }
    const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(roomId);
    if (!roomRow?.workdir_id) { res.writeHead(404); return res.end('no workdir'); }
    const wd = db.prepare('SELECT path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
    if (!wd?.path) { res.writeHead(404); return res.end('workdir not found'); }
    const wdResolved = path.resolve(wd.path);
    const filePath = path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(wd.path, relPath);
    if (!filePath.startsWith(wdResolved + path.sep) && filePath !== wdResolved) { res.writeHead(403); return res.end('path outside workdir'); }
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
    const backend = (url.searchParams.get('backend') || 'claude').toLowerCase();
    const lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, backend, lang });

    const isGemini = backend === 'gemini';
    const clientFiles = isGemini
      ? 'stoa.js gemini-session.js gemini-adapter.js'
      : 'stoa.js claude-session.js';
    const trustCmd = isGemini
      ? 'gemini --version > /dev/null 2>&1 || true'
      : 'claude --version > /dev/null 2>&1 || true';
    const backendEnv = isGemini ? `\n      STOA_AI_BACKEND: 'gemini',` : '';

    const script = `#!/bin/bash
set -e

BASE_URL="${baseUrl}"
STOA_URL="${stoaUrl}"
REG_TOKEN="${token}"
AGENT_DIR="\${HOME}/stoa-agent"

echo "=== Stoa Agent Setup (${isGemini ? 'Gemini' : 'Claude'}) ==="
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
      STOA_WORK_DIR: process.env.HOME + '/stoa-workspace',${backendEnv}
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
    const ps1Backend = (url.searchParams.get('backend') || 'claude').toLowerCase();
    const ps1Lang = url.searchParams.get('lang') || 'en';
    installTokens.set(token, { expires: Date.now() + 600_000, name: presetName, backend: ps1Backend, lang: ps1Lang });

    const ps1IsGemini = ps1Backend === 'gemini';
    const ps1Files = ps1IsGemini
      ? '"stoa.js","gemini-session.js","gemini-adapter.js"'
      : '"stoa.js","claude-session.js"';
    const ps1TrustCmd = ps1IsGemini
      ? 'try { & gemini --version 2>$null } catch {}'
      : 'try { & claude --version 2>$null } catch {}';
    const ps1BackendEnv = ps1IsGemini ? `\n      STOA_AI_BACKEND: 'gemini',` : '';

    const script = `$ErrorActionPreference = "Stop"
$BaseUrl = "${baseUrl}"
$StoaUrl = "${stoaUrl}"
$RegToken = "${token}"
$AgentDir = "$env:USERPROFILE\\stoa-agent"
$WorkDir  = "$env:USERPROFILE\\stoa-workspace"

Write-Host "=== Stoa Agent Setup (${ps1IsGemini ? 'Gemini' : 'Claude'}) ==="
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
      STOA_WORK_DIR: require('os').homedir() + '/stoa-workspace',${ps1BackendEnv}
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
    if (url.searchParams.get('backend')) cmdParams.push(`backend=${encodeURIComponent(url.searchParams.get('backend'))}`);
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
    const adapter = entry.backend === 'gemini' ? 'gemini' : 'claude';
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
    const { approved } = data;
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
      'SELECT id, path, label, is_default, model FROM agent_workdirs WHERE actor_id=? ORDER BY is_default DESC, id ASC'
    ).all(actorId);
    return json(res, rows);
  }

  // POST /api/actors/:id/workdirs — request agent to create a new workdir
  if (req.method === 'POST' && url.pathname.match(/^\/api\/actors\/\d+\/workdirs$/)) {
    const actorId = parseInt(url.pathname.split('/')[3]);
    const data = parseJsonBody(await readBody(req));
    if (!data) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }
    const { path: dirPath, label } = data;
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
        const attachments = r.attachments ? JSON.parse(r.attachments).map(a => a.name || a.url).join('; ') : (r.file_name || '');
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
    const data = { room: { id: roomId, title: room.title }, exported_at: new Date().toISOString(), messages: rows.map(r => ({ ...r, attachments: r.attachments ? JSON.parse(r.attachments) : null })) };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeTitle}.json"`,
    });
    return res.end(JSON.stringify(data, null, 2));
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
          WHERE m.room_id=? AND m.state IN ('complete','streaming','requesting')
            AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL OR m.state IN ('streaming','requesting'))
          ORDER BY m.created_at DESC LIMIT 100
        ) AS recent ORDER BY created_at ASC
      `).all(subscribedRoom);
      ws.send(JSON.stringify({ type: 'history', messages: enrichReply(messages) }));
      // Query current model from connected agent
      const roomRow = db.prepare('SELECT workdir_id FROM rooms WHERE id=?').get(subscribedRoom);
      if (roomRow?.workdir_id) {
        const wd = db.prepare('SELECT actor_id, path FROM agent_workdirs WHERE id=?').get(roomRow.workdir_id);
        if (wd) {
          const agentWs = agentClients.get(wd.actor_id);
          if (agentWs) agentWs.send(JSON.stringify({ type: 'query_model', workdir: wd.path }));
        }
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
      ws.send(JSON.stringify({ type: 'set_config', max_concurrent: parseInt(process.env.MAX_CONCURRENT) || 1, session_idle_ttl: parseInt(process.env.SESSION_IDLE_TTL) || 5 }));
      const connectedActor = db.prepare('SELECT id, name, type, avatar_color, avatar_symbol, avatar_url, created_at FROM actors WHERE id=?').get(agentActorId);
      if (connectedActor) broadcastGlobal({ type: 'actor_status', actor: { ...connectedActor, online: true, client_version: msg.client_version || null } });
    }

    // ── Agent reports scan results
    if (msg.type === 'agent_scan_result' && agentActorId) {
      const { workdirs = [], globalSkills = [] } = msg;
      // UPSERT workdirs — preserve IDs so room references stay valid
      const upsertWorkdir = db.prepare(
        'INSERT INTO agent_workdirs (actor_id, path, label, is_default, model) VALUES (?,?,?,?,?) ON CONFLICT(actor_id, path) DO UPDATE SET label=excluded.label, is_default=excluded.is_default, model=excluded.model'
      );
      const insertSkill = db.prepare(
        'INSERT OR IGNORE INTO agent_skills (actor_id, workdir_id, name, description, scope) VALUES (?,?,?,?,?)'
      );
      const scannedPaths = new Set();
      for (const wd of workdirs) {
        const label = wd.path.split(/[\/\\]/).pop() || wd.path;
        upsertWorkdir.run(agentActorId, wd.path, label, wd.is_default ? 1 : 0, wd.model || null);
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

    // ── Agent reports model for a workdir
    if (msg.type === 'model_info' && agentActorId) {
      const wd = db.prepare('SELECT id, model FROM agent_workdirs WHERE actor_id=? AND path=?').get(agentActorId, msg.workdir);
      if (wd) {
        if (wd.model !== (msg.model || null)) {
          db.prepare('UPDATE agent_workdirs SET model=? WHERE id=?').run(msg.model || null, wd.id);
        }
        const payload = { type: 'model_update', workdir_id: wd.id, model: msg.model || null };
        broadcastGlobal(payload);
        const affectedRooms = db.prepare('SELECT id FROM rooms WHERE workdir_id=?').all(wd.id);
        for (const r of affectedRooms) broadcast(r.id, payload);
      }
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
        "UPDATE messages SET content=?, file_url=?, file_name=?, attachments=?, state='complete', completed_at=datetime('now') WHERE id=?"
      ).run(msg.content, msg.file_url || null, msg.file_name || null, attachJson, msg.message_id);
      const completePayload = { type: 'message_complete', message_id: msg.message_id, content: msg.content };
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

const WS_IGNORE = new Set(['.git', 'node_modules', '.next', '__pycache__', '.venv', 'dist', 'build', '.claude']);

function buildFileTree(dirPath, rootPath, depth, maxDepth) {
  if (depth > maxDepth) return [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  const result = [];
  const dirs = entries.filter(e => e.isDirectory() && !WS_IGNORE.has(e.name) && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
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

async function triggerAgentsSequential(roomId, agents, content, replyTo, attachments) {
  const maxTurns = parseInt(process.env.MAX_AI_TURNS || '5');
  const seq = { cancelled: false };
  activeSequences.set(roomId, seq);
  let turnCount = 0;

  for (let i = 0; i < Math.min(agents.length, maxTurns); i++) {
    if (seq.cancelled) break;
    turnCount++;
    const currentAgent = agents[i];
    await triggerAiResponse(roomId, currentAgent, content, replyTo, attachments);
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
    if (ai.adapter === 'gemini') {
      try {
        await spawnGemini({
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
    } else {
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

async function triggerAiResponse(roomId, ai, prompt, replyTo, attachments = []) {

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

  const history = db.prepare(`
    SELECT a.name, m.content, m.image_url, m.file_url, m.file_name, m.attachments FROM messages m
    JOIN room_participants rp ON rp.id=m.participant_id
    JOIN actors a ON a.id=rp.actor_id
    WHERE m.room_id=? AND m.state='complete' ORDER BY m.created_at DESC LIMIT 10
  `).all(roomId);
  const ctx = history.reverse().map(r => {
    let line = `[${r.name}]: ${r.content || ''}`;
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
    ? L.participants(allOtherNames.join(', '))
    : '';

  let replyCtx = '';
  if (replyTo) {
    const replied = db.prepare(`
      SELECT m.content, a.name FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?
    `).get(replyTo);
    if (replied) replyCtx = '\n' + L.replyTo(replied.name, replied.content?.substring(0, 500)) + '\n';
  }

  const fullPrompt = [
    L.identity(ai.name),
    othersLine,
    `\n${L.historyLabel}:\n${ctx}`,
    replyCtx,
    '\n' + L.replyInstruction,
    otherAINames.length ? L.mentionInstruction(otherAINames) : '',
    '\n' + L.sendFileInstruction,
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
