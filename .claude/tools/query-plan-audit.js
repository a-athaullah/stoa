#!/usr/bin/env node
/**
 * Query plan audit — runs EXPLAIN QUERY PLAN for every db.prepare() SQL literal
 * in server.js + lib/*.js against a snapshot of the live DB (read-only copy).
 *
 * Usage: node .claude/tools/query-plan-audit.js [--db=db/stoa.db] [--all] [--min-rows=N]
 *   --all        include queries whose plan is fully indexed
 *   --min-rows   only flag SCANs on tables with >= N rows (default 0)
 * Output: JSON { snapshot, tables, summary, flagged[], unparsed[], unindexedFKs[] }
 *   flagged[i] = { file, line, sql, scans[], tempBtree[], plan[] }
 *
 * Notes:
 * - Bind params (?, @x, :x, $x) are replaced with NULL; ${...} in template
 *   literals with NULL (or a single ? list). Queries that still fail to
 *   prepare are listed in `unparsed` for manual review.
 * - "SCAN t USING COVERING INDEX" / "USING INDEX" counts as indexed.
 * - A SCAN on a tiny/config table is listed but marked small=true.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));

const root = path.resolve(__dirname, '../..');
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const showAll = process.argv.includes('--all');
const minRows = parseInt(arg('min-rows', '0'), 10) || 0;
const dbPath = path.resolve(root, arg('db', 'db/stoa.db'));

// ── snapshot (never touch the live file) ────────────────────────────────────
const snap = path.join(os.tmpdir(), `stoa-qplan-${process.pid}.db`);
const live = new Database(dbPath, { readonly: true, fileMustExist: true });
live.prepare('VACUUM INTO ?').run(snap);
live.close();
const db = new Database(snap, { readonly: true });

const tables = {};
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
  try { tables[name] = db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c; } catch { tables[name] = null; }
}

// FK child columns without a leading index: every parent DELETE/UPDATE scans the child.
const unindexedFKs = [];
for (const t of Object.keys(tables)) {
  let fks, idx;
  try {
    fks = db.prepare(`PRAGMA foreign_key_list("${t}")`).all();
    idx = db.prepare(`PRAGMA index_list("${t}")`).all()
      .map(i => db.prepare(`PRAGMA index_info("${i.name}")`).all().map(c => c.name)[0]);
  } catch { continue; }
  const pk = db.prepare(`PRAGMA table_info("${t}")`).all().filter(c => c.pk === 1).map(c => c.name);
  for (const f of fks) {
    if (idx.includes(f.from) || (pk.length === 1 && pk[0] === f.from)) continue;
    unindexedFKs.push({ table: t, column: f.from, refs: f.table, onDelete: f.on_delete, rows: tables[t] });
  }
}

// ── extract SQL literals following prepare( ──────────────────────────────────
function readLiteral(src, i) {
  const q = src[i];
  if (q !== '`' && q !== "'" && q !== '"') return null;
  let out = '', j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { out += src[j + 1]; j += 2; continue; }
    if (c === q) return { text: out, end: j + 1 };
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 1, k = j + 2;
      while (k < src.length && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
      const expr = src.slice(j + 2, k - 1);
      out += /placeholders|map\(\s*\(\)\s*=>\s*'\?'|\.join\(\s*['"],/.test(expr) ? '?' : 'NULL';
      j = k; continue;
    }
    out += c; j++;
  }
  return null;
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const res = [];
  const re = /\.prepare\(\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, sql = '';
    // concatenated literals: 'a' + 'b'
    for (;;) {
      const lit = readLiteral(src, i);
      if (!lit) break;
      sql += lit.text;
      const rest = src.slice(lit.end).match(/^\s*\+\s*/);
      if (!rest) break;
      i = lit.end + rest[0].length;
    }
    const line = src.slice(0, m.index).split('\n').length;
    if (sql) res.push({ file: path.relative(root, file), line, sql: sql.replace(/\s+/g, ' ').trim() });
    else res.push({ file: path.relative(root, file), line, sql: null });
  }
  return res;
}

const files = [path.join(root, 'server.js'),
  ...fs.readdirSync(path.join(root, 'lib')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'lib', f))];
const stmts = files.flatMap(extract);

const nullify = s => s.replace(/('(?:[^']|'')*')|[?](\d*)|[@:$][A-Za-z_]\w*/g, (t, str) => str ? str : 'NULL');

const flagged = [], unparsed = [];
let ok = 0, skipped = 0;
const seen = new Set();
for (const s of stmts) {
  if (!s.sql) { unparsed.push({ file: s.file, line: s.line, reason: 'non-literal (variable/builder)' }); continue; }
  if (!/^\s*(SELECT|UPDATE|DELETE|INSERT|WITH|REPLACE)/i.test(s.sql)) { skipped++; continue; }
  const key = s.sql;
  if (seen.has(key)) continue;
  seen.add(key);
  let plan;
  try { plan = db.prepare('EXPLAIN QUERY PLAN ' + nullify(s.sql)).all().map(r => r.detail); }
  catch (e) { unparsed.push({ file: s.file, line: s.line, reason: e.message, sql: s.sql.slice(0, 200) }); continue; }
  const scans = plan.filter(d => /^SCAN /.test(d) && !/USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/.test(d))
    .map(d => { const t = d.match(/^SCAN (\w+)/)?.[1]; const real = Object.keys(tables).find(n => n === t) || null;
      return { detail: d, table: t, rows: real ? tables[real] : null }; })
    .filter(x => x.rows === null || x.rows >= minRows);
  const tempBtree = plan.filter(d => /USE TEMP B-TREE/.test(d));
  if (scans.length || tempBtree.length || showAll) flagged.push({ file: s.file, line: s.line, sql: s.sql, scans, tempBtree, plan });
  else ok++;
}

flagged.sort((a, b) => Math.max(0, ...b.scans.map(x => x.rows || 0)) - Math.max(0, ...a.scans.map(x => x.rows || 0)));
db.close();
fs.rmSync(snap, { force: true });

console.log(JSON.stringify({
  snapshot: path.relative(root, dbPath),
  tables,
  summary: { statements: stmts.length, unique: seen.size, indexedOk: ok, flagged: flagged.length, unparsed: unparsed.length, nonDml: skipped },
  flagged, unparsed, unindexedFKs,
}, null, 2));
