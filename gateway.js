// gateway.js — run the Stoa server as a native background service.
//
// macOS  → launchd  (~/Library/LaunchAgents/com.stoa.server.plist)
// Linux  → systemd  (~/.config/systemd/user/stoa-server.service)
//
// No PM2 dependency. The service runs server.js from the repo but with
// STOA_DEV=0, so the *code* stays in the dev checkout while *data* lives in
// ~/.stoa/server — you can keep developing and still run it like an install.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const REPO = __dirname;
const LABEL = 'com.stoa.server';        // launchd label
const UNIT = 'stoa-server';             // systemd unit name
const NODE = process.execPath;

// ─── colors ──────────────────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[92m', yellow: '\x1b[93m', red: '\x1b[91m', gray: '\x1b[90m', cyan: '\x1b[96m' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const bad = (s) => console.log(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset} ${s}`);
const note = (s) => console.log(`${C.gray}${s}${C.reset}`);

// ─── installed-mode locations (the service always runs installed) ─────────────
function homeDir() { return process.env.STOA_HOME || path.join(os.homedir(), '.stoa'); }
function serverDir() { return process.env.STOA_DATA_DIR || path.join(homeDir(), 'server'); }
function logsDir() { return path.join(homeDir(), 'logs'); }
function logFile() { return path.join(logsDir(), 'server.log'); }
function errFile() { return path.join(logsDir(), 'server.err.log'); }

// Port the *installed* server listens on (its own .env, default 3030).
function installedPort() {
  try {
    const env = fs.readFileSync(path.join(serverDir(), '.env'), 'utf8');
    const m = env.match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return 3030;
}

function sh(cmd, args, { quiet = true } = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
}

function probe(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/api/client/manifest', timeout }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function ensureDirs() {
  fs.mkdirSync(serverDir(), { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
}

// ─── macOS / launchd ───────────────────────────────────────────────────────────
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function plistContent() {
  const pathEnv = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${path.join(REPO, 'server.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>STOA_DEV</key><string>0</string>
    <key>STOA_HOME</key><string>${homeDir()}</string>
    <key>PATH</key><string>${pathEnv}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logFile()}</string>
  <key>StandardErrorPath</key><string>${errFile()}</string>
</dict>
</plist>
`;
}

function writePlist() {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plistContent(), 'utf8');
}

// launchctl load/unload -w: most predictable persistent semantics for user agents.
const mac = {
  enable() { writePlist(); sh('launchctl', ['unload', PLIST]); sh('launchctl', ['load', '-w', PLIST]); },
  disable() { sh('launchctl', ['unload', '-w', PLIST]); },
  start() { if (!fs.existsSync(PLIST)) writePlist(); sh('launchctl', ['load', '-w', PLIST]); },
  stop() { sh('launchctl', ['unload', PLIST]); },
  loaded() { return sh('launchctl', ['list', LABEL]).status === 0; },
  installed() { return fs.existsSync(PLIST); },
  logsCmd(follow) { return follow ? ['tail', ['-n', '120', '-f', logFile()]] : ['tail', ['-n', '120', logFile()]]; },
};

// ─── Linux / systemd (user) ────────────────────────────────────────────────────
const UNIT_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', `${UNIT}.service`);

function unitContent() {
  return `[Unit]
Description=Stoa server
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO}
Environment=STOA_DEV=0
Environment=STOA_HOME=${homeDir()}
ExecStart=${NODE} ${path.join(REPO, 'server.js')}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
}

function writeUnit() {
  fs.mkdirSync(path.dirname(UNIT_PATH), { recursive: true });
  fs.writeFileSync(UNIT_PATH, unitContent(), 'utf8');
  sh('systemctl', ['--user', 'daemon-reload']);
}

const linux = {
  enable() { writeUnit(); sh('systemctl', ['--user', 'enable', '--now', UNIT]); },
  disable() { sh('systemctl', ['--user', 'disable', '--now', UNIT]); },
  start() { if (!fs.existsSync(UNIT_PATH)) writeUnit(); sh('systemctl', ['--user', 'start', UNIT]); },
  stop() { sh('systemctl', ['--user', 'stop', UNIT]); },
  loaded() { return sh('systemctl', ['--user', 'is-active', UNIT]).stdout.trim() === 'active'; },
  installed() { return fs.existsSync(UNIT_PATH); },
  logsCmd(follow) { return ['journalctl', ['--user', '-u', UNIT, '-n', '120', ...(follow ? ['-f'] : [])]]; },
};

// ─── platform selection ─────────────────────────────────────────────────────────
function impl() {
  if (process.platform === 'darwin') return mac;
  if (process.platform === 'linux') return linux;
  return null;
}

function unsupported() {
  bad(`gateway service not supported on '${process.platform}' yet.`);
  note('Use a process manager (e.g. PM2) or run: node server.js');
}

// ─── public commands ─────────────────────────────────────────────────────────
async function enable() {
  const p = impl(); if (!p) return unsupported();
  ensureDirs();
  p.enable();
  ok(`gateway enabled — starts on login + restarts on crash (data: ${serverDir()})`);
  await reportStatus(p);
  hintSeedDb();
}

async function disable() {
  const p = impl(); if (!p) return unsupported();
  p.disable();
  ok('gateway disabled — stopped and will not start on boot.');
}

async function start() {
  const p = impl(); if (!p) return unsupported();
  ensureDirs();
  p.start();
  ok('gateway started.');
  await reportStatus(p);
}

async function stop() {
  const p = impl(); if (!p) return unsupported();
  p.stop();
  ok('gateway stopped.');
}

async function restart() {
  const p = impl(); if (!p) return unsupported();
  p.stop();
  p.start();
  ok('gateway restarted.');
  await reportStatus(p);
}

async function status() {
  const p = impl(); if (!p) return unsupported();
  await reportStatus(p, true);
}

function logs(follow) {
  const p = impl(); if (!p) return unsupported();
  const [cmd, args] = p.logsCmd(follow);
  spawnSync(cmd, args, { stdio: 'inherit' });
}

async function reportStatus(p, verbose = false) {
  const loaded = p.loaded();
  const port = installedPort();
  const up = await probe(port);
  loaded ? ok('service loaded') : warn('service not loaded');
  up ? ok(`responding on port ${port}`) : warn(`not responding on port ${port} yet`);
  if (verbose) {
    note(`installed: ${p.installed() ? 'yes' : 'no'}`);
    note(`data dir : ${serverDir()}`);
    note(`logs     : ${logFile()}`);
  }
}

// If switching to installed mode for the first time, the home DB is empty.
function hintSeedDb() {
  const homeDb = path.join(serverDir(), 'stoa.db');
  const repoDb = path.join(REPO, 'db', 'stoa.db');
  if (!fs.existsSync(homeDb) && fs.existsSync(repoDb)) {
    note(`Tip: to carry over your dev data, copy it once:`);
    note(`  cp "${repoDb}" "${homeDb}"`);
  }
}

module.exports = { enable, disable, start, stop, restart, status, logs, installedPort, serverDir };
