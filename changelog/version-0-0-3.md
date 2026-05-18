# v0.0.3 — 2026-05-18

🔧 Bug fixes & improvements

## Changes

- changelog: voice input, audit fixes, browser setup docs
- revert gitignore CLAUDE.md — use local exclude instead
- gitignore root CLAUDE.md — prevent auto-created file from entering git
- auto-stop mic on room switch and tab hide
- clear text field when voice command 'matikan mic' is used
- mute voice input while AI is processing — skip onresult when processingMessages active
- add mic selection hint tooltip on voice button
- fix voice command multi-trigger — skip stale onresult events between stop and restart
- fix voice command double-trigger — restart recognition after send/clear to flush stale results
- audit fixes: add missing indexes, remove redundant migrations, improve error handling, doc voice input
- more flexible voice command patterns — accept natural variations
- fix voice command detection — check full accumulated text, not per-segment
- add voice command 'hapus semua' / 'clear all' to reset text field
- voice commands (send/stop) and language toggle for speech-to-text
- fix: Chrome autofill filling search field with saved email
- fix search field autofill by password manager — type=search, delayed clear, clear on room open
- fix search field autofill by password manager — type=search, delayed clear, clear on room open
- fix search field autofill by password manager — type=search, delayed clear, clear on room open
- fix search field autofill by password manager — type=search, delayed clear, clear on room open
- fix search field autofill on page load — clear on init, prevent autocomplete
- fix logout button styling in settings — solid button, consistent layout
- docs: browser setup guide for voice input, notifications, PWA (EN+ID)
- speech-to-text via Web Speech API on mic button
- docs: sync usage guides with actual features (EN+ID)
- test: add auth, path traversal, unauthenticated access, offline agent tests
- audit fixes: dead code, error handling, schema migration, thinking-stuck bugfix
- multi-file uploads, image compression, carousel UI, agent attachment handling
- Update README.md
