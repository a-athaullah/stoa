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

- [x] **#4 R12 — Schedule doctor** _(S)_ — ✓ implemented: endpoint `GET /api/rooms/:id/sub-agent-schedules/doctor`, badge UI di room settings, 6 test cases (overdue, error, unlinked, auth, 404, empty).
- [x] **#5 R17 — Message dedup via event_id** _(S–M)_ — ✓ PR #68: `client_event_id` UUID per pesan + `UNIQUE(room_id, client_event_id)`; duplikat saat WS reconnect → return existing, bukan row baru.
- [x] **#6 R14 — Compact hardening preventif** _(S–M)_ — ✓ implemented: `compact_failure_cooldown_until` + `compact_failure_error` di `ai_sessions`; MAX semantics; cooldown check di auto-compact + compact_session; clear on success.
- [x] **#7 R13 — Status sub-agent jujur** _(M)_ — ✓ implemented: `FAILURE_EXIT_REASONS` konstanta bersama; `cleanErrorText()`; `exit_reason` causes `state=error` even with content.
- [x] **#8 R15 — `indeterminate` + `process_generation`** _(M)_ — ✓ implemented: `process_generation` column di `ai_sessions`; `indeterminate` status; boot recovery pass.
- [x] **#9 R16 — Audit teardown scope** _(S)_ — ✓ implemented: sub-agent sessionKey distinct dari parent sessionKey; teardown path diaudit.

## Batch 3 — Murah & langsung terasa `[exec 10–13]`

- [x] **#10 R23 — Audit mirror setting + silent catch** _(S)_ — ✓ PR #84: push on-change + on-connect; server whitelist eksplisit; silent catch diaudit.
- [x] **#11 R22 — Status line verb tool + long-run charms** _(S)_ — ✓ PR #84: tool→verb map; preview arg; elapsed progress tiap 10 detik.
- [x] **#12 R24 — Higiene upload/attachment** _(S–M)_ — ✓ PR #85: MIME first; neutral failure marker; path di note; "extract yourself" wording.
- [x] **#13 R18 — GC nebeng scheduler tick** _(M)_ — ✓ PR #85: throttled ~6 jam; fail-safe-to-preserve; `auditUploads()` dry-run exported.

## Batch 4 — Fitur baru `[exec 14–19]`

- [x] **#14 R28 — `busy_input_mode`: interrupt/queue/steer** _(M–L)_ — ✓ PR #87: `queue` = antre dengan UI sliding window, `steer` = suntik ke run berjalan; jawaban arsitektural untuk SIGTERM-restart yang membunuh kerja in-flight agent (insiden 2026-09-01).
- [x] **#15 R26 — Stoa Doctor + session tooling** _(M)_ — ✓ PR #89+#90 (v0.27.0): `/api/health/db` (size via `page_count*page_size`, WAL, freelist, counts, checks + fix instructions); `ai_sessions.pinned` (kebal auto-archive); import JSONL Claude Code transcript; Doctor tab UI.
- [x] **#16 R27 — Sidebar recency grouping** _(S–M)_ — ✓ PR #91 (v0.28.0): `groupRooms()` pure function, Today/Yesterday/This week/Older buckets, collapsible groups.
- [x] **#17 R25 — Memory per-room/agent** _(M–L)_ — ✓ PR #92 (v0.28.1): file markdown editable di UI, frozen snapshot per session start, budget char, pending writes approval. Fix double sub-agent trigger (`completed_at IS NOT NULL` discriminator).
- [ ] **#18 R29 — Display verbosity berlapis** _(M)_ — resolusi per-room → global → default; `tool_progress all/new/off`; `cleanup_progress` (run gagal = simpan breadcrumb); `live_status full/verb/off`.
- [ ] **#19 R30 — Debug share bundle** _(M)_ — tombol "kirim diagnostik": snapshot log sekali baca, force-redact (abaikan preferensi user untuk artefak share), consent eksplisit, envelope berversi, auto-delete.

## Bug — Ara bubble stuck (tidak ada processing)

- [x] **Bug — Ara bubble muncul tapi tidak ada processing** — ✓ PR #76 (v0.20.1): root cause race condition di `triggerAiResponse` — agent disconnect antara initial online check dan actual send → function return tanpa throw → `drainWake` hapus pending_wake, bubble stuck streaming. Fix: throw on mid-trigger disconnect + drain pending wakes on agent reconnect.

## Batch 5 — Carry-over `[exec 20–21]`

- [ ] **#20 Webhook/API** — HTTP endpoint untuk trigger agent dari external (CI/CD, monitoring, script). Masih relevan; belum ada endpoint trigger generik (baru automation Slack + proactive message agent-auth). Naikkan kalau muncul use case CI/CD konkret.
- [x] **#21 Context window indicator** — ✓ PR #93 (v0.28.2): thin bar di bawah compact bar, expand on hover, oklch color gradient (hijau→kuning→orange→merah), per-agent tooltip, reset on compact. Migration `context_tokens_used` di `ai_sessions`, `GET /api/rooms/:id/context` endpoint, WebSocket `context_update` broadcast.

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
