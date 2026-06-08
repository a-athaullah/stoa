#!/usr/bin/env node
// Stoa CLI — Hermes-style command dispatcher.
//
//   stoa                open the web dashboard (default); starts the gateway if needed
//   stoa dashboard      open the web dashboard in your browser
//   stoa chat [room]    start the interactive terminal chat client
//   stoa install        bootstrap: link the `stoa` command + enable the gateway (run as `node cli.js install`)
//   stoa gateway <cmd>  run server as a background service (enable|disable|start|stop|restart|status|logs)
//   stoa doctor         diagnose the local setup
//   stoa update         pull latest code, install deps, restart gateway
//   stoa config <cmd>   read/write .env (list|get KEY|set KEY VALUE)
//   stoa rooms          list rooms (reads the local DB)
//   stoa version        print versions
//   stoa help [cmd]     show help

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const paths = require('./paths');

const ROOT = __dirname;

// ─── ANSI (mirrors stoa.js) ──────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  white: '\x1b[97m', blue: '\x1b[94m', cyan: '\x1b[96m',
  green: '\x1b[92m', yellow: '\x1b[93m', red: '\x1b[91m', gray: '\x1b[90m',
};
const ok   = (s) => `${C.green}✓${C.reset} ${s}`;
const bad  = (s) => `${C.red}✗${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;

// ─── .env helpers ─────────────────────────────────────────────────────────────
// Resolved by paths.js so the CLI reads the same .env the server does
// (repo .env in dev, ~/.stoa/server/.env when installed).
const ENV_PATH = paths.envFile();

function readEnv() {
  const out = {};
  if (!fs.existsSync(ENV_PATH)) return out;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

// Same upsert semantics as server.js writeEnv().
function writeEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) content = content.replace(re, `${key}=${value}`);
  else content = content.trimEnd() + `\n${key}=${value}\n`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function getPort() {
  return parseInt(process.env.PORT || readEnv().PORT || '3030', 10);
}

// Resolve the DB exactly like the server (paths.js): repo db/stoa.db in dev,
// ~/.stoa/server/stoa.db when installed.
function resolveDb() {
  const p = paths.dbPath();
  return { path: p, exists: fs.existsSync(p) };
}

// WS server shares the HTTP port (server.js: new WebSocketServer({ server })).
function wsUrl() {
  return process.env.STOA_URL || `ws://localhost:${getPort()}`;
}

function pkg() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
  catch { return {}; }
}

