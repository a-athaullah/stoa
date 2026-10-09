# Stoa — Project Instructions

## Prinsip Pengembangan (berlaku untuk SEMUA perubahan kode)

Target utama: **0 finding saat PR-review & audit.** Kode yang benar sejak awal jauh lebih murah daripada ronde review berulang — setiap ronde audit/review yang terhindar = hemat token & waktu kita bertiga.

1. **Tools-first, ALWAYS.** WAJIB cek `.claude/tools/README.md` SEBELUM reasoning/analisis apapun. Jika ada tool yang match → langsung pakai, JANGAN reasoning ulang (hemat usage = kita bisa kerjakan lebih banyak hal). Tools untuk yang repetitif & mekanis — kita bertiga (Kira, Ara, Idris) adalah expert, biarkan hal remeh dikerjakan tools, kita fokus ke yang butuh keahlian.
2. **Security-first.** Setiap kode baru wajib memperhatikan keamanan: validasi input, cek ownership/authorization, cegah path traversal, query selalu parameterized (no SQL injection), jangan bocorkan secret. Tanya "bagaimana ini bisa disalahgunakan?" sebelum selesai.
3. **Zero regression.** Jangan bikin bug baru. Periksa dampak ke flow existing sebelum commit. Hormati design decision yang sudah dicatat di file audit (`~/project/stoa-audit/`) — jangan ubah tanpa alasan kuat & tertulis.
4. **Tulis seolah reviewer ketat sedang melihat.** Antisipasi 8 kategori audit (Dead Code, Security, Test Coverage, API Contract, Error Handling, Schema Drift, Performance, Docs Sync). Lengkapi test & docs (5 bahasa) dalam commit yang sama — bukan belakangan.

## Server

Server jalan lokal di Mac ini pada port **3001** (`PORT=3001` di `.env`). Untuk test: `node test.js 3001` atau set `PORT=3001`.

**Runtime:** Stoa server dijalankan via **launchd** (bukan PM2).
- Plist: `~/Library/LaunchAgents/com.stoa.server.plist`
- Log stdout: `~/project/Stoa/logs/stoa.log`
- Log stderr: `~/project/Stoa/logs/stoa.err`
- PM2 hanya digunakan untuk **menjalankan agent** (Claude Code processes), bukan server Stoa.

Saat debug server log, selalu cek `logs/stoa.log` — **jangan** cek PM2 logs untuk server.

## Auto-Commit

Setelah menyelesaikan satu unit perubahan logis (bugfix, fitur, refactor, update docs), langsung commit dengan pesan deskriptif. Jangan tunggu semua task selesai — commit per logical change agar changelog akurat.

Format: `deskripsi singkat perubahan` (lowercase, tanpa prefix type).

## Branch Protection

**WAJIB:** Semua perubahan kode harus melalui branch + PR, tidak boleh commit langsung ke `master`.

**Flow yang benar:**
1. Buat branch (`bug/...`, `feature/...`, `improvement/...`)
2. Commit perubahan di branch
3. Push branch
4. Create PR via `gh pr create`
5. Review (technical approval oleh reviewer)
6. Merge decision by Aan

**Exception:** Emergency hotfix yang tidak bisa tunggu review — harus documented di commit message kenapa bypass process, dan post-merge review tetap dilakukan.

**Kalau ketelanjur commit langsung ke master:**
1. **Jangan panic** — commit sudah masuk, tapi belum push
2. **Belum push:** Reset soft (`git reset --soft HEAD~1`), buat branch, commit ulang, buat PR
3. **Sudah push:** Biarkan di master, lakukan post-merge review immediately, catat di commit message berikutnya bahwa ini bypass (dengan alasan)
4. **Inform team** — notify di room Stoa bahwa ada direct commit ke master + share commit hash untuk review

**Rationale:**
- Prevent accidental direct commit ke master
- Ensure review coverage (even post-merge untuk emergency)
- Git history lebih clean (setiap PR = satu logical unit)
- Easy to revert kalau ada issue (revert PR, bukan hunting commits)

## Model

Default: Sonnet. Cukup untuk sebagian besar task development Stoa.
Untuk task yang sangat kompleks (desain arsitektur besar, debugging race condition, perubahan multi-sistem yang saling berpengaruh) — rekomendasikan ke Aan untuk switch ke Opus di sesi tersebut.

## Development Tools

**SEBELUM** reasoning untuk task repetitif, **WAJIB cek `.claude/tools/` dulu.**

Jika ada tool yang match → **langsung pakai**, jangan reasoning ulang (hemat token).

📋 **Tools inventory:** `.claude/tools/README.md`

### Mandatory tool usage (JANGAN skip):

