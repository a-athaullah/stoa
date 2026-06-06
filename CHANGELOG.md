# Changelog

## [2026-06-05] — pin room

### Added
- **Pin rooms** — hover any room in the sidebar and click the pin icon to keep it at the top of the list. Pinned rooms appear under a "Pinned" section header separated by a divider from the rest. Maximum 5 rooms can be pinned at a time; the limit is enforced server-side with a clear error toast. Pin state syncs in real-time across browser tabs via WebSocket.

## [2026-06-05]

### Fixed
- **Slack: Enable Events auto-disable** — Socket Mode event handlers (`app_mention`, `message`, `reaction_added`) were not calling `ack()`. Slack requires acknowledgment within 3 seconds; without it every event was marked as failed, and after sustained high failure rates Slack automatically disabled Event Subscriptions. All three handlers now call `ack()` immediately on entry.

### Changed
- **Slack: bot messages now delivered to automations** — the message handler previously dropped all events with a `subtype` field, which silently blocked `bot_message` events from other apps in the channel. The filter now only blocks non-message system subtypes (e.g. `channel_join`, `message_changed`), allowing bot messages from other Slack apps to trigger automation rules.

## [2026-06-05]

### Fixed
- **Auto-update: repeated downloads during deferred restart** — when an agent had an active trigger and couldn't restart immediately, `localManifest` was never updated after a file was written to disk. On the next 2-minute check the same file would be downloaded and written again, repeating indefinitely until the trigger finished. Fixed by updating `localManifest[name]` right after `fs.writeFileSync`.
- **Ollama: duplicate system message removed** — `ollama-session.js` was prepending a hardcoded system message with tool instructions on every request, duplicating what's already in the Modelfile SYSTEM block. Removed the redundant message so tool instructions come from the Modelfile only.

## [2026-06-05] — Auto-Compact

### Added
- **Auto-compact: per-trigger check** — after every agent response, Stoa checks the session JSONL file size. If it exceeds 500 KB, the agent runs `/compact` immediately in the background (after the response is sent) and notifies the server. The user receives the reply first; compaction is invisible.
- **Auto-compact: 60-minute background worker** — every 60 minutes, the agent scans all open sessions on its machine and compacts any that exceed 500 KB. Also cleans up sessions that are open locally but not active in any Stoa room.
- **Auto-compact progress bar** — when auto-compact runs, the room header shows the same progress bar as manual compact. A compact marker is saved in message history and persists across page refreshes.
- **Auto-Compact docs** — new section in all 5 language guides (EN, ID, JA, KO, ZH) explaining both mechanisms.

### Fixed
- **Compact markers disappear on refresh** — message queries used `state='complete'` which excluded `system_event` rows. Compact markers (which have `state='system_event'`) were saved but never returned by the API. Fixed by using `state IN ('complete','system_event')` in both paginated and non-paginated message queries.
- **Auto-compact room resolution** — `auto_compact_start` and `compact_complete` WebSocket messages from the background worker don't carry `room_id` (worker doesn't know which room a session belongs to). Server now looks up `room_id` from `ai_sessions` via `claude_session_id` when `room_id` is absent.

## [2026-06-05]

### Added
- **Slack Automation** — connect a Slack workspace (Socket Mode, user token only) and define rules that fire when messages arrive in public or private channels. Rules have a name, trigger event (`message`, `message.groups`, `mention`), optional AND conditions (text contains/starts_with/regex), target Stoa room, and a prompt template supporting `{{slack_message_text}}`, `{{slack_message_link}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{extracted_url}}`, `{{slack_thread_ts}}`. Each rule has an enable/disable toggle
- **Slack: private channel support** — `message.groups` event type triggers on private channels using the `groups:history` OAuth scope
- **Slack: event deduplication** — incoming Slack events are deduplicated by `ts + channel + eventType` within a 120-second window to prevent multiple automation triggers from the same event
- **Automation index** — `idx_automations_trigger ON automations(trigger_type, trigger_event, enabled)` added for fast event handler lookups
- **4 new database indexes** — `idx_actors_type`, `idx_messages_state`, `idx_auth_users_email`, `idx_settings_scope_key` covering the most common WHERE clauses in server queries
- **Slack Automation section in README** — setup guide, feature table, and template variable reference
- **Slack setup docs** — step-by-step guide in all 5 languages (EN, ID, JA, KO, ZH)
- **20+ new integration tests** — covering workdirs (online → 200, offline → 503), force-update, rescan, actor config, auth logout, room participants, GET single room, room skills, invite resolve 404, DELETE message 404, client-error logging, automation CRUD, setup status

