# v0.1.5 — 2026-06-10

🔧 Bug fixes & improvements

## Changes

- revert WS_IGNORE .claude (intentional — personal tool), update changelog
- fix 6 PR review findings: WS_IGNORE .claude, probeBase double-v1, model_config field strip, platform fallback removed, add-btn listener stacking, non-claude model allowlist
- remove dead code: agent_capabilities WS handler and GET /api/actors/:id/capabilities route — stoa.js no longer sends agent_capabilities since vision detection moved to server-side /api/show in e173637
- fix set_room_model validation — illegal break statement caused server crash
- fix 5 PR review findings: discover-models URL, crash-retry env, sessionRef rotation, model validation, dropdown dead branch
- fix relativeTime UTC parse — SQLite timestamps were treated as local time (WIB +7h offset)
- track all test actors in orphanActorIds for robust teardown cleanup
- add test teardown for orphaned actors, cleanup-test-data.js tool
- fix discover-models dead code, PATCH empty-name validation, add edge case tests
- add discover-models streaming test with NDJSON stream reader helper
- fix stale test assertions: update Slack routes, AI platform status codes, PATCH response shape, wrong secret 403 vs 401
- add health check test for AI platform endpoint
- add AI platform CRUD tests, fix Ollama Cloud URL in docs, document new model features
- fix select all button width — s-icon-btn was 28px fixed, override with width:auto
- fix deselect all button overflow in model checklist header
- add model capability detection via /api/show, show vision icon in checklist and model selector
- fix checkbox visibility in dark mode, settings tab scrollable on mobile, select all button layout
- add model enable/disable checklist per platform in settings
- strip base64 image data from session jsonl after agent responds
