# v0.0.27 — 2026-06-02

🔧 Bug fixes & improvements

## Changes

- release: proactive message, compact fixes, per-room compact bar
- audit: add proactive message tests, update usage docs (compact, agent init message)
- improve error handling in frontend JS — add try/catch and console.error to silent fails
- fix export: wrap JSON.parse(r.attachments) in try/catch for graceful degradation
- fix compact bar per-room + delete JSONL on room delete
- fix compact truncate: delay 3s after compact to let Claude write boundary to JSONL
- fix compact truncate: remove debug logs, bump 0.3.8
- debug: add truncate trace logs to find compact truncate root cause
- fix compact truncate: prioritize old session file (has boundary) over new session id
- inject room_id into agent prompt to support proactive messaging
- proactive message: agent can post to room without user trigger
