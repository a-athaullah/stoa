#!/usr/bin/env node
// Requeue knowledge extraction jobs that failed only because a title or summary was over the
// prompt's limit (last_error 'invalid output: ... longer than ...'), from before the server cut such
// texts instead of refusing them (lib/knowledge-extraction.js HARD). Other failures stay failed.
// The work is requeueLengthFailures() in lib/knowledge-extraction.js; this is its command line.
//
// Run after the fix is merged and the server restarted (otherwise the jobs fail again).
// Writes only with a fresh backup: the DB is copied (SQLite online backup) next to it first.
//
// Usage: node .claude/tools/requeue-knowledge-jobs.js [--dry-run] [--db=<path>]   (default db/stoa.db)
// Output: {db, dryRun, backup, requeued: [job ids], superseded: [job ids deleted: a pending job covers them]}
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const fail = (msg) => { console.error(JSON.stringify({ error: msg })); process.exit(1); };
for (const k of Object.keys(args)) if (!['dry-run', 'db'].includes(k)) fail(`unknown option --${k}`);
if (args.db === true) fail('--db needs a path');
const dbPath = path.resolve(args.db || path.join(root, 'db', 'stoa.db'));
const dryRun = args['dry-run'] === true;
if (!fs.existsSync(dbPath)) fail(`no database at ${dbPath}`);

const Database = require('better-sqlite3');
const { requeueLengthFailures } = require(path.join(root, 'lib', 'knowledge-extraction'));

(async () => {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    let backup = null;
    if (!dryRun) {
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
      backup = path.join(path.dirname(dbPath), `${path.basename(dbPath, '.db')}-backup-requeue-${stamp}.db`);
      if (fs.existsSync(backup)) fail(`backup ${backup} already exists`);
      await db.backup(backup);
    }
    const r = requeueLengthFailures(db, { dryRun });
    console.log(JSON.stringify({ db: dbPath, backup, ...r }, null, 2));
  } finally {
    db.close();
  }
})().catch(e => fail(e.message));
