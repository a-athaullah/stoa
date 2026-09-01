# Stoa — Todo

_Audit terakhir: 2026-09-01 (Ara) — planning detail R12–R18 di `~/project/stoa-feature/hermes-adoption-plan.md`; detail R19–R30 di `~/project/stoa-feature/hermes-agent-research.md` section 7._

## Priority 0 — Hermes Adoption ronde 3: kritis (R19–R21)

- [ ] **R19 — Thinking-signature management lengkap** — sempurnakan fix `42f0bbc`: (1) preventif per-endpoint — Anthropic: thinking block hanya di assistant message terakhir; proxy/third-party (AI Platforms): strip SEMUA thinking + strip `cache_control`; (2) klasifikasi 400 by frasa error, jangan gate by provider; (3) recovery one-shot hanya di wire copy — JANGAN mutasi canonical store/DB. _Effort S–M — fix bug produksi existing._
- [ ] **R20 — Audit ReDoS regex** — audit regex redaction/parsing di server.js + stoa.js untuk pattern backtrackable; benchmark input adversarial 30k char. Node single-threaded → satu regex kuadratik memblok seluruh server. _Effort S._
- [ ] **R21 — Transcript sanitizer + escalation** — heal pre-send di wire copy (orphan tool_result drop, tool_call tanpa result → stub, dedupe id, empty turn → placeholder); WARNING → ERROR di threshold → notice satu-kali per session via status channel (tidak masuk transcript). _Effort M._

## Priority 1 — Hermes Adoption (R12–R18)

- [ ] **R12 — Schedule doctor** — health check read-only untuk scheduled triggers: deteksi silent non-firing (`next_run_at` overdue > 15 menit), last_error, sub-agent unlinked. Endpoint `GET /api/rooms/:id/sub-agent-schedules/doctor` + badge di room settings. _Effort S — paling timely, schedule UI baru ship._
- [ ] **R17 — Message dedup via event_id** — `client_event_id` UUID per pesan + `UNIQUE(room_id, client_event_id)`; duplikat saat WS reconnect → return existing, bukan row baru. _Effort S–M._
- [ ] **R13 — Status sub-agent jujur** — flag failure eksplisit menang atas presence output; pisah `status` vs `exit_reason`; konstanta `FAILURE_STATUSES` dishare semua permukaan; failure tampil satu-baris di bubble. _Effort M._
- [ ] **R15 — `indeterminate` + `process_generation`** — cap UUID per boot ke kerja in-flight; saat boot, running milik generation lama → indeterminate (bukan requeue, bukan stuck). _Effort M._
- [ ] **R14 (preventif) — Compact hardening** — durable cooldown `MAX(existing,new)` di ai_sessions + progress-aware timeout untuk compaction. Playbook diagnosis lengkap ada di plan doc, dipakai saat compact-stuck muncul lagi. _Effort S–M._
- [ ] **R16 — Audit teardown scope** — audit semua teardown path: `releaseOwnResources()` vs `closeSession()`; peserta yang "ikut pakai" resource session-scoped tidak boleh men-cleanup-nya. _Effort S + fix._
- [ ] **R18 — GC nebeng scheduler tick** — maintenance throttled ~6 jam di ticker existing; fail-safe-to-preserve; split `auditX()` dry-run vs `reclaimX()`. _Effort M._

## Priority 2 — Hermes Adoption ronde 3: murah & terasa (R22–R24)

