# v0.0.26 — 2026-06-02

🔧 Bug fixes & improvements

## Changes

- release 2026-06-02: compact session, ai_sessions room_id, UTC prompt context
- prompt: inject current UTC time dan timestamp UTC di history pesan ke agent
- audit: dokumen compact session di semua bahasa, tambah test GET /api/rooms/participants
- delete actor: hapus ai_sessions sebelum room_participants untuk hindari FK violation
- compact: filter ai_sessions by room_id for precise session lookup and update
- add room_id to ai_sessions with safe migration and backfill
- compact: truncate session JSONL after compact, remove entries before last boundary
- fix compact: DB update before pendingCompacts check, timeout 120s → 300s
- fix compact: persist new claude_session_id to DB after compact
- fix compact: claude_session_id per-target, cache roomWorkdir outside loop
- bump CLIENT_VERSION to 0.3.2
- fix compact on idle session — resume via claude_session_id instead of failing
- fix compact error handling — show error when all agents fail instead of silent compact_done
- persist compact as system event in room chat history
- add 2-minute timeout for compact to prevent permanent blocking
- add compact button to room header — triggers /compact on all active AI sessions in room
