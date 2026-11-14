#!/usr/bin/env node

/**
 * pre-restart-check.js
 *
 * Cek "setelah merge, sebelum restart server". Read-only terhadap repo, dist/ dan DB live:
 * build percobaan ditulis ke direktori temp, TIDAK menyentuh dist/ (dist/stoa.js dipakai
 * auto-update agent; lihat insiden 2026-11-13).
 *
 *   node .claude/tools/pre-restart-check.js [--no-fetch] [--base=master]
 *
 * Cek: conflict_markers, unmerged, up_to_date, syntax, dist_bundle, bundle_build, migrations.
 * Output: JSON {pass, checks: [{name, status: PASS|FAIL|WARN, detail}], pendingMigrations[]}
 * Exit code 0 jika semua PASS/WARN, 1 jika ada FAIL.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const NO_FETCH = args.includes('--no-fetch');
const BASE = (args.find(a => a.startsWith('--base=')) || '--base=master').slice(7);

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const checks = [];
const add = (name, status, detail, extra) => checks.push({ name, status, detail, ...(extra || {}) });

// Marker di awal baris. "=======" sengaja tidak dicari sendiri: itu garis setext di markdown.
const MARKER_RE = '^(<{7}( |$)|>{7}( |$))';

function checkConflictMarkers() {
  let out = '';
  try {
    out = git('grep', '-I', '-n', '-E', MARKER_RE, '--', '.', ':(exclude)node_modules');
  } catch (e) {
    if (e.status !== 1) return add('conflict_markers', 'FAIL', `git grep error: ${e.message.split('\n')[0]}`);
  }
  const hits = out.split('\n').filter(Boolean);
  if (!hits.length) return add('conflict_markers', 'PASS', 'tidak ada marker <<<<<<< / >>>>>>> di file tracked');
  const files = [...new Set(hits.map(h => h.split(':')[0]))];
  add('conflict_markers', 'FAIL', `${hits.length} baris marker di ${files.length} file`, { files, sample: hits.slice(0, 5) });
}

function checkUnmerged() {
  const unmerged = [...new Set(git('ls-files', '-u').split('\n').filter(Boolean).map(l => l.split('\t')[1]))];
  const uu = git('status', '--porcelain').split('\n').filter(l => /^(DD|AU|UD|UA|DU|AA|UU) /.test(l)).map(l => l.slice(3));
  const all = [...new Set([...unmerged, ...uu])];
  if (!all.length) return add('unmerged', 'PASS', 'tidak ada file UU / unmerged');
  add('unmerged', 'FAIL', `${all.length} file unmerged`, { files: all });
}

function checkUpToDate() {
  const branch = git('branch', '--show-current').trim();
  if (!NO_FETCH) {
    try { execFileSync('git', ['fetch', '--quiet', 'origin', BASE], { cwd: ROOT, timeout: 30000, stdio: 'pipe' }); }
    catch (e) { return add('up_to_date', 'WARN', `git fetch gagal (${(e.stderr || e.message).toString().split('\n')[0]}); pakai --no-fetch jika offline`); }
  }
  let counts;
  try { counts = git('rev-list', '--left-right', '--count', `HEAD...origin/${BASE}`).trim().split(/\s+/).map(Number); }
  catch { return add('up_to_date', 'WARN', `origin/${BASE} tidak ditemukan`); }
  const [ahead, behind] = counts;
  const dirty = git('status', '--porcelain').split('\n').filter(l => l && !l.startsWith('??'));
  const problems = [];
  if (branch !== BASE) problems.push(`branch aktif "${branch}", bukan ${BASE}`);
  if (behind > 0) problems.push(`tertinggal ${behind} commit dari origin/${BASE} (belum git pull)`);
  if (ahead > 0) problems.push(`${ahead} commit lokal belum di origin/${BASE}`);
  if (dirty.length) problems.push(`${dirty.length} file tracked berubah (working tree tidak bersih)`);
  if (!problems.length) return add('up_to_date', 'PASS', `${BASE} sama dengan origin/${BASE}, working tree bersih`);
  add('up_to_date', 'FAIL', problems.join('; '));
}

function checkSyntax() {
  const bad = [];
  for (const f of ['server.js', 'stoa.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr || '').split('\n').find(l => /Error/.test(l)) || 'syntax error'}`);
  }
  if (!bad.length) return add('syntax', 'PASS', 'server.js dan stoa.js lolos node --check');
  add('syntax', 'FAIL', bad.join(' | '));
}

function checkDistBundle() {
  const p = path.join(ROOT, 'dist', 'stoa.js');
  let st;
  try { st = fs.statSync(p); } catch { return add('dist_bundle', 'FAIL', 'dist/stoa.js tidak ada (agent auto-update akan tarik source mentah). Server rebuild saat start, tapi jangan restart tanpa bundle siap'); }
  if (st.size === 0) return add('dist_bundle', 'FAIL', 'dist/stoa.js kosong');
  const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  if (r.status !== 0) return add('dist_bundle', 'FAIL', 'dist/stoa.js ada tapi syntax rusak');
  add('dist_bundle', 'PASS', `dist/stoa.js ada (${st.size} bytes, ${st.mtime.toISOString()})`);
}

function checkBundleBuild() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-prerestart-'));
  try {
    // Opsi persis sama dengan build di server.js; outfile di temp, bukan dist/.
    require(path.join(ROOT, 'node_modules', 'esbuild')).buildSync({
      entryPoints: [path.join(ROOT, 'stoa.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      external: ['ws', './claude-session', './codex-session'],
      outfile: path.join(tmp, 'stoa.js'),
      logLevel: 'silent',
    });
    const r = spawnSync(process.execPath, ['--check', path.join(tmp, 'stoa.js')], { encoding: 'utf8' });
    if (r.status !== 0) return add('bundle_build', 'FAIL', 'bundle terbentuk tapi syntax rusak');
    add('bundle_build', 'PASS', 'esbuild bundle agent terbentuk tanpa error (ditulis ke temp, dist/ tidak disentuh)');
  } catch (e) {
    add('bundle_build', 'FAIL', `build gagal: ${String(e.message).split('\n').slice(0, 3).join(' ')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

let pending = [];
function checkMigrations() {
  const dbPath = path.join(ROOT, 'db', 'stoa.db');
  if (!fs.existsSync(dbPath)) return add('migrations', 'WARN', 'db/stoa.db tidak ada di sini; daftar pending tidak bisa dihitung');
  let db;
  try {
    const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations'").get();
    if (hasTable) {
      pending = require(path.join(ROOT, 'lib', 'migrations')).pendingMigrations(db, path.join(ROOT, 'migrations'));
    } else {
      pending = fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort();
    }
    add('migrations', 'PASS', pending.length ? `${pending.length} migration baru akan jalan saat boot` : 'tidak ada migration baru', { pending });
  } catch (e) {
    add('migrations', 'WARN', `gagal baca DB readonly: ${String(e.message).split('\n')[0]}`);
  } finally {
    if (db) db.close();
  }
}

for (const fn of [checkConflictMarkers, checkUnmerged, checkUpToDate, checkSyntax, checkDistBundle, checkBundleBuild, checkMigrations]) {
  try { fn(); } catch (e) { add(fn.name.replace(/^check/, '').toLowerCase(), 'FAIL', `cek error: ${e.message.split('\n')[0]}`); }
}

const failed = checks.filter(c => c.status === 'FAIL');
const result = {
  pass: failed.length === 0,
  summary: failed.length ? `FAIL: ${failed.map(c => c.name).join(', ')}` : 'PASS: aman untuk minta Aan restart',
  checks,
  pendingMigrations: pending,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