### Changed
- **Slack: bot token removed** — simplified to user token only; bot token scope removed from UI and docs
- **compact_session: N+1 eliminated** — sessions for all AI participants in a room are now batch-fetched with one `IN (...)` query before the loop instead of one query per agent
- **Schema: index ordering fixed** — `idx_automations_trigger` was defined before the `automations` table in schema.sqlite.sql (would fail on fresh installs); moved to after all table definitions

### Fixed
- **Security: symlink attack in `/api/workspace/file`** — endpoint was using `startsWith()` to validate paths but didn't check symlinks. An attacker could create a symlink inside the workdir pointing to `/etc/passwd` and read it. Fixed by replacing the manual check with the existing `isPathSafe()` function which checks symlinks via `lstatSync` + `realpathSync`
- **Avatar file leak** — uploading or deleting an actor avatar never removed the old file from disk. Root cause: `path.resolve(__dirname, '/uploads/…')` discards `__dirname` when the second argument is an absolute path. Old files accumulated indefinitely. Fixed using `path.join(__dirname, url.replace(/^\//, ''))`
- **Invite resolve null crash** — `POST /api/invites/:id/resolve` with `approved: true` on a non-existent invite ID would crash with `TypeError: Cannot read properties of null (reading 'room_id')`. Now returns 404 if the invite doesn't exist
- **Upload error handling** — `fs.writeFileSync` in `POST /api/upload/raw` was not in a try/catch; disk-full or permission errors would escape to the outer handler without a clear 500 response
- **Docs: JA/KO/ZH section ordering** — "Export Conversation" section was placed before Sidebar Collapse and Workspace Panel in Japanese, Korean, and Chinese guides; moved to match the EN order
- **Docs: JA/KO/ZH Workspace Panel** — all three translations were missing 9 subsections (Opening the Panel, File Tree, Code Viewer, Markdown Preview, Image Preview, Git Diff, Clickable File Paths, Download Files, Remote File Browsing) and the Sidebar Collapse section entirely; now fully in sync with EN/ID

## [2026-06-04]

### Added
- **Ollama: `describe_image` vision tool** — agents can now analyze image files using a local vision model (`ara`). WebP images are auto-converted to PNG via `sips` before sending. Triggered when agent is asked to describe an image file
- **Ollama: thinking mode** — toggle in Settings > AI Agent accordion enables/disables extended reasoning (`cfg.think`). Persisted in `adapter_config`. Default off
- **Ollama: tool use** — `bash`, `read_file`, `write_file`, `list_dir`, `grep`, `http_get`, `web_search` tools added to `ollama-session.js`. Agent invokes them automatically based on prompt context
- **Integration + unit tests** — `test.js` created from scratch: 26 pure unit tests (no server needed) + 54 integration tests covering auth, rooms, messages, search, actors, install scripts, upload, docs, and full room lifecycle. 80/80 passing

### Changed
- **Ollama: `modelVision` default** — now falls back to `modelChat` instead of a hardcoded `qwen2.5vl:7b`, so single-model setups work out of the box
- **Ollama: prompt cleanup** — `[send:]` file instruction stripped from Ollama prompts (Ollama uses tool calls instead); tool-calling directive appended when prompt contains file/git-related keywords
- **Settings: AI agent section** — human actor moved to its own section; AI agents in a separate card, sorted newest-first
- **Settings: add agent button** — repositioned below section header, above agent list (more discoverable)
- **Compact button** — hidden in rooms where all AI agents are Ollama (no Claude session to compact)
- **Docs: Ollama as backend** — all 5 language guides (EN, ID, JA, KO, ZH) updated to list Ollama as a supported backend alongside Claude Code CLI and Gemini CLI