function clientVersion() {
  try {
    const m = fs.readFileSync(path.join(ROOT, 'stoa.js'), 'utf8').match(/CLIENT_VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : '?';
  } catch { return '?'; }
}

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

// Probe a public endpoint to see if the server is up.
function probeServer(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/api/client/manifest', timeout }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ─── chat (default) ────────────────────────────────────────────────────────────
function cmdChat(args) {
  const room = args[0];
  const env = {
    ...process.env,
    STOA_TYPE: 'human',
    STOA_ACTOR_ID: process.env.STOA_ACTOR_ID || '1',
    STOA_URL: wsUrl(),
  };
  const argv = [path.join(ROOT, 'stoa.js')];
  if (room) argv.push(room);
  console.log(`${C.gray}Connecting to ${env.STOA_URL}${room ? ` (room ${room})` : ''}…${C.reset}`);
  const child = spawn('node', argv, { cwd: ROOT, env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

// ─── install: link the `stoa` command + enable the gateway ─────────────────────
// Make `stoa` available on PATH. Try npm link (standard, cross-platform); if that
// doesn't land on PATH, fall back to a symlink in a writable PATH dir.
function linkCommand() {
  const cliPath = path.join(ROOT, 'cli.js');
  spawnSync('npm', ['link'], { cwd: ROOT, stdio: 'ignore' });
  if (which('stoa')) { console.log(ok('`stoa` command available on PATH')); return true; }

  if (process.platform !== 'win32') {
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin']) {
      if (!pathDirs.includes(dir)) continue;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const link = path.join(dir, 'stoa');
        try { fs.unlinkSync(link); } catch {}
        fs.symlinkSync(cliPath, link);
        console.log(ok(`\`stoa\` command linked → ${link}`));
        return true;
      } catch {}
    }
  }
  console.log(warn('could not auto-link `stoa` — run `npm link` manually, or add this repo to PATH.'));
  return false;
}

async function cmdInstall() {
  console.log(`${C.bold}Installing Stoa…${C.reset}`);
  linkCommand();
  await require('./gateway').enable();
  console.log(`${C.gray}Done. Open the dashboard: ${C.reset}${C.cyan}stoa dashboard${C.reset}`);
}

// ─── dashboard (open the web UI in a browser) ──────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

async function cmdDashboard() {
  const gateway = require('./gateway');
  // Prefer the installed (gateway) server, fall back to the dev .env port.
  const ports = [...new Set([gateway.installedPort(), getPort()])];
  for (const port of ports) {
    if (await probeServer(port)) {
      const url = `http://localhost:${port}`;
      console.log(ok(`opening dashboard → ${url}`));
      return openBrowser(url);
    }
  }
  // Nothing is up — start the gateway, wait for it, then open.
  console.log(`${C.gray}No server responding — starting the gateway…${C.reset}`);
  await gateway.start();
  const port = gateway.installedPort();
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 30; i++) { if (await probeServer(port)) break; await sleep(500); }
  console.log(ok(`opening dashboard → ${url}`));
  openBrowser(url);
}

// ─── gateway (native background service — no PM2) ──────────────────────────────
async function cmdGateway(args) {
  const gateway = require('./gateway');
  const sub = args[0] || 'status';
  switch (sub) {
    case 'enable':  return gateway.enable();
    case 'disable': return gateway.disable();
    case 'start':   return gateway.start();
    case 'stop':    return gateway.stop();
    case 'restart': return gateway.restart();
    case 'status':  return gateway.status();
    case 'logs':    return gateway.logs(args.includes('-f') || args.includes('--follow'));
    default:
      console.log(bad(`unknown gateway command: ${sub}`));
      console.log(`${C.gray}Use: stoa gateway <enable|disable|start|stop|restart|status|logs>${C.reset}`);
  }
}

function run(cmd, args, allowFail = false) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0 && !allowFail) process.exitCode = r.status || 1;
  return r.status === 0;
}

// ─── update ────────────────────────────────────────────────────────────────────
function cmdUpdate() {
  console.log(`${C.bold}Updating Stoa…${C.reset}`);
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.log(bad('not a git checkout — cannot pull. Update manually.'));
    return;
  }
  const before = pkg().version;
  if (!run('git', ['pull', '--ff-only'])) {
    console.log(bad('git pull failed (local changes or non-fast-forward). Resolve, then retry.'));
    return;
  }
  // Reinstall deps only if the lockfile actually changed in this pull.
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD@{1}', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
  if (/package(-lock)?\.json/.test(changed)) {
    console.log(`${C.gray}Dependencies changed — running npm install…${C.reset}`);
    run('npm', ['install']);
  }
  const after = pkg().version;
  console.log(ok(before === after ? `already at v${after}` : `v${before} → v${after}`));

  console.log(`${C.gray}Restarting gateway (if enabled)…${C.reset}`);
  require('./gateway').restart().catch(() => warn('Gateway not enabled — restart your server manually to apply.'));
  console.log(`${C.gray}Connected agents auto-update within ~2 minutes.${C.reset}`);
}