| Situasi | Tool |
|---------|------|
| Sebelum commit apapun | `node .claude/tools/git-context.js` (ganti 3-4 bash calls) |
| Ada perubahan di `public/` | `node .claude/tools/bump-client-version.js` (jangan edit manual) |
| Mau orientasi / cari kode | `node .claude/tools/find-feature.js <keyword>` (jangan Read file penuh) |
| Sebelum `git commit` | `node .claude/tools/pre-commit-check.js` (validasi CLIENT_VERSION + migration + docs) |
| Mau cek rooms/agents | `node .claude/tools/get-rooms.js` |
| Mau run tests | `node .claude/tools/run-tests.js` |
| Sebelum PR/audit | `node .claude/tools/audit-snapshot.js` + `pr-summary.js` |
| PR diff besar (>20 files) | `node .claude/tools/review-diff.js` per kategori — **JANGAN git diff sekaligus** |

**Flow saat menemukan task repetitif baru:**
1. Bikin script di `.claude/tools/xxx.js` (Node.js, return JSON)
2. Update `.claude/tools/README.md`
3. Commit (auto-commit per aturan)

## Project Knowledge

**SEBELUM** re-discover architecture/patterns, **WAJIB cek `.claude/knowledge/` dulu.**

📚 **Knowledge base:**
- `.claude/knowledge/architecture.md` — System design, flows, components
- `.claude/knowledge/database-schema.md` — Tables, relationships, migration patterns
- `.claude/knowledge/api-patterns.md` — Auth, routes, WebSocket protocol
- `.claude/knowledge/frontend-structure.md` — UI components, state management
- `.claude/knowledge/known-issues.md` — Design decisions, gotchas, workarounds

**Hemat reasoning & token** — baca knowledge base sebelum analisis ulang.

## Database Migration

**Setiap perubahan schema wajib dibuat migration script** — jangan langsung edit `db/schema.sqlite.sql`.

**Flow:**
1. Buat `migrations/YYYYMMDD-deskripsi.sql`
2. Migration auto-run saat server startup (tracked di table `migrations`)
3. Migration harus **transactional** dan **zero data loss**
4. Update `db/schema.sqlite.sql` untuk fresh clone

User tinggal `git pull` → restart server → migration auto-run. Format: `YYYYMMDD-deskripsi.sql`, isi plain SQL.

## Docs Sync — Wajib 5 Bahasa Sekaligus

File `docs/guide-usage.*.md` tersedia dalam **5 bahasa (EN, ID, JA, KO, ZH)** dan harus selalu sinkron.

**Aturan:** Jika ada perubahan konten di salah satu bahasa, **semua 5 file harus diupdate sekaligus** dalam satu commit.

- Pre-commit hook sudah dipasang di `.githooks/pre-commit` — akan memblokir commit jika hanya sebagian bahasa yang diupdate.
- Untuk bypass (darurat): `SKIP_DOCS_SYNC=1 git commit ...`

**Default flow saat mengubah docs:**
1. Update EN dulu (referensi utama)
2. Port ke ID (Bahasa Indonesia)
3. Port ke JA, KO, ZH
4. Commit semua 5 file sekaligus

## DILARANG: Restart Server Stoa

**Jangan pernah restart server Stoa** — tidak dari agent, tidak dari CLI, tidak dari script apapun.

Jika ada situasi yang membutuhkan restart (misalnya setelah update platform files), **minta Aan untuk melakukannya.**

Alasan: restart server memutus semua koneksi agent yang sedang aktif dan bisa menginterupsi sesi user.

## Direktori Project (di luar Git Repo)

Untuk menjaga working tree Stoa tetap bersih, semua file pendukung disimpan di luar repo:

| Direktori | Isi |
|-----------|-----|
| `~/project/stoa-handover/` | Handover files untuk claude.ai/design |
| `~/project/stoa-feature/` | Feature planning documents |
| `~/project/stoa-audit/` | PR audit trail files |

**Jangan simpan file-file ini di dalam `~/project/Stoa/`.**

## PR Review — Context-Safe Flow

**PENTING:** PR besar bisa punya 700KB+ diff. Jangan dump `git diff` sekaligus — akan memenuhi context window dan menyebabkan sesi terputus.

**Flow yang benar:**

```bash
# Step 1: Orientasi — stats saja, tidak ada diff content
node .claude/tools/audit-snapshot.js --base=master    # schema, docs, index check
node .claude/tools/review-diff.js --base=master       # kategori + file list, NO diff

# Step 2: Review per kategori — satu call per review section
node .claude/tools/review-diff.js --category=migration --base=master   # kecil, mulai sini
node .claude/tools/review-diff.js --category=schema --base=master
node .claude/tools/review-diff.js --category=backend --base=master     # ~70KB
node .claude/tools/review-diff.js --category=frontend --base=master    # ~60KB
node .claude/tools/review-diff.js --category=test --base=master
node .claude/tools/review-diff.js --category=docs --base=master

# Step 3: Run tests
node test.js 3001
```

