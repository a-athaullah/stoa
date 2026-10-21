// .env file handling. The live .env holds PORT; a truncating write racing another
// process (or a test server sharing the file) once left it without PORT and the
// server came back on 3000. Writes are therefore tmp + rename (readers never see a
// half-written file) and test servers point STOA_ENV_FILE at a throwaway copy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { escapeRegExp } = require('./regex-safety');

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const DEFAULT_PORT = 3000;

function resolveEnvFile(baseDir, env = process.env) {
  return env.STOA_ENV_FILE ? path.resolve(baseDir, env.STOA_ENV_FILE) : path.join(baseDir, '.env');
}

// Existing process.env values win, so an explicit env (launchd, run-tests) is never overridden.
function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
  return true;
}

function setEnvKey(file, key, value) {
  value = String(value);
  if (!KEY_RE.test(key)) throw new Error(`invalid env key: ${key}`);
  // A newline would let one setting inject (or shadow) another key, e.g. PORT.
  if (/[\r\n]/.test(value)) throw new Error(`invalid env value for ${key}: contains a line break`);
  // Follow a symlinked .env so the link survives the rename.
  let target = file;
  try { target = fs.realpathSync(file); } catch {}
  const exists = fs.existsSync(target);
  let content = exists ? fs.readFileSync(target, 'utf8') : '';
  const re = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  if (re.test(content)) content = content.replace(re, () => `${key}=${value}`);
  else content = content.trimEnd() + (content.trim() ? '\n' : '') + `${key}=${value}\n`;
  const mode = exists ? fs.statSync(target).mode & 0o777 : 0o600;
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode });
    if (exists) fs.copyFileSync(target, `${target}.bak`);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// Returns a warning when PORT is missing everywhere, so a silent fallback shows up in the logs.
function portFallbackWarning(env, file) {
  if (parseInt(env.PORT) > 0) return null;
  return `[env] PORT not set, falling back to ${DEFAULT_PORT}; check ${file}`;
}

module.exports = { resolveEnvFile, loadEnvFile, setEnvKey, portFallbackWarning, DEFAULT_PORT };
