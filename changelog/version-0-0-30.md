# v0.0.30 — 2026-06-05

🔧 Bug fixes & improvements

## Changes

- release: Slack automation, security fixes, performance indexes, test coverage
- fix section ordering in JA/KO/ZH docs: move Export Conversation after Workspace Panel
- add DELETE messages 404 test and POST client-error test
- fix compact_session N+1, fix invite null crash, add participants/invites tests
- fix workspace symlink vulnerability, expand JA/KO/ZH docs, add room/skills tests
- add Slack Automation section and feature entry to README
- add missing indexes, fix schema ordering, fix upload error handling, add workdirs/logout tests
- add agent-online tests for force-update, rescan, config — skip if offline
- stoa-audit: fix avatar cleanup bug, add automation index + tests + docs
- add Slack setup docs in Japanese, Korean, Chinese
- add groups:history scope and message.groups event for private channels
- deduplicate slack events by ts+channel+eventType (120s window)
- rewrite Slack setup docs: user token only, no bot scope
- clean up bot token — user token is now the only auth option
- remove Bot Token field from Slack config UI
- make Bot Token optional when User Token is provided
- add User Token field to Slack config — supports user event subscriptions
- add Slack event debug logging to diagnose missing events
- fix slack-listener: use v2 SDK API (no ack destructuring)
- update Slack setup docs: add bot invite + reinstall notes
- add Slack setup docs for automation feature
- add automation feature: Slack Socket Mode + automation rules UI + API