### Fixed
- **Ollama setup flow** — "Done" button no longer stays disabled after selecting a model; `sFinishSetupSlip` now waits for `agent_scan_complete` instead of triggering prematurely
- **actor_status broadcast** — now includes `adapter` and `adapter_config` fields so newly connected Ollama agents appear with correct backend info in the UI
- **Attachment-only messages** — when agent sends only a file with no text, `agent_complete` now sends `📎` as content placeholder so the message isn't silently dropped
- **Schema drift** — `available_models TEXT DEFAULT NULL` added to `actors` table in `schema.sqlite.sql` (previously only added via runtime migration; fresh installs now get the column from schema directly)
- **CLIENT_VERSION** bumped to `0.3.25`

## [2026-06-02] (2)

### Added
- **Proactive message** — agents can now post to a room without a user trigger via `POST /api/rooms/:id/message` (agent auth: `X-Agent-Id` + `X-Agent-Secret`). Server validates agent is a participant, room not archived, content non-empty. Does not trigger other AI agents. `sendProactiveMessage(roomId, content)` helper added to `stoa.js`
- **Room ID in agent prompt** — every trigger now includes `Room ID: <n>` so agents know which room they're in and can use the proactive message endpoint
- **Delete room cleans up session JSONL** — when a room is deleted, server notifies connected agents to remove the associated `.jsonl` session files (best-effort; no-op if agent offline)
- **Compact bar per-room** — progress bar and disabled composer now only appear in the room being compacted. Switching rooms hides the bar; returning to the compacting room restores it. Server re-sends `compact_start` on `join_room` if compact is still in progress
- **Tests**: added coverage for `POST /api/rooms/:id/message` — auth required (403), wrong secret (403), room not found (404), agent not participant (403)

### Fixed
- **Compact truncate race condition** — `truncateSessionFile` now runs 3 seconds after compact completes, giving Claude time to write `compact_boundary` to the JSONL file before scanning
- **Compact truncate session ID mismatch** — after compact, session ID may change; truncate now prioritizes the old session file (`msg.claude_session_id`) which holds the boundary, then truncates the new file if different
- **Frontend silent fails** — several `catch` blocks in `public/js/` that silently dropped errors now log via `console.error` or show a toast

### Documentation
- `guide-usage.en.md` + `guide-usage.id.md` updated: compact sessions flow, proactive agent messages, room ID availability in agent context

## [2026-06-02]

### Added
- **Compact session** — button (↕) in room header triggers `/compact` on all active AI sessions. Progress shown as progress bar; completion recorded as a system event in chat history. Timeout 300s. Documented in all 5 language guides
- **`room_id` in `ai_sessions`** — new column with safe startup migration (ALTER TABLE + backfill from `room_participants`). Enables precise session lookup by room without ambiguity when an agent has sessions across multiple workdirs
- **UTC timestamp context in agent prompts** — every trigger now includes current time (`2026-06-02 02:17 UTC`) and labels each history message with its UTC timestamp (`[Name @ 2026-06-02 01:15 UTC]: ...`). Agents can now answer time-related questions correctly

### Changed
- **Compact session lookup** filters by `room_id` in addition to `participant_id`, and uses `ORDER BY last_active_at DESC LIMIT 1` — prevents stale or wrong session being selected when a participant has multiple workdir sessions
- **Compact update** after completion also filters by `room_id` — ensures only the correct session row is updated
- **Session JSONL truncated after compact** — entries before the `compact_boundary` marker are removed, reducing disk usage and speeding up future session resumes
- **`saveSession`** now stores `room_id` (looked up from `room_participants`) on every insert/upsert

### Fixed
- **FK violation on actor delete** — `ai_sessions` rows now deleted before `room_participants` when an actor is removed, preventing foreign key constraint errors
- **Compact on idle session** — agent now resumes via `claude_session_id` instead of failing when the session is not in the active pool
- **Compact error handling** — error is broadcast when all agents fail; previously silently emitted `compact_done`
- **Stale Windows workdirs** — session rows with `C:\Users\HYPE FLEX\stoa-workspace` path corrected to Ubuntu paths; duplicate stale row removed

### Tests
- Added: `GET /api/rooms/participants?ids=` — verifies grouped response shape and that `secret` is not exposed

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
