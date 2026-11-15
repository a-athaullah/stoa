'use strict';

// Work journal: one file per agent session that is doing work right now, written on the agent
// machine so a connector restart (self-update, crash, SIGKILL) leaves a record of what it cut off.
// Incident 2026-11-15: a self-update restart killed every Claude Code session and its background
// shells and nothing knew which work had been interrupted. Recovery reads this (task card 3/3).
//
// Location: <dir>/actor-<actorId>/<sha256(session_key)[0..32]>.json, dir 0700, files 0600.
// Several agents may share one HOME, hence the per-actor subdirectory. The file name is a hash
// of the session key, never the key itself, so no room/thread/workdir value can steer the path.
//
// Entry schema (v 1). No prompt, token, secret or env is ever stored.
//   v                  1
//   actor_id           integer, the agent (STOA_ACTOR_ID) that owns the session
//   session_key        string, stoa.js buildSessionKey(): "<workdir>::<room|default>::t:<thread>[::sub:<id>]"
//   room_id            integer | null
//   thread_id          integer | null (null = main feed)
//   sub_agent_id       integer | null
//   message_id         integer | null, the Stoa run (trigger message) of the latest Stoa-started turn
//   task_id            integer | null, task board card that owns the thread (sent by the server)
//   resume_session_id  string | null, harness session id to resume (Claude Code --resume)
//   harness            "claude" | "codex"
//   state              "turn_running" | "background_only"
//   cause              what started this stretch of work: "turn" (Stoa run) | "auto_turn" (the CLI
//                      started a turn itself, e.g. after a background task finished) | "background"
//   since              ISO time the session went from idle to working (kept across state changes)
//   pid                connector process id that wrote the entry
//   updated_at         ISO time of the last write
//   recovered_at       ISO time | null, set by markRecovered() (card 3/3)
//   recovery_count     integer >= 0, incremented by markRecovered(); kept when the same session
//                      key is written again, so a recovery loop can be bounded
//
// An entry exists only while the session works: a turn runs, or the turn ended but background
// tasks are still running. It is removed once both are done, and when the session is closed or
// reset. Connector exit (restart/SIGKILL) leaves entries in place: that is what they are for.
//
// Every operation is best effort: a failing journal (disk full, read-only, permissions) logs and
// returns, it never throws into the connector and never fails an agent turn.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const STATES = new Set(['turn_running', 'background_only']);
const CAUSES = new Set(['turn', 'auto_turn', 'background']);
const HARNESSES = new Set(['claude', 'codex']);
const ENTRY_RE = /^[0-9a-f]{32}\.json$/;
const TMP_RE = /^\.[0-9a-f]{32}\.\d+\.[0-9a-f]+\.tmp$/;
const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_KEY_LENGTH = 4096;
const STALE_TMP_MS = 10 * 60 * 1000;

const isId = (v) => Number.isSafeInteger(v) && v > 0;
const idOrNull = (v) => (isId(v) ? v : null);
const strOrNull = (v, max = 256) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const isIsoOrNull = (v) => v === null || (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)));

function keyStem(sessionKey) {
  return crypto.createHash('sha256').update(sessionKey).digest('hex').slice(0, 32);
}

function validKey(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.length > 0 && sessionKey.length <= MAX_KEY_LENGTH && !sessionKey.includes('\0');
}

// Schema check for an entry read from disk; also binds the file name to the key inside it, so a
// file copied or renamed onto another session's name is rejected.
function validateEntry(entry, stem) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'not an object';
  if (entry.v !== SCHEMA_VERSION) return `unsupported version ${JSON.stringify(entry.v)}`;
  if (!validKey(entry.session_key)) return 'bad session_key';
  if (stem && keyStem(entry.session_key) !== stem) return 'file name does not match session_key';
  if (!isId(entry.actor_id)) return 'bad actor_id';
  for (const f of ['room_id', 'thread_id', 'sub_agent_id', 'message_id', 'task_id']) {
    if (entry[f] !== null && !isId(entry[f])) return `bad ${f}`;
  }
  if (entry.resume_session_id !== null && !strOrNull(entry.resume_session_id)) return 'bad resume_session_id';
  if (!HARNESSES.has(entry.harness)) return 'bad harness';
  if (!STATES.has(entry.state)) return 'bad state';
  if (!CAUSES.has(entry.cause)) return 'bad cause';
  if (!isIsoOrNull(entry.since) || entry.since === null) return 'bad since';
  if (!isIsoOrNull(entry.updated_at) || entry.updated_at === null) return 'bad updated_at';
  if (!isIsoOrNull(entry.recovered_at)) return 'bad recovered_at';
  if (!Number.isSafeInteger(entry.recovery_count) || entry.recovery_count < 0) return 'bad recovery_count';
  if (!isId(entry.pid)) return 'bad pid';
  return null;
}

