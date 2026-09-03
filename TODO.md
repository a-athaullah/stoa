# Stoa — Todo

_Audit terakhir: 2026-09-02 (Ara) — planning detail R12–R18 di `~/project/stoa-feature/hermes-adoption-plan.md`; detail R19–R30 di `~/project/stoa-feature/hermes-agent-research.md` section 7._

_Urutan eksekusi ditetapkan 2026-09-01 (Ara, approved Aan). Logika: security & bug produksi → hardening bug-class terbukti → quick wins UX → fitur baru → carry-over._

## Batch 0 — Bug sub-agent orchestration `[top priority]`

- [x] **#0 Bug — Mention wakeup orchestrator tidak berfungsi** _(S)_ — ✓ `3a6b928`: root cause: kondisi `enqueueParentWake` mensyaratkan `parent_message_id` non-null, yang hanya di-set oleh `/sub-agent-trigger`. Sub-agent via `@mention cascade` tidak punya `parent_message_id` → orchestrator tidak pernah di-wake. Fix: hapus syarat `&& doneRow.parent_message_id` — semua sub-agent completion wake parent. 329/329 tests pass. Dicatat 2026-09-02.

## Batch 1 — Kritis: bug produksi & security `[exec 1–3]` ✓ SELESAI

- [x] **#1 R20 — Audit ReDoS regex** _(S)_ — ✓ `3a54d68`: safeRegexTest() rejects nested quantifiers; fixes automation matches_regex + writeEnv escaping; benchmark 30k char = 0ms.
- [x] **#2 R19 — Thinking-signature management lengkap** _(S–M)_ — ✓ PR #64 (v0.17.x): 3-layer defense — strip unsigned thinking, per-endpoint preventif, one-shot recovery di wire copy.
- [x] **#3 R21 — Transcript sanitizer + escalation** _(M)_ — ✓ PR #65 (v0.17.x): heal pre-send (orphan drop, stub, dedupe, placeholder), WARNING→ERROR threshold, notice via status channel.

## Batch 2 — Hardening bug-class terbukti `[exec 4–9]`

- [ ] **#4 R12 — Schedule doctor** _(S)_ — health check read-only untuk scheduled triggers: deteksi silent non-firing (`next_run_at` overdue > 15 menit), last_error, sub-agent unlinked. Endpoint `GET /api/rooms/:id/sub-agent-schedules/doctor` + badge di room settings.
- [ ] **#5 R17 — Message dedup via event_id** _(S–M)_ — `client_event_id` UUID per pesan + `UNIQUE(room_id, client_event_id)`; duplikat saat WS reconnect → return existing, bukan row baru.
- [ ] **#6 R14 — Compact hardening preventif** _(S–M)_ — durable cooldown `MAX(existing,new)` di ai_sessions + progress-aware timeout untuk compaction. Bug `compact_stuck` belum solved; cooldown mencegah loop gagal-berulang.
- [ ] **#7 R13 — Status sub-agent jujur** _(M)_ — flag failure eksplisit menang atas presence output; pisah `status` vs `exit_reason`; konstanta `FAILURE_STATUSES` dishare semua permukaan; failure tampil satu-baris di bubble.
- [ ] **#8 R15 — `indeterminate` + `process_generation`** _(M)_ — cap UUID per boot ke kerja in-flight; saat boot, running milik generation lama → indeterminate (bukan requeue, bukan stuck).
- [ ] **#9 R16 — Audit teardown scope** _(S)_ — audit semua teardown path: `releaseOwnResources()` vs `closeSession()`; peserta yang "ikut pakai" resource session-scoped tidak boleh men-cleanup-nya.

## Batch 3 — Murah & langsung terasa `[exec 10–13]`

- [ ] **#10 R23 — Audit mirror setting + silent catch** _(S)_ — setting UI yang dibaca server: push on-change DAN on-connect (hanya key yang pernah disentuh user); server whitelist key eksplisit dengan error terlihat; audit semua `.catch(() => {})` di `public/`.
- [ ] **#11 R22 — Status line verb tool + long-run charms** _(S)_ — "Agent bekerja…" → "membaca src/server.js…" (peta tool→verb, preview arg baris pertama, cap ~50 char, revert saat tool selesai); tool >8 detik → baris progres "(tool · elapsed)" tiap 10 detik, maks 2×. Mode `full/verb/off` untuk privasi.
- [ ] **#12 R24 — Higiene upload/attachment** _(S–M)_ — MIME per-attachment first; marker kegagalan netral untuk agent (diagnostik ke log, jangan racuni history); selalu sertakan path file di note; sukses-tapi-kosong = sentinel tersendiri; wording note "extract yourself", bukan "ask the user".
- [ ] **#13 R18 — GC nebeng scheduler tick** _(M)_ — maintenance throttled ~6 jam di ticker existing; fail-safe-to-preserve; split `auditX()` dry-run vs `reclaimX()`.