**Jangan pernah:** `git diff master..HEAD` tanpa filter — hasilnya bisa 700KB+.

---

## Audit & Test — Known Exclusions

Jangan flag ulang item ini saat audit atau review. Sudah dicatat sebagai design decision.

### Test Coverage

| Endpoint | Alasan skip |
|----------|-------------|
| `POST /api/automations/slack/connect` (success case) | Butuh token Slack valid. Error case sudah di-test. |
| `GET /api/workspace/file` | Butuh room dengan workdir aktif dan file nyata di agent machine. |
| `POST /api/automations/connections/test-email` (success case) | Butuh akun email + app password valid. Error case sudah di-test. |
| Email IMAP connection (success case) | Butuh akun Gmail + app password valid. Error/validation case sudah di-test. |

### Audit / Schema Checks

| File | Finding | Alasan exclude |
|------|---------|----------------|
| `migrations/20260609-automation-connections.sql` | `CHECK(provider IN ('slack','discord'))` — discord ada di constraint | Migration immutable. File ini sudah applied ke prod saat fitur dibuat dengan discord support. Schema baseline sudah diupdate ke `CHECK(provider IN ('slack'))` — server hanya allow 'slack'. No runtime impact. |

## Sub-Agent Orchestration — Aturan Wajib

**JANGAN mention sub-agent kecuali ingin mereka mengerjakan sesuatu.** Menulis `@BE-Stoa` atau `@FE-Stoa` di pesan room akan men-trigger mereka — jangan sebut nama mereka dalam konteks diskusi/laporan biasa.

**WAJIB trigger sub-agent lewat @mention di room, BUKAN curl API langsung.** Cara benar: tulis `@BE-Stoa [task]` di pesan room ini. Jangan pakai curl sub-agent-trigger kecuali sistem/tool yang melakukannya, bukan Ara sendiri.

**JANGAN double-trigger.** Pilih SATU jalur saja — kalau pakai curl proactive message dengan @mention di body, jangan juga tulis @mention yang sama di text response. Keduanya akan trigger dan menyebabkan sub-agent jalan duplikat.

**Paralel, bukan sequential.** Kalau ada dua task independen untuk BE-Stoa dan FE-Stoa, mention keduanya dalam SATU pesan. Jangan tunggu satu selesai baru mention yang lain — itu membuang keuntungan paralel.

**TechWriter-Stoa** — gunakan untuk update dokumentasi `docs/guide-usage.*.md` (5 bahasa sekaligus). Trigger via @mention dengan task yang jelas: perubahan apa, behavior lama vs baru, dan bagian mana yang perlu diupdate. TechWriter akan cari bagian relevan, update semua 5 bahasa, dan commit langsung ke master (docs-only update). Jangan update docs manual kalau bisa delegate ke TechWriter — lebih konsisten dan hemat context.

**Loop sampai 0 finding.** Setelah TechLead review selesai, kalau masih ada finding (termasuk INFO):
1. Delegate fix ke BE-Stoa dan/atau FE-Stoa (paralel kalau bisa)
2. Setelah fix selesai, trigger TechLead lagi
3. Ulangi loop sampai TechLead konfirmasi **0 finding di semua severity**
Jangan lapor ke Aan sebelum loop selesai.

## Merge PR — Flow Eksplisit

**PENTING — Merge Decision Authority:**
- **Keputusan merge FINAL ada di Aan.** Developer/reviewer (Kira, Ara, Idris) hanya memberikan technical recommendation.
- Review approval (code quality OK) ≠ merge authorization (go/no-go decision).
- Flow: Developer develop → Reviewer approve/request changes → **Aan decide** merge/hold/reject.
- Jangan berikan "lampu hijau" atau instruksi merge kepada developer tanpa explicit approval dari Aan.

**Saat diminta merge branch**, ikuti langkah berikut (tidak ada hook otomatis — semua eksplisit):

```bash
# 1. Pastikan di branch yang mau di-merge, semua bersih
git checkout feature/nama-branch

# 2. Version bump (sesuai jenis perubahan)
npm version patch   # bug fix, migration, tweak
npm version minor   # fitur baru
npm version major   # breaking change

# 3. Push branch (termasuk version bump commit)
git push

# 4. Squash & merge via GitHub
gh pr merge --squash --delete-branch
```

**Aturan bump:**
- `patch` — bug fix, migration data, config tweak, docs update
- `minor` — fitur baru (tambah endpoint, tambah UI component, tambah integrasi)
- `major` — breaking change (hapus API, ubah schema yang tidak backward-compatible)

**Setelah merge:** `git checkout master && git pull` untuk sync lokal.
