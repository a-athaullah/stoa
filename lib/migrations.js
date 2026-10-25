'use strict';

const fs = require('fs');
const path = require('path');

const DUPLICATE_COLUMN_RE = /duplicate column name/i;
const INDEX_EXISTS_RE = /^index \S+ already exists/i;

// Split a migration file into statements. Aware of quotes, comments and
// CREATE TRIGGER ... BEGIN ... END bodies (whose inner ';' do not end the statement).
function splitSqlStatements(sql) {
  const out = [];
  let start = 0;
  let i = 0;
  let words = [];
  const n = sql.length;
  const flush = (end) => {
    const stmt = sql.slice(start, end).trim();
    if (stripSqlComments(stmt)) out.push(stmt);
    start = end + 1;
    words = [];
  };
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const closeCh = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === closeCh) {
          if (closeCh !== ']' && sql[j + 1] === closeCh) { j += 2; continue; }
          break;
        }
        j++;
      }
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      words.push(sql.slice(i, j).toUpperCase());
      i = j;
    } else if (c === ';') {
      const isTrigger = words[0] === 'CREATE' && (words[1] === 'TRIGGER' || words[2] === 'TRIGGER');
      if (!isTrigger || !words.includes('BEGIN') || words[words.length - 1] === 'END') flush(i);
      i++;
    } else {
      i++;
    }
  }
  if (start < n) flush(n);
  return out;
}

function stripSqlComments(stmt) {
  return stmt.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

function isAddColumn(stmt) {
  return /^ALTER\s+TABLE\s+[\s\S]+?\s+ADD\s/i.test(stripSqlComments(stmt));
}

function isCreateIndex(stmt) {
  return /^CREATE\s+(UNIQUE\s+)?INDEX\s/i.test(stripSqlComments(stmt));
}

// Only these two errors mean "the baseline already has what this statement adds".
// CREATE TABLE is deliberately not included: an existing table may have a different shape.
function alreadyPresent(stmt, message) {
  return (DUPLICATE_COLUMN_RE.test(message) && isAddColumn(stmt)) || (INDEX_EXISTS_RE.test(message) && isCreateIndex(stmt));
}

// A fresh DB is built from db/schema.sqlite.sql, which already contains the columns and
// indexes that older migrations add. Those migrations then fail with "duplicate column
// name" / "index ... already exists", roll back and are retried (and logged) on every
// boot, and the rest of the file (indexes, backfills, table rebuilds) never runs. On those
// errors, re-run the file statement by statement in one transaction, skip only the
// ADD COLUMN / CREATE INDEX whose object already exists, and record it as applied.
// Any other error still rolls the whole file back.
function applyMigration(db, filename, sql) {
  try {
    db.exec('BEGIN TRANSACTION');
    db.exec(sql);
    db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(filename);
    db.exec('COMMIT');
    return { status: 'applied' };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    if (!DUPLICATE_COLUMN_RE.test(e.message) && !INDEX_EXISTS_RE.test(e.message)) return { status: 'failed', error: e.message };
  }
  const skipped = [];
  try {
    db.exec('BEGIN TRANSACTION');
    for (const stmt of splitSqlStatements(sql)) {
      try {
        db.exec(stmt);
      } catch (e) {
        if (alreadyPresent(stmt, e.message)) { skipped.push(e.message); continue; }
        throw e;
      }
    }
    db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(filename);
    db.exec('COMMIT');
    return { status: 'reconciled', skipped };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    return { status: 'failed', error: e.message };
  }
}

function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
}

