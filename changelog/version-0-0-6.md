# v0.0.6 — 2026-05-19

🔧 Bug fixes & improvements

## Changes

- update v0.0.5 changelog — parallel sessions, security fixes, audit cleanup
- audit fixes: API contract, dead code cleanup, docs sync
- security fixes from audit: XSS, auth bypass, path traversal
- fix composer unlocking on room switch during processing
- add concurrent sessions setting to server config UI
- parallel session support — configurable concurrent triggers
- defer auto-restart when agent is processing a trigger
- fallback model detection to global ~/.claude/settings.json
- fix model detection — strip JSONC comments before parsing settings.json
- fix model badge not updating on room switch — broadcast via room WS too
- real-time model detection — query agent on room open, live badge update
