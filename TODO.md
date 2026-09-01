# Stoa — Todo

_Audit terakhir: 2026-09-01 (Ara) — lihat `~/project/stoa-feature/hermes-adoption-plan.md` untuk planning detail item hermes._

## Priority 1 — Hermes Adoption (R12–R18)

- [ ] **R12 — Schedule doctor** — health check read-only untuk scheduled triggers: deteksi silent non-firing (`next_run_at` overdue > 15 menit), last_error, sub-agent unlinked. Endpoint `GET /api/rooms/:id/sub-agent-schedules/doctor` + badge di room settings. _Effort S — paling timely, schedule UI baru ship._
- [ ] **R17 — Message dedup via event_id** — `client_event_id` UUID per pesan + `UNIQUE(room_id, client_event_id)`; duplikat saat WS reconnect → return existing, bukan row baru. _Effort S–M._
- [ ] **R13 — Status sub-agent jujur** — flag failure eksplisit menang atas presence output; pisah `status` vs `exit_reason`; konstanta `FAILURE_STATUSES` dishare semua permukaan; failure tampil satu-baris di bubble. _Effort M._
- [ ] **R15 — `indeterminate` + `process_generation`** — cap UUID per boot ke kerja in-flight; saat boot, running milik generation lama → indeterminate (bukan requeue, bukan stuck). _Effort M._
- [ ] **R14 (preventif) — Compact hardening** — durable cooldown `MAX(existing,new)` di ai_sessions + progress-aware timeout untuk compaction. Playbook diagnosis lengkap ada di plan doc, dipakai saat compact-stuck muncul lagi. _Effort S–M._
- [ ] **R16 — Audit teardown scope** — audit semua teardown path: `releaseOwnResources()` vs `closeSession()`; peserta yang "ikut pakai" resource session-scoped tidak boleh men-cleanup-nya. _Effort S + fix._
- [ ] **R18 — GC nebeng scheduler tick** — maintenance throttled ~6 jam di ticker existing; fail-safe-to-preserve; split `auditX()` dry-run vs `reclaimX()`. _Effort M._

## Priority 3 — High Impact (carry-over)

- [ ] **Webhook/API** — HTTP endpoint untuk trigger agent dari external (CI/CD, monitoring, script). Masih relevan; belum ada endpoint trigger generik (baru automation Slack + proactive message agent-auth).

## Priority 4 — Enhancement (carry-over)

- [ ] **Context window indicator** — indikator visual saat conversation mendekati batas context. Sebagian tertutup oleh configurable auto-compact threshold (Settings); indikator per-room belum ada. Nice-to-have, nyambung dengan R14.

## Done (audit 2026-09-01)

- [x] **Agent config via UI** — sudah ada: `public/js/settings/agents-add.js` + install-script generation (bash/PowerShell) di server.
- [x] **Multi-model support** — arah berubah dari "adapter per vendor" ke **AI Platforms**: custom platform (base_url + API keys, vendor generic/ollama), Ollama Cloud proxy, model discovery, switch model per room. OpenAI-compatible & LiteLLM tertutup lewat custom platform base_url.
- [x] **Scheduled triggers + schedule UI** — PR #58/#59 (v0.17.x).

## Tidak Lagi Relevan (usul buang — keputusan Aan)

- **Gemini model detection** — tidak ada kode Gemini sama sekali di codebase sekarang; arah multi-model sudah pivot ke AI Platforms (OpenAI-compatible proxy). Kalau mau Gemini, jalurnya nanti via platform endpoint OpenAI-compatible, bukan deteksi `.gemini/settings`.

## Trash

- **Semantic search** — FTS5 keyword search sudah cukup, AI embeddings overkill
- **Role/permission system** — personal tool, premature tanpa multi-tenant use case
- **Read receipts** — human + multiple AI, konsep "read" tidak relevan
- **Plugin/extension system** — agent sendiri sudah jadi "plugin", premature tanpa use case konkret
- **Native mobile app** — PWA sudah cukup untuk sekarang