function createWorkJournal({ baseDir, actorId, pid = process.pid, now = () => new Date(), log = console } = {}) {
  if (typeof baseDir !== 'string' || !path.isAbsolute(baseDir)) throw new Error('work journal: baseDir must be an absolute path');
  if (!isId(actorId)) throw new Error('work journal: actorId must be a positive integer');
  const dir = path.join(baseDir, `actor-${actorId}`);
  let dirReady = false;
  let lastWarn = '';

  // One line per distinct failure, so a full disk does not flood the log on every turn.
  function warn(msg) {
    if (msg === lastWarn) return;
    lastWarn = msg;
    try { log.warn(`[journal] ${msg}`); } catch {}
  }

  function fileFor(sessionKey) {
    if (!validKey(sessionKey)) return null;
    const file = path.join(dir, `${keyStem(sessionKey)}.json`);
    return path.dirname(file) === dir ? file : null;
  }

  // The directory must be a real directory owned by nobody else's writes: a symlink there could
  // point the journal anywhere, so it is refused rather than followed.
  function ensureDir() {
    if (dirReady) return true;
    for (const d of [baseDir, dir]) {
      let st = null;
      try { st = fs.lstatSync(d); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (!st) {
        fs.mkdirSync(d, { mode: 0o700 });
        st = fs.lstatSync(d);
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${d} is not a directory`);
      if ((st.mode & 0o077) !== 0) fs.chmodSync(d, 0o700);
    }
    dirReady = true;
    return true;
  }

  function fsyncDir() {
    let fd = null;
    try {
      fd = fs.openSync(dir, 'r');
      fs.fsyncSync(fd);
    } catch {
      // Directory fsync is not supported everywhere (Windows); the rename itself is still atomic.
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
    }
  }

  function writeAtomic(file, data) {
    const tmp = path.join(dir, `.${path.basename(file, '.json')}.${pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    let fd = null;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, file);
    } catch (e) {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
    fsyncDir();
  }

  function readEntry(file) {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return { error: 'not a regular file' };
    if (st.size > MAX_ENTRY_BYTES) return { error: `too large (${st.size} bytes)` };
    let entry;
    try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      return { error: `invalid JSON (${e.message.slice(0, 80)})` };
    }
    const err = validateEntry(entry, path.basename(file, '.json'));
    return err ? { error: err } : { entry };
  }

  function quarantine(file, reason) {
    const target = `${file}.corrupt-${now().getTime()}`;
    try {
      fs.renameSync(file, target);
      warn(`quarantined ${path.basename(file)} → ${path.basename(target)}: ${reason}`);
    } catch (e) {
      warn(`ignoring unreadable ${path.basename(file)} (${reason}); quarantine failed: ${e.message}`);
    }
  }

  // Writes (or replaces) the entry of a working session. `fields` carries the session facts; the
  // recovery bookkeeping of an existing entry for the same key survives the rewrite.
  function upsert(sessionKey, fields = {}) {
    try {
      const file = fileFor(sessionKey);
      if (!file) { warn('upsert: invalid session key'); return false; }
      if (!STATES.has(fields.state)) { warn(`upsert: invalid state ${JSON.stringify(fields.state)}`); return false; }
      ensureDir();
      let prev = null;
      try { prev = readEntry(file).entry || null; } catch {}
      const stamp = now().toISOString();
      const entry = {
        v: SCHEMA_VERSION,
        actor_id: actorId,
        session_key: sessionKey,
        room_id: idOrNull(fields.room_id),
        thread_id: idOrNull(fields.thread_id),
        sub_agent_id: idOrNull(fields.sub_agent_id),
        message_id: idOrNull(fields.message_id),
        task_id: idOrNull(fields.task_id),
        resume_session_id: strOrNull(fields.resume_session_id),
        harness: HARNESSES.has(fields.harness) ? fields.harness : 'claude',
        state: fields.state,
        cause: CAUSES.has(fields.cause) ? fields.cause : 'turn',
        since: isIsoOrNull(fields.since) && fields.since ? fields.since : stamp,
        pid,
        updated_at: stamp,
        recovered_at: prev ? prev.recovered_at : null,
        recovery_count: prev ? prev.recovery_count : 0,
      };
      writeAtomic(file, JSON.stringify(entry) + '\n');
      return true;
    } catch (e) {
      dirReady = false;
      warn(`write failed: ${e.message}`);
      return false;
    }
  }

  function remove(sessionKey) {
    try {
      const file = fileFor(sessionKey);
      if (!file) return false;
      fs.unlinkSync(file);
      fsyncDir();
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') warn(`remove failed: ${e.message}`);
      return false;
    }
  }

  function get(sessionKey) {
    try {
      const file = fileFor(sessionKey);
      if (!file) return null;
      return readEntry(file).entry || null;
    } catch {
      return null;
    }
  }

  // Valid entries only. Broken files (truncated, not JSON, wrong schema, not a regular file) are
  // moved aside as *.corrupt-<ms>; leftovers of a write cut off by a crash are deleted once old.
  function list() {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) {
      if (e.code !== 'ENOENT') warn(`list failed: ${e.message}`);
      return [];
    }
    const out = [];
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (TMP_RE.test(name)) {
          if (now().getTime() - fs.lstatSync(file).mtimeMs > STALE_TMP_MS) fs.unlinkSync(file);
          continue;
        }
        if (!ENTRY_RE.test(name)) continue;
        const { entry, error } = readEntry(file);
        if (entry) out.push(entry);
        else quarantine(file, error);
      } catch (e) {
        if (e.code !== 'ENOENT') warn(`skipping ${name}: ${e.message}`);
      }
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }

  function markRecovered(sessionKey) {
    try {
      const file = fileFor(sessionKey);
      if (!file) return null;
      const { entry } = readEntry(file);
      if (!entry) return null;
      const next = { ...entry, recovered_at: now().toISOString(), recovery_count: entry.recovery_count + 1, updated_at: now().toISOString() };
      ensureDir();
      writeAtomic(file, JSON.stringify(next) + '\n');
      return next;
    } catch (e) {
      if (e.code !== 'ENOENT') warn(`markRecovered failed: ${e.message}`);
      return null;
    }
  }

  return { dir, fileFor, upsert, remove, get, list, markRecovered };
}

module.exports = { createWorkJournal, validateEntry, keyStem, SCHEMA_VERSION };