## Batch 4 — Fitur baru `[exec 14–19]`

- [ ] **#14 R28 — `busy_input_mode`: interrupt/queue/steer** _(M–L)_ — jawaban arsitektural untuk SIGTERM-restart yang membunuh kerja in-flight agent (insiden 2026-09-01); `queue` = antre dengan UI sliding window, `steer` = suntik ke run berjalan.
- [ ] **#15 R26 — Stoa Doctor + session tooling** _(M)_ — `/api/health/db` (pure function: size via `page_count*page_size`, WAL, freelist, counts); tiap check gagal bawa instruksi fix; `pinned` di sessions (kebal auto-archive); **import sesi dari JSONL Claude Code**.
- [ ] **#16 R27 — Sidebar recency grouping** _(S–M)_ — head-run adaptif (potong di jeda ≥30 menit, fuzzy-merge bucket) + collapsible groups; pure function, portable 1:1.
- [ ] **#17 R25 — Memory per-room/agent** _(M–L)_ — file markdown editable di UI, frozen snapshot per session start (jaga prompt cache), budget char, drift detection + backup, staged approval untuk tulisan background.
- [ ] **#18 R29 — Display verbosity berlapis** _(M)_ — resolusi per-room → global → default; `tool_progress all/new/off`; `cleanup_progress` (run gagal = simpan breadcrumb); `live_status full/verb/off`.
- [ ] **#19 R30 — Debug share bundle** _(M)_ — tombol "kirim diagnostik": snapshot log sekali baca, force-redact (abaikan preferensi user untuk artefak share), consent eksplisit, envelope berversi, auto-delete.

## Bug — Ara bubble stuck (tidak ada processing)

- [ ] **Bug — Ara bubble muncul tapi tidak ada processing** — terjadi beberapa kali 2026-09-02. Pola: Ara di-wake via @mention dari sub-agent (bukan pesan user langsung), bubble muncul di UI tapi tidak ada response/processing sama sekali. Diduga: issue di wake mechanism saat Ara adalah orchestrator yang di-mention oleh sub-agent-nya sendiri. Perlu cek: (1) apakah `enqueueParentWake` untuk Ara sendiri berjalan; (2) apakah ada race condition antara sub-agent selesai dan Ara diinisiasi; (3) log `stoa.err` saat kejadian. Catat 2026-09-02.

## Batch 5 — Carry-over `[exec 20–21]`

- [ ] **#20 Webhook/API** — HTTP endpoint untuk trigger agent dari external (CI/CD, monitoring, script). Masih relevan; belum ada endpoint trigger generik (baru automation Slack + proactive message agent-auth). Naikkan kalau muncul use case CI/CD konkret.
- [ ] **#21 Context window indicator** — indikator visual saat conversation mendekati batas context. Sebagian tertutup oleh configurable auto-compact threshold (Settings); R14+R29 mengecilkan kebutuhannya lagi.

## Done (audit 2026-09-02)

- [x] **Agent config via UI** — sudah ada: `public/js/settings/agents-add.js` + install-script generation (bash/PowerShell) di server.
- [x] **Multi-model support** — arah berubah dari "adapter per vendor" ke **AI Platforms**: custom platform (base_url + API keys, vendor generic/ollama), Ollama Cloud proxy, model discovery, switch model per room. OpenAI-compatible & LiteLLM tertutup lewat custom platform base_url.
- [x] **Scheduled triggers + schedule UI** — PR #58/#59 (v0.17.x).
- [x] **Mention-based sub-agent orchestration** — PR #66 (v0.17.8): @mention trigger, sub-agent system prompts, BE-Stoa/FE-Stoa/TechWriter-Stoa/TechLead-Stoa agents.
- [x] **Parallel sub-agent dispatch** — PR #67 (pending merge): sub-agent @mentions fire concurrently, regular AI agents tetap sequential; `mentionBoundary` regex module-level.

## Trash

- **Gemini model detection** (dibuang 2026-09-01, approved Aan) — tidak ada kode Gemini di codebase; arah multi-model sudah pivot ke AI Platforms. Kalau mau Gemini nanti, jalurnya via platform endpoint OpenAI-compatible.

- **Semantic search** — FTS5 keyword search sudah cukup, AI embeddings overkill
- **Role/permission system** — personal tool, premature tanpa multi-tenant use case
- **Read receipts** — human + multiple AI, konsep "read" tidak relevan
- **Plugin/extension system** — agent sendiri sudah jadi "plugin", premature tanpa use case konkret
- **Native mobile app** — PWA sudah cukup untuk sekarang