- [ ] **R22 — Status line verb tool + long-run charms** — "Agent bekerja…" → "membaca src/server.js…" (peta tool→verb, preview arg baris pertama, cap ~50 char, revert saat tool selesai); tool >8 detik → baris progres "(tool · elapsed)" tiap 10 detik, maks 2×. Mode `full/verb/off` untuk privasi. _Effort S._
- [ ] **R23 — Audit mirror setting + silent catch** — setting UI yang dibaca server: push on-change DAN on-connect (hanya key yang pernah disentuh user); server whitelist key eksplisit dengan error terlihat; audit semua `.catch(() => {})` di `public/`. _Effort S._
- [ ] **R24 — Higiene upload/attachment** — MIME per-attachment first; marker kegagalan netral untuk agent (diagnostik ke log, jangan racuni history); selalu sertakan path file di note; sukses-tapi-kosong = sentinel tersendiri; wording note "extract yourself", bukan "ask the user". _Effort S–M._

## Priority 3 — Hermes Adoption ronde 3: fitur baru (R25–R30)

- [ ] **R25 — Memory per-room/agent** — file markdown editable di UI, frozen snapshot per session start (jaga prompt cache), budget char, drift detection + backup, staged approval untuk tulisan background. _Effort M–L._
- [ ] **R26 — Stoa Doctor + session tooling** — `/api/health/db` (pure function: size via `page_count*page_size`, WAL, freelist, counts); tiap check gagal bawa instruksi fix; `pinned` di sessions (kebal auto-archive); **import sesi dari JSONL Claude Code**. _Effort M._
- [ ] **R27 — Sidebar recency grouping** — head-run adaptif (potong di jeda ≥30 menit, fuzzy-merge bucket) + collapsible groups; pure function, portable 1:1. _Effort S–M._
- [ ] **R28 — `busy_input_mode`: interrupt/queue/steer** — jawaban arsitektural untuk SIGTERM-restart yang membunuh kerja in-flight agent (insiden 2026-09-01); `queue` = antre dengan UI sliding window, `steer` = suntik ke run berjalan. _Effort M–L._
- [ ] **R29 — Display verbosity berlapis** — resolusi per-room → global → default; `tool_progress all/new/off`; `cleanup_progress` (run gagal = simpan breadcrumb); `live_status full/verb/off`. _Effort M._
- [ ] **R30 — Debug share bundle** — tombol "kirim diagnostik": snapshot log sekali baca, force-redact (abaikan preferensi user untuk artefak share), consent eksplisit, envelope berversi, auto-delete. _Effort M._

## Priority 4 — High Impact (carry-over)

- [ ] **Webhook/API** — HTTP endpoint untuk trigger agent dari external (CI/CD, monitoring, script). Masih relevan; belum ada endpoint trigger generik (baru automation Slack + proactive message agent-auth).

## Priority 5 — Enhancement (carry-over)

- [ ] **Context window indicator** — indikator visual saat conversation mendekati batas context. Sebagian tertutup oleh configurable auto-compact threshold (Settings); indikator per-room belum ada. Nice-to-have, nyambung dengan R14.

## Done (audit 2026-09-01)

- [x] **Agent config via UI** — sudah ada: `public/js/settings/agents-add.js` + install-script generation (bash/PowerShell) di server.
- [x] **Multi-model support** — arah berubah dari "adapter per vendor" ke **AI Platforms**: custom platform (base_url + API keys, vendor generic/ollama), Ollama Cloud proxy, model discovery, switch model per room. OpenAI-compatible & LiteLLM tertutup lewat custom platform base_url.
- [x] **Scheduled triggers + schedule UI** — PR #58/#59 (v0.17.x).

## Trash

- **Gemini model detection** (dibuang 2026-09-01, approved Aan) — tidak ada kode Gemini di codebase; arah multi-model sudah pivot ke AI Platforms. Kalau mau Gemini nanti, jalurnya via platform endpoint OpenAI-compatible.

- **Semantic search** — FTS5 keyword search sudah cukup, AI embeddings overkill
- **Role/permission system** — personal tool, premature tanpa multi-tenant use case
- **Read receipts** — human + multiple AI, konsep "read" tidak relevan
- **Plugin/extension system** — agent sendiri sudah jadi "plugin", premature tanpa use case konkret
- **Native mobile app** — PWA sudah cukup untuk sekarang