// Old inline migrations, seeded as already-applied for existing DBs
const LEGACY_MIGRATIONS = [
  { filename: '20260590-migrate-ai-sessions-unique.sql', applied: (db) => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'").get();
    return !!(tbl?.sql && !tbl.sql.includes('participant_id INTEGER NOT NULL UNIQUE'));
  }},
  { filename: '20260591-add-agent-workdirs-model.sql', applied: (db) => {
    const cols = db.prepare("PRAGMA table_info(agent_workdirs)").all().map(c => c.name);
    return cols.includes('model');
  }},
  { filename: '20260592-add-rooms-archived-at.sql', applied: (db) => {
    const cols = db.prepare("PRAGMA table_info(rooms)").all().map(c => c.name);
    return cols.includes('archived_at');
  }},
  { filename: '20260601-add-system-event-state.sql', applied: (db) => {
    const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
    return !!(tbl?.sql?.includes('system_event'));
  }},
  { filename: '20260602-clean-duplicate-settings.sql', applied: () => true },
  { filename: '20260609-automation-connections.sql', applied: (db) => {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_connections'").get();
    const cols = db.prepare('PRAGMA table_info(automations)').all().map(c => c.name);
    return !!(hasTable && cols.includes('connection_id'));
  }},
];

function seedLegacyMigrations(db) {
  for (const m of LEGACY_MIGRATIONS) {
    if (!db.prepare('SELECT 1 FROM migrations WHERE filename=?').get(m.filename) && m.applied(db)) {
      db.prepare('INSERT OR IGNORE INTO migrations (filename) VALUES (?)').run(m.filename);
    }
  }
}

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function execSchema(db, schemaSql) {
  try { db.exec(schemaSql); return null; } catch (e) { return e; }
}

// Applies every pending migration file. Files run in filename order, but some same-day files depend on
// one that sorts after them (20260619-usage-log-indexes.sql needs 20260619-usage-log.sql, '-' < '.';
// 20260911-backfill-thread-id.sql needs 20260911-threads-core.sql; 20261014-email-message-ids.sql
// needs 20261014-email-threads.sql). Renaming them is not an option: the filename is the key in the
// migrations table, so a renamed file would run again on every DB that already applied it. Instead a
// failed file (rolled back, so retrying is safe) is retried in another pass for as long as a pass
// makes progress.
//
// schemaSql (boot only): db/schema.sqlite.sql is executed first. On an existing DB, db.exec stops at
// the first statement that needs a pending migration (an index on a column not added yet), so the
// tables after it do not exist for this run's migrations. After a pass that made progress the schema
// is executed again. Without both retries an upgrade needed two boots ("run the migrations twice").
function runMigrations(db, dir = DEFAULT_MIGRATIONS_DIR, log = console, { schemaSql } = {}) {
  let schemaError = schemaSql === undefined ? null : execSchema(db, schemaSql);
  ensureMigrationsTable(db);
  seedLegacyMigrations(db);
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  } catch (e) {
    if (e.code !== 'ENOENT') log.error('[migration] runner error:', e.message);
    if (schemaError) log.error('[schema] init warning (non-fatal):', schemaError.message);
    return [];
  }
  const isApplied = db.prepare('SELECT 1 FROM migrations WHERE filename=?');
  const results = new Map();
  let pending = files.filter(f => !isApplied.get(f));
  while (pending.length) {
    const failed = [];
    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
      const r = applyMigration(db, filename, sql);
      results.set(filename, { filename, ...r });
      if (r.status === 'failed') { failed.push(filename); continue; }
      if (r.status === 'applied') log.log(`[migration] applied: ${filename}`);
      else log.log(`[migration] applied: ${filename} (already present, skipped: ${r.skipped.join('; ')})`);
    }
    const progress = failed.length < pending.length;
    if (schemaError && progress) schemaError = execSchema(db, schemaSql);
    if (!progress) break;
    pending = failed;
  }
  for (const r of results.values()) {
    if (r.status === 'failed') log.error(`[migration] failed: ${r.filename} —`, r.error);
  }
  if (schemaError) log.error('[schema] init warning (non-fatal):', schemaError.message);
  return [...results.values()];
}

// Migration files on disk that are not recorded as applied (a pull without a restart, or a failure).
function pendingMigrations(db, dir = DEFAULT_MIGRATIONS_DIR) {
  const applied = new Set(db.prepare('SELECT filename FROM migrations').all().map(r => r.filename));
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return files.filter(f => f.endsWith('.sql') && !applied.has(f)).sort();
}

module.exports = { runMigrations, pendingMigrations, applyMigration, splitSqlStatements };
