// paths.js — central location resolver (development vs installed).
//
// Development (running from a git checkout, or STOA_DEV=1):
//   data lives inside the repo — db/stoa.db, ./uploads, ./.env — current behaviour.
//
// Installed (no .git, or STOA_DEV=0):
//   data lives under ~/.stoa/server — like Hermes' ~/.hermes.
//
// Overrides (highest priority first):
//   STOA_DATA_DIR   absolute data dir for the server (db/uploads/.env live here)
//   STOA_HOME       base dir (default: ~/.stoa); server dir = $STOA_HOME/server
//   STOA_DEV=1|0    force development / installed mode
//   DB_PATH         absolute override for the database file only

const os = require('os');
const path = require('path');
const fs = require('fs');

const REPO = __dirname;

function isDev() {
  if (process.env.STOA_DEV === '1') return true;
  if (process.env.STOA_DEV === '0') return false;
  return fs.existsSync(path.join(REPO, '.git'));
}

// Base home dir (~/.stoa), used for both server data and agent installs.
function home() {
  return process.env.STOA_HOME || path.join(os.homedir(), '.stoa');
}

// Where the server keeps its mutable data (db, uploads, .env).
function serverDir() {
  if (process.env.STOA_DATA_DIR) return path.resolve(process.env.STOA_DATA_DIR);
  return isDev() ? REPO : path.join(home(), 'server');
}

function dbPath() {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  return isDev() ? path.join(REPO, 'db', 'stoa.db') : path.join(serverDir(), 'stoa.db');
}

function uploadsDir() {
  return isDev() ? path.join(REPO, 'uploads') : path.join(serverDir(), 'uploads');
}

function envFile() {
  return isDev() ? path.join(REPO, '.env') : path.join(serverDir(), '.env');
}

// Create the data dir (and the db file's parent) if needed. Safe to call repeatedly.
function ensureDirs() {
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
  fs.mkdirSync(serverDir(), { recursive: true });
}

module.exports = {
  REPO,
  isDev,
  home,
  serverDir,
  dbPath,
  uploadsDir,
  envFile,
  ensureDirs,
  mode: () => (isDev() ? 'development' : 'installed'),
};