// ─── doctor ──────────────────────────────────────────────────────────────────
async function cmdDoctor() {
  console.log(`${C.bold}Stoa doctor${C.reset}\n`);
  let problems = 0;
  const fail = (m) => { problems++; console.log(bad(m)); };
  const show = (p) => p.startsWith(ROOT) ? path.relative(ROOT, p) || '.' : p.replace(require('os').homedir(), '~');

  // Mode + data location
  console.log(ok(`mode: ${paths.mode()} (data: ${show(paths.serverDir())})`));

  // Node version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  major >= 20
    ? console.log(ok(`Node.js ${process.version}`))
    : fail(`Node.js ${process.version} — Stoa needs Node 20+`);

  // Dependencies
  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    try { require.resolve('better-sqlite3'); console.log(ok('dependencies installed')); }
    catch { fail('node_modules present but better-sqlite3 missing — run npm install'); }
  } else {
    fail('node_modules missing — run npm install');
  }

  // .env + port
  const env = readEnv();
  const port = getPort();
  fs.existsSync(ENV_PATH)
    ? console.log(ok(`.env found (PORT=${port})`))
    : console.log(warn(`.env not found — using defaults (PORT=${port})`));

  // Database
  const dbInfo = resolveDb();
  dbInfo.exists
    ? console.log(ok(`database present (${show(dbInfo.path)})`))
    : console.log(warn(`database not found at ${show(dbInfo.path)} — created on first server start`));

  // Server reachability (dev port from resolved .env)
  const up = await probeServer(port);
  up ? console.log(ok(`server responding on port ${port}`))
     : console.log(warn(`server not responding on port ${port} (run it: node server.js, or stoa gateway enable)`));

  // AI backends
  const backends = [['claude', 'Claude Code'], ['gemini', 'Gemini CLI'], ['ollama', 'Ollama']];
  const found = backends.filter(([bin]) => which(bin)).map(([, label]) => label);
  found.length
    ? console.log(ok(`AI backends available: ${found.join(', ')}`))
    : console.log(warn('no AI backend CLI found on PATH (claude / gemini / ollama)'));

  console.log('');
  console.log(problems === 0
    ? `${C.green}${C.bold}All critical checks passed.${C.reset}`
    : `${C.red}${C.bold}${problems} problem(s) found.${C.reset}`);
  process.exitCode = problems === 0 ? 0 : 1;
}

// ─── config ────────────────────────────────────────────────────────────────────
function cmdConfig(args) {
  const sub = args[0];
  if (!sub || sub === 'list') {
    const env = readEnv();
    const keys = Object.keys(env);
    if (!keys.length) { console.log(`${C.gray}(.env is empty or missing)${C.reset}`); return; }
    for (const k of keys) {
      const secret = /TOKEN|SECRET|KEY|PASSWORD/i.test(k);
      console.log(`${C.cyan}${k}${C.reset}=${secret ? `${C.gray}••••••••${C.reset}` : env[k]}`);
    }
    return;
  }
  if (sub === 'get') {
    const key = args[1];
    if (!key) { console.log(bad('usage: stoa config get KEY')); return; }
    const v = readEnv()[key];
    console.log(v === undefined ? `${C.gray}(unset)${C.reset}` : v);
    return;
  }
  if (sub === 'set') {
    const key = args[1], value = args.slice(2).join(' ');
    if (!key || args.length < 3) { console.log(bad('usage: stoa config set KEY VALUE')); return; }
    writeEnvKey(key, value);
    console.log(ok(`set ${key} (restart the server to apply)`));
    return;
  }
  console.log(bad(`unknown config command: ${sub}`));
  console.log(`${C.gray}Use: stoa config <list|get KEY|set KEY VALUE>${C.reset}`);
}

// ─── rooms ──────────────────────────────────────────────────────────────────
function cmdRooms() {
  const dbInfo = resolveDb();
  if (!dbInfo.exists) {
    console.log(bad(`database not found at ${path.relative(ROOT, dbInfo.path)} — run rooms on the server machine.`));
    return;
  }
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbInfo.path, { readonly: true });
  } catch (e) {
    if (/NODE_MODULE_VERSION|ERR_DLOPEN/.test(e.message)) {
      console.log(bad('better-sqlite3 was built for a different Node version than this CLI.'));
      console.log(`${C.gray}Run 'npm rebuild better-sqlite3' (or use the same Node the server runs on).${C.reset}`);
    } else {
      console.log(bad(`cannot open database: ${e.message}`));
    }
    return;
  }
  try {
    const rows = db.prepare(`
      SELECT r.id, r.title, r.is_pinned,
        (SELECT COUNT(*) FROM room_participants WHERE room_id=r.id) AS participants,
        (SELECT COUNT(*) FROM messages WHERE room_id=r.id) AS messages
      FROM rooms r
      WHERE r.archived_at IS NULL
      ORDER BY r.is_pinned DESC, r.id ASC
      LIMIT 200
    `).all();
    if (!rows.length) { console.log(`${C.gray}(no rooms)${C.reset}`); return; }
    for (const r of rows) {
      const pin = r.is_pinned ? `${C.yellow}📌${C.reset} ` : '';
      console.log(`${C.cyan}#${r.id}${C.reset}  ${pin}${C.bold}${r.title || '(untitled)'}${C.reset}  ${C.gray}${r.participants} participant(s), ${r.messages} message(s)${C.reset}`);
    }
  } finally {
    db.close();
  }
}

