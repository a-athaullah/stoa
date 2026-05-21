# v0.0.8 — 2026-05-21

🔧 Bug fixes & improvements

## Changes

- update CHANGELOG for 2026-05-21 release
- add 10 new integration tests for previously untested routes
- add toast notifications for silent error catch blocks in frontend
- remove outdated comment — GET /api/rooms/:id is implemented
- fix version comparison — allow agents newer than expected version
- increase first-token timeout to 10 minutes for large session compaction
- fix mobile image upload: use createImageBitmap, reduce maxDim on mobile, cleanup blob URLs
- increase first-token timeout from 60s to 180s
- add GET /api/rooms/:id endpoint
- add tests for GET /api/rooms/:id, archived rooms, and room-scoped search
- add parseJsonBody helper — guard all HTTP route JSON.parse with 400 Invalid JSON
- update usage docs with archive, in-room search, delete message, concurrent sessions fix
- add missing indexes for reply_to and auth session expiry
- skip triggers to outdated agents, force auto-update first
- auto-recover gemini session when resume fails
- add safety net catch on processTrigger to prevent stuck activeTriggers
- auto-load older messages when navigating to search result not in DOM
- fix in-room search — show results as list instead of inline highlight
- add message API, in-room search, and agent search/getMessage capability
- add delete message feature with long-press support on mobile
- fix ReferenceError in processTrigger finally block
- clean up stuck messages on agent reconnect, close stale WS
- filter out noisy system events (requesting, idle) from chat
- desktop hover buttons for room actions, touch-only swipe on mobile
- use icons for archive/restore swipe buttons instead of text
- add updating instructions to README
- add room archiving — tabs, swipe to archive/restore, search badges
- show session status events in chat — compacting, warmup, etc.
- distinguish timeout abort from user stop, add crash diagnostics logging
- add retry on session crash + faster timeout for unresponsive triggers
- fix /slash messages treated as skill when no matching skill exists
- remove dead claude-adapter files, fix gemini warmup
