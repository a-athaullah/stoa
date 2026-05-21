# Changelog

## [2026-05-21]

### Added
- Toast notifications for failed actions — archive, restore, delete, search, settings, and other user actions now show error feedback instead of silently failing (14 catch blocks fixed)
- Room archiving with tabs and swipe gestures — swipe left to archive, swipe right to restore, search badges show archived rooms
- In-room search — Ctrl+F to search messages within current room, results shown as list
- Delete message feature with long-press support on mobile
- Desktop hover buttons for room actions (archive/restore)
- Message API: GET/DELETE /api/messages/:id, agent search & getMessage capability
- GET /api/rooms/:id endpoint for single room retrieval
- Session status events visible in chat (compacting, warmup, etc.)
- Retry on session crash with faster timeout for unresponsive triggers
- Auto-load older messages when navigating to search result not in DOM
- Server-side enforcement to skip triggers to outdated agents and force auto-update
- Gemini session auto-recovery when resume fails (generates fresh session)
- Safety net catch on processTrigger to prevent stuck activeTriggers
- 10 new integration tests: single message GET/DELETE, actor lang config, settings extras, invite rejection
- parseJsonBody helper — guards all HTTP route JSON.parse with 400 Invalid JSON response
- Missing database indexes for reply_to and auth session expiry

### Changed
- First-token timeout increased from 60s to 10 minutes to accommodate large session compaction
- CLIENT_VERSION bumped to 0.2.30
- Version comparison uses localeCompare with numeric option — agents newer than expected are no longer rejected
- Archive/restore buttons use icons instead of text
- Session status events (requesting, idle) filtered from noisy display in chat

### Fixed
- Version comparison bug where agents newer than expected were incorrectly rejected
- Mobile image upload: use createImageBitmap, reduce maxDim on mobile, cleanup blob URLs
- /slash messages treated as skill when no matching skill exists
- ReferenceError in processTrigger finally block
- Stuck messages cleaned up on agent reconnect, stale WS connections closed
- Dead claude-adapter files removed, Gemini warmup fixed

## [2026-05-20]

### Changed
- Server fallback mode switched from one-shot `claude --print` to persistent `ClaudeSession` — eliminates per-message process spawn when no agent is connected
- Install script warmup changed from `claude -p "hello"` to `claude --version` — no longer consumes API credits during agent setup
- Fallback sessions auto-cleanup after 30 minutes idle to prevent memory leaks

### Added
- Enter/Send toggle documentation added to all 5 language variants (en, id, ja, ko, zh)
- Concurrent Sessions setting documented across all languages

## [2026-05-19]

### Added
- Gemini CLI as additional AI backend — agents can now use either Claude Code or Gemini CLI
- Agent language selection (English, Bahasa Indonesia, 日本語, 한국어, 中文) — determines system prompt language
- Voice STT expanded to 5 languages with localized voice commands per language
- Setup progress bar during agent installation — shows connecting/scanning/ready phases
- Japanese, Korean, and Chinese translations for all 4 documentation topics (20 doc files total)
- DOMPurify XSS protection for all markdown rendering (marked v12 dropped built-in sanitization)
- Pagination test for messages `before=` parameter
- Install script tests: ps1 token validation, cmd URL forwarding

### Changed
- Add Agent panel redesigned — moved above list, AI backend dropdown (Claude/Gemini), reorder fields
- Settings tab renamed from "Claude" to "AI Agent"
- Docs language selector changed from pill buttons to dropdown
- Agent language can be changed after connection via settings panel (takes effect on next message)

### Fixed
- Gemini spawn ENOENT on Windows — use `shell: true` for .cmd resolution
- Gemini session resume — use specific session ID instead of `'latest'`
- XSS vulnerability — `marked.parse()` output now sanitized with `DOMPurify.sanitize()`
- `ai_sessions` schema mismatch — recreated table with correct `UNIQUE(participant_id, workdir)` composite constraint
- Agent file upload authentication — exempt `/api/upload/raw` for agents via header auth
- Path traversal hardening — validate `avatar_url` and attachment URLs
- Room creation when agent has no workdirs — show new folder option
- Text field accepting keyboard input during AI processing
- Android voice input text duplication and ding sound
- Room list rows shrinking — fixed with `flex-shrink:0`

## [2026-05-18]

### Added
- Speech-to-text via Web Speech API — click the mic button to dictate messages
- Voice commands: "kirim"/"send" to send, "stop"/"matikan mic" to stop, "hapus semua"/"clear all" to clear text
- Language toggle (ID/EN) for speech recognition
- Mic selection hint tooltip on voice button
- Browser setup guide for voice input, notifications, and PWA (EN+ID docs)
- Integration tests: auth, path traversal, unauthenticated access, offline agent handling

### Changed
- Voice input auto-stops on room switch and tab hide
- Voice input muted while AI is processing to prevent feedback loops
- Usage guides (EN+ID) synced with all current features

### Fixed
- Voice command multi-trigger — skip stale onresult events between stop and restart
- Search field autofill by password manager on page load
- Logout button styling in settings — solid button, consistent layout
- Frontend error handling: room rename, actor rename/delete, settings patch now check response.ok
- Removed redundant runtime ALTER TABLE migrations (avatar_url, attachments already in schema)
- Added missing database indexes (agent_skills.workdir_id, messages.participant_id, ai_sessions.participant_id)

## [2026-05-17]

### Added
- Multiple file/image upload per message (human and agent)
- Image carousel with drag/swipe navigation and fit-to-size display
- Client-side image compression (Canvas API, WebP 80%, max 1920px) before upload
- Server-side image compression via `tools/compress-image.js` (System.Drawing on Windows, ImageMagick/PIL on Linux)
- Reply quotes now show attached file URLs
- Agents receive all attachment URLs and download files locally for reading
- Automatic cleanup of agent temp files (`.stoa-attachments/`) between triggers
- Upload file cleanup cron (configurable via `CLEANUP_CRON_HOUR` and `CLEANUP_MAX_AGE_HOURS`)
- Copy button visual feedback (green checkmark on success)

### Changed
- Messages schema: added `attachments` JSON column for multi-file support
- Agent trigger payload now includes full `attachments` array with resolved URLs
- History context sent to agents includes attachment file names instead of unreachable URLs
- Carousel displays images at natural aspect ratio with horizontal free-scroll
- `stoa.js` iterates all attachments (images + text files) instead of only first file

### Fixed
- Copy button feedback not visible (root cause: `e.currentTarget` null after `await` in async arrow function)
- Old avatar files not deleted when uploading new avatar or deleting actor
