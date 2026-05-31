# Changelog

## [2026-05-31]

### Changed
- **Project restructured** — monolithic `index.html` (9,769 lines) split into organized directories: `public/css/` (5 files), `public/js/` (9 modules), `public/vendor/`, `db/`, `test/`, `build/`
- **Self-hosted dependencies** — marked, DOMPurify, highlight.js, and CodeMirror bundled locally via esbuild. Zero runtime CDN dependency (was jsdelivr + esm.sh)
- **Build step** — `npm run build` generates minified `dist/stoa.min.css` (75KB) and `dist/stoa.min.js` (161KB). `NODE_ENV=production` serves minified bundles
- **N+1 participant fetch eliminated** — new bulk endpoint `GET /api/rooms/participants?ids=` replaces per-room fetch loop
- **WebSocket reconnect** — exponential backoff (3s → 30s max) instead of fixed 3s interval

### Fixed
- `showUploadError` scoping bug — function was trapped inside `init()` scope, crashed on image paste failure
- Hardcoded `ws://` protocol — now auto-detects `wss://` when page is served over HTTPS
- `avatar_color` XSS — sanitized before CSS injection in reply quotes
- Server restart banner XSS — port value now uses `textContent` instead of `innerHTML`
- Image fallback — broken images (404) show clean SVG placeholder instead of browser error icon

### Security
- **WebSocket origin validation** — rejects cross-origin connections (CSWSH prevention)
- **Upload size limit** — `/api/upload/raw` now enforces 25MB max body size (was unlimited)
- **Cookie Secure flag** — set automatically when served over HTTPS
- **Constant-time auth** — HMAC-based comparison eliminates timing side channel on secret length

### Removed
- Dead CSS classes (8 classes), dead JS function (`wsShowEditingBanner`), orphaned MySQL schema
- CDN dependencies on jsdelivr and esm.sh

### Documentation
- Fixed inaccuracies across all 5 languages (en/id/ja/ko/zh): room creation radio buttons, reading comfort labels, notification toggle location, architecture file list, agent terminology
- All 20 doc files updated to reflect restructured project

### Tests
- Added tests for 17 previously untested WebSocket message types (agent_complete, agent_token, agent_error, stop_generation, invite_suggest, model_info, etc.)
- Full test suite: 100+ tests, 0 failures

## [2026-05-25]

### Added
- Emoji search in picker — filter by keyword (e.g. "fire" → 🔥, "heart" → ❤️), Enter to insert first match
- Per-room delete button in archived room list — swipe right reveals restore (blue) and delete (red) buttons; desktop hover shows both action icons
- `deleteRoom()` function with confirmation dialog before permanent deletion
- Default login credentials documented in README (`stoa@stoa.com` / `stoa2026!`)
- Archive/delete room documentation added to JA, KO, ZH usage guides (previously only in EN/ID)
- "Why Stoa?" section and AI Backends table in README
- License, Node.js, and PRs Welcome badges in README

### Changed
- README revamped: updated tagline to reflect multi-backend support (Claude + Gemini), condensed etymology, restructured for visual-first impression
- Architecture section updated to include gemini-session.js and gemini-adapter.js
- Archived room swipe now reveals two buttons (restore + delete) instead of just restore
- Bulk delete archived rooms wrapped in try/catch with toast error feedback
- Room rename uses async/await with toast error feedback instead of silent `.catch()`

### Fixed
- Mobile image upload failure in rooms with heavy content — replaced `new Image()` + blob URL with `createImageBitmap` for better memory efficiency, added progressive retry (1280px → 800px), proper `URL.revokeObjectURL` cleanup
- N+1 query in agent workdir scan — replaced per-workdir `SELECT` with single batch fetch after upserts, reducing O(3n) queries to O(3)

### Security
- Removed real Tailscale IP from browser-setup docs (all 5 languages), replaced with generic LAN example

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
