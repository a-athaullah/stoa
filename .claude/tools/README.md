# Development Tools

Mechanical tools untuk task repetitif — **hemat token, langsung pakai**.

## Available Tools

### 🧪 Testing
- **`run-tests.js`** — Run test.js, return pass/fail summary
  ```bash
  node .claude/tools/run-tests.js
  ```
  Output: `{success, total, passed, failed, output}`

  Runs against a throwaway copy of `db/stoa.db`. The copy is stamped with a random token (`stoa_test_marker`), and test.js refuses any `DB_PATH` without that token, so running `test.js` directly can't write to the live DB. From a git worktree, run it the same way: when the worktree has no `db/stoa.db` or `.env`, the runner copies them read-only from the main worktree. Never symlink the live DB or `.env` into a worktree; symlinking `node_modules` is fine.

### 🔍 Inspection
- **`get-rooms.js`** — List all rooms + participants
  ```bash
  node .claude/tools/get-rooms.js [--room-id=N]
  ```
  Output: Array of `{id, name, created_at, model, is_pinned, is_archived, participants[]}`

- **`git-context.js`** — Git status, diff summary, dan recent commits dalam satu call
  ```bash
  node .claude/tools/git-context.js
  ```
  Output: `{branch, status: {modified, added, deleted, clean}, uncommitted: {unstaged, staged}, recentCommits[]}`
  **Use case:** Sebelum commit/PR review — hemat 3-4 bash calls jadi 1 JSON

### 🧹 Cleanup
- **`clean-test-data.js`** — Delete all test data (actors/rooms/messages with `test-` prefix)
  ```bash
  node .claude/tools/clean-test-data.js [--dry-run]
  ```
  Output: `{dryRun, actors, rooms, deleted: {actors, rooms, messages, participants, sessions}}`

- **`cleanup-test-data.js`** — Delete orphaned rooms/actors left by an aborted test run
  ```bash
  node .claude/tools/cleanup-test-data.js [PORT] [--dry-run]
  ```
  Detects by name pattern (room title `__<name>__`, actor `__test<name>` + known legacy names) and deletes via live API (archive → delete). Pakai `--dry-run` dulu.

- **`rotate-logs.js`** — Rotate `logs/stoa.log` + `logs/stoa.err` (copy-truncate, inode tetap) tanpa restart server
  ```bash
  node .claude/tools/rotate-logs.js [--max-mb=10] [--dry-run]
  ```
  Output: `{dir, maxBytes, dryRun, files: [{file, size, rotated}]}`. Dipasang di crontab hourly. **Jangan** rotasi dengan `mv`/rename: launchd tetap menulis ke inode lama dan semua log hilang.

### ✏️ Development Flow
- **`bump-client-version.js`** — Bump CLIENT_VERSION patch di stoa.js (wajib setiap ada perubahan di `public/`)
  ```bash
  node .claude/tools/bump-client-version.js           # patch: 0.4.1 → 0.4.2
  node .claude/tools/bump-client-version.js --minor   # minor: 0.4.1 → 0.5.0
  node .claude/tools/bump-client-version.js --dry-run
  ```
  Output: `{old, new, file, dryRun}`
  **Use case:** Ganti 3 steps (Read stoa.js → cari baris → Edit) jadi 1 command

- **`find-feature.js <keyword>`** — Cari keyword di semua file utama, return potongan relevan saja
  ```bash
  node .claude/tools/find-feature.js platform
  node .claude/tools/find-feature.js "api_keys" --context=5
  node .claude/tools/find-feature.js health --files=server,stoa
  ```
  Output: `{keyword, matches: [{file, line, snippet}]}`
  **Use case:** Orientasi sesi baru — ganti Read file lengkap (ribuan baris) jadi snippet relevan

- **`pre-commit-check.js`** — Validasi sebelum commit: CLIENT_VERSION, migration, docs sync
  ```bash
  node .claude/tools/pre-commit-check.js
  ```
  Output: `{ok, checks: [{name, ok, message}]}`
  **Use case:** Jalankan sebelum `git commit` — cegah lupa bump versi / migration / docs

- **`anti-pattern-check.js`** — Deteksi known bad patterns: getSetting+JSON.parse langsung, inline key extraction, getElementById untuk form-scoped element
  ```bash
  node .claude/tools/anti-pattern-check.js
  ```
  Output: `{ok, violations: [{file, line, pattern, description}]}`
  **Use case:** Jalankan saat audit/PR review untuk verifikasi cleanup tidak regress. Exit code 1 jika ada violation.

