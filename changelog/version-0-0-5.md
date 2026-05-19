# v0.0.5 — 2026-05-19

## Added

- Real-time model badge in room header — shows which AI model each agent uses (e.g., "Opus 4", "Sonnet 4"), auto-detected from agent settings with live updates
- Parallel session support — agents can now respond to multiple rooms concurrently, configurable via "Concurrent Sessions" in server settings (1–10)
- Deferred auto-restart — agent updates wait until all active responses complete before restarting, preventing mid-conversation interruptions
- `install.cmd` documented in usage guides for Windows CMD users

## Changed

- Model detection now falls back to global `~/.claude/settings.json` when workdir has no local model config
- JSONC support for settings parsing — handles `//` and `/* */` comments in Claude settings files
- Architecture section in docs updated with all adapter and session files across 5 languages
- `enrichReply` extracted to global scope so both HTTP API and WebSocket history return reply context

## Fixed

- **[Security] Search XSS** — FTS snippet output was inserted via innerHTML without sanitization
- **[Security] Null secret auth bypass** — agents without a configured secret could skip WebSocket authentication
- **[Security] Avatar path traversal** — avatar deletion could escape the uploads directory
- **[Security] title.trim() crash** — PATCH /api/rooms with empty body crashed the server
- Room notification selector used wrong data attribute (`data-id` instead of `data-room-id`), breaking desktop notifications for non-active rooms
- Reply context missing when opening a room via WebSocket — `enrichReply` was only applied to HTTP API, not WS history
- Invite suggestion notifications missing `avatar_color`, causing broken avatar rendering
- Composer remained unlocked when switching rooms while an AI response was still streaming
- Model badge not updating on room switch

## Removed

- Unused `.s-server-value` CSS class
- Unused `C.dim` ANSI escape code from agent client
- Redundant platform-conditional ternary in workdir scanner
