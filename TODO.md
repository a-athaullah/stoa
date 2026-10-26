# Stoa — Todo

_Dirapikan 2026-10-26 (v0.70.1, s/d PR #204). Riwayat item yang sudah selesai ada di git log / PR — tidak lagi dicatat di sini._

## Fitur

- [ ] **Specialists & Teams** — template sub-agent global, Teams (paket sub-agent), built-in tools. Plan sudah ada; menunggu keputusan desain.
- [ ] **Easy Install** — installer macOS / Windows / Linux: deteksi harness yang tersedia (Claude Code, dll), pandu install kalau belum ada, wizard pembuat specialist. Belum research/plan.
- [ ] **Webhook/API generik** — trigger agent dari luar (CI/CD, monitoring, script). Sekarang baru automation Slack/email + proactive message agent-auth. Naikkan kalau ada use case konkret.

## Follow-up teknis

- [ ] **Easy Update** (#197–#201) — belum teruji end-to-end: restart launchd live + `npm ci` via tombol update.
- [ ] **WS heartbeat** (#204) — verifikasi di produksi setelah restart: pantau log `[ws] heartbeat timeout`.
- [ ] **MCP gateway** (#188–#193) — uji OAuth dengan akun asli; preset Fetch/Git butuh `uv` di mesin server.
- [ ] **Go-public** — cloudflared; bypass cache Cloudflare untuk `/uploads` dan `/connector-media`.
- [ ] **Themes** (opsional) — hint warm-paper & card dark lebih gelap; tes popup model di thread composer; cek visual pill room_threads (#203) di tema dark.
- [ ] **Scheduled triggers v2** — apakah schedule boleh fire ke feed utama (bukan thread): keputusan produk.
- [ ] **Test helper** — `completeTrigger` di `test.js` mengirim `agent_message` (no-op), jadi trigger di test itu tidak benar-benar selesai.
- [ ] **Flaky test** — upload/raw 413 kadang `ECONNRESET` (lama, bukan regresi).

## Trash

- **Role/permission system** — Stoa single-user (remote control banyak agent), bukan multi-tenant.
- **Read receipts** — konsep "read" tidak relevan untuk human + banyak AI.
- **Plugin/extension system** — agent dan MCP gateway sudah jadi titik ekstensi.
- **Native mobile app** — PWA cukup.
- **Gemini model detection** — multi-model lewat AI Platforms (endpoint OpenAI-compatible).