### 🔎 Audit & Review
- **`theme-contrast.js`** — Hitung rasio kontras WCAG tiap tema langsung dari token `[data-theme]` di `public/css/base.css` (daftar tema dibaca dari `THEMES` di `public/js/core.js`)
  ```bash
  node .claude/tools/theme-contrast.js            # JSON: {ok, themes, failures, report}
  node .claude/tools/theme-contrast.js --table    # tabel markdown (untuk PR / laporan)
  node .claude/tools/theme-contrast.js --theme=hoth
  ```
  Exit code 1 kalau ada pasangan warna di bawah minimum (4.5:1 teks, 3:1 hint/ikon/UI).
  **Use case:** WAJIB dijalankan setiap ubah nilai token tema atau tambah tema baru — jangan hitung kontras manual.

- **`audit-snapshot.js`** — Kumpul data mentah untuk branch audit (hemat token vs baca file manual)
  ```bash
  node .claude/tools/audit-snapshot.js [--base=master]
  ```
  Output: `{branch, gitStats, schemaDrift, indexCoverage, docsSync, deadFiles}`
  Checks: schema drift (schema.sqlite.sql vs migrations), FK index coverage, docs 5-lang sync, unreferenced root files

- **`query-plan-audit.js`** — `EXPLAIN QUERY PLAN` untuk semua SQL `db.prepare()` di `server.js` + `lib/*.js`, dijalankan di salinan DB live (VACUUM INTO ke tmp, file live tidak disentuh)
  ```bash
  node .claude/tools/query-plan-audit.js [--db=db/stoa.db] [--all] [--min-rows=N]
  ```
  Output: `{tables, summary, flagged[], unparsed[], unindexedFKs[]}` — `flagged` = query dengan `SCAN` tanpa index atau `USE TEMP B-TREE`, diurutkan dari tabel terbesar; `unparsed` = SQL dinamis yang perlu dicek manual; `unindexedFKs` = kolom FK anak tanpa index (parent DELETE akan scan tabel anak).
  **Use case:** WAJIB saat menambah/mengubah query di tabel besar (`messages`, `message_embeddings`, `usage_log`) atau menambah FK baru.

- **`pr-summary.js`** — Kumpul data PR untuk review (commits, files changed, categories)
  ```bash
  node .claude/tools/pr-summary.js [--base=master]
  ```
  Output: `{branch, commits, summary, filesChanged[], auditFile}`
  Categories: backend, frontend, migration, schema, docs, test, tooling

- **`review-diff.js`** — Serve PR diff per-kategori untuk mencegah context overflow
  ```bash
  node .claude/tools/review-diff.js                     # stats summary saja (orientasi awal)
  node .claude/tools/review-diff.js --category=backend  # diff backend files saja
  node .claude/tools/review-diff.js --category=frontend
  node .claude/tools/review-diff.js --category=test
  node .claude/tools/review-diff.js --category=docs
  node .claude/tools/review-diff.js --category=migration
  node .claude/tools/review-diff.js --category=schema
  ```
  Output stats: `{summary, totalFiles, categories: {backend: {files, fileList}, ...}}`
  Output diff: plain text diff untuk files di kategori itu saja
  **WHY:** Full PR diff bisa 700KB+ — loading sekaligus akan memenuhi context window. Tool ini serve ~50-80KB per kategori. **WAJIB dipakai saat PR besar (>20 files changed).**

---

## Cara pakai saat audit/PR review

```bash
# Step 1: Orientasi — stats saja, tidak ada diff content
node .claude/tools/audit-snapshot.js --base=master    # schema, docs, index check
node .claude/tools/review-diff.js --base=master       # kategori + file list, NO diff

# Step 2: Review per kategori — satu call per section
node .claude/tools/review-diff.js --category=migration --base=master
node .claude/tools/review-diff.js --category=schema --base=master
node .claude/tools/review-diff.js --category=backend --base=master
node .claude/tools/review-diff.js --category=frontend --base=master
node .claude/tools/review-diff.js --category=test --base=master
node .claude/tools/review-diff.js --category=docs --base=master

# Step 3: Run tests
node .claude/tools/run-tests.js
```