// ─── help ──────────────────────────────────────────────────────────────────────
function cmdHelp(args) {
  const topic = args[0];
  const details = {
    chat:    'stoa chat [room_id]\n  Start the interactive terminal chat client (human mode).\n  Defaults to room 1. STOA_URL is derived from PORT in .env.',
    install: 'stoa install\n  Bootstrap on a fresh machine: link the `stoa` command onto PATH + enable the gateway.\n  Run once as `node cli.js install` (the `stoa` command does not exist yet); afterwards use `stoa ...`.\n  Code stays in the repo; data lives in ~/.stoa/server. Then run "stoa dashboard".',
    link:    'stoa link\n  Make the `stoa` command available on PATH (npm link, or a symlink into ~/.local/bin).',
    dashboard: 'stoa dashboard\n  Open the web dashboard in your browser. Starts the gateway first if nothing is running.\n  Targets the installed server (~/.stoa, default :3030), else the dev server from .env.',
    gateway: 'stoa gateway <enable|disable|start|stop|restart|status|logs>\n  Run the server as a native background service (launchd on macOS, systemd on Linux).\n  enable  = start now + autostart on login/boot + restart on crash (data in ~/.stoa/server)\n  disable = stop + remove autostart.  logs -f to follow.  No PM2 required.',
    update:  'stoa update\n  git pull --ff-only, npm install if deps changed, then restart the gateway.\n  Connected agents auto-update within ~2 minutes.',
    doctor:  'stoa doctor\n  Check mode, Node version, dependencies, .env, database, server reachability, and AI backend CLIs.',
    config:  'stoa config <list|get KEY|set KEY VALUE>\n  Read or write .env values (secrets are masked in list).',
    rooms:   'stoa rooms\n  List active rooms by reading the local SQLite DB (run on the server machine).',
    version: 'stoa version\n  Print server (package.json) and agent client (CLIENT_VERSION) versions.',
  };
  if (topic && details[topic]) { console.log(details[topic]); return; }

  console.log(`${C.bold}Stoa${C.reset} — self-hosted multi-agent AI chat

${C.bold}Usage:${C.reset} stoa <command> [args]

${C.bold}Commands:${C.reset}
  ${C.cyan}dashboard${C.reset}          open the web dashboard (default when no command); starts the gateway if needed
  ${C.cyan}chat${C.reset} [room]        start the interactive terminal chat client
  ${C.cyan}install${C.reset}            bootstrap: link the \`stoa\` command + enable the gateway
  ${C.cyan}gateway${C.reset} <cmd>      run server as a background service (enable|disable|start|stop|restart|status|logs)
  ${C.cyan}doctor${C.reset}             diagnose the local setup
  ${C.cyan}update${C.reset}             pull latest code + restart gateway
  ${C.cyan}config${C.reset} <cmd>       list|get|set .env values
  ${C.cyan}rooms${C.reset}              list rooms
  ${C.cyan}version${C.reset}            print versions
  ${C.cyan}help${C.reset} [command]     show help (optionally for one command)

${C.gray}Run 'stoa help <command>' for details.${C.reset}`);
}

function cmdVersion() {
  console.log(`stoa server  v${pkg().version || '?'}`);
  console.log(`stoa client  v${clientVersion()}`);
  console.log(`node         ${process.version}`);
}

// ─── dispatch ──────────────────────────────────────────────────────────────────
(async function main() {
  const [, , cmd, ...args] = process.argv;

  switch (cmd) {
    case undefined:                                    // web-first: bare `stoa` opens the dashboard
    case 'dashboard':            await cmdDashboard(); break;
    case 'chat':                       cmdChat(args); break;
    case 'install':              await cmdInstall(); break;
    case 'link':                       linkCommand(); break;
    case 'gateway':              await cmdGateway(args); break;
    case 'update':                     cmdUpdate(); break;
    case 'doctor':               await cmdDoctor(); break;
    case 'config':                     cmdConfig(args); break;
    case 'rooms':                      cmdRooms(); break;
    case 'version': case '-v': case '--version': cmdVersion(); break;
    case 'help': case '-h': case '--help':       cmdHelp(args); break;
    default:
      console.log(bad(`unknown command: ${cmd}`));
      cmdHelp([]);
      process.exitCode = 1;
  }
})();
