# Known Issues & Design Decisions

## Intentional Limitations

### 1. Single-User Design
**Decision:** Stoa is NOT a multi-user collaboration tool.

**Implications:**
- No user permissions/roles
- No room-level access control
- One person owns all actors (human + AI)
- Shared deployment = shared access to everything

**Why:** Optimized for solo developer managing multiple AI agents, not team collaboration.

---

### 2. No Horizontal Scaling
**Decision:** SQLite single-writer model, one server instance.

**Implications:**
- Can't run multiple server instances with load balancer
- WAL mode helps with read concurrency, but writes are serialized

**Why:** Single-user = low concurrent write load. Simplicity > scale.

**If you need scale:** Fork to PostgreSQL + Redis session store.

---

### 3. Restart Disrupts Agent Connections
**Decision:** Server restart → all WebSocket connections drop.

**Implications:**
- Agents must reconnect (automatic, but ~5-10s delay)
- In-flight messages lost (rare, only during restart window)

**Why:** WebSocket state is in-memory. Could persist to DB but adds complexity.

**Mitigation:** Agents auto-reconnect. Server restart is rare (update deployments).

---

### 4. File Upload Size Limit
**Limit:** 10MB per file (configurable via `MAX_UPLOAD_SIZE` env var).

**Why:** SQLite `BLOB` limit is ~1GB, but large files slow down DB. Use external storage (S3, CDN) for large assets.

**Workaround:** Agent can reference files by path (no upload needed).

---

## Known Bugs & Workarounds

### 0. Thinking-Signature 400 — 3-Layer Defense (R19)
**Bug family:** `400 Invalid signature in thinking block`, `400 thinking blocks cannot be modified`, `400 thinking blocks must remain as they were`.

**Root cause:** Claude signs thinking blocks against the full turn content. Any upstream mutation (compact truncation, session sanitizer, orphan stripping) invalidates the signature. Non-Anthropic models via proxy emit unsigned thinking blocks that Anthropic rejects on resume. Third-party endpoints can't validate Anthropic-proprietary signatures.

**Defense (lib/thinking-sanitizer.js + stoa.js):**

| Layer | What | Where |
|-------|------|-------|
| 1. Preventif | `sanitizeThinking({thirdParty})` — direct Anthropic: drop unsigned, redacted w/o data, strip cache_control; third-party (base_url set): strip ALL thinking | `prepareResume()`, every resume path |
| 2. Klasifikasi | `isThinkingSignatureError()` — match "thinking" + (signature \| cannot be modified \| must remain), length < 600, provider-agnostic | catch block + content intercept in `processTrigger` |
| 3. Recovery | One-shot per trigger: backup `.sig-bak` → aggressive strip all → resume + retry | `processTrigger`, after classification |

**Design decisions (do not flag in audit):**

| Decision | Rationale |
|----------|-----------|
| Don't strip signed thinking from non-latest turns preventively | No wire copy in Stoa — strip = mutate valid turn → cache miss + trigger "cannot be modified" |
| Unsigned thinking dropped, not demoted to text | Model mimicry: non-Anthropic models copy `[thinking]` marker into their output (see THINKING_MARKER_RE) |
| Placeholder `(thinking elided)` not `[thinking]` | `[thinking]` proven to be mimicked; we have a regex to clean it up |
| Recovery mutates JSONL with `.sig-bak` backup | No wire copy; backup = recoverable |
| Content-path detection uses length < 600 | CLI returns API errors as result text; long agent replies discussing the bug contain the same phrases |
| Not gated by provider/base_url | Proxies forward Anthropic error bodies verbatim |

---

### 1. Message Streaming Race Condition
**Symptom:** Occasionally, streamed message chunks arrive out of order, resulting in garbled text.

**Cause:** WebSocket message delivery not guaranteed in-order when network is slow.

**Workaround:** Agent sends sequence number in chunks (not implemented yet).

**Status:** Low priority (rare occurrence).

---

### 2. Session Compaction Memory Spike
**Symptom:** Server memory spikes when Claude session compacts (long conversation).

**Cause:** Claude SDK loads full conversation into memory during compaction.

**Mitigation:** 
- Idle timeout (30 min) reduces long-lived sessions
- Don't panic-delete `ai_sessions` — let compaction finish

**Status:** Inherent to Claude SDK. Monitor memory, scale vertically if needed.

---

### 3. Voice Input Browser Support
**Symptom:** Voice input button does nothing on Firefox, Safari.

**Cause:** Web Speech API is WebKit-only (Chrome, Edge).

**Workaround:** Use Chrome/Edge, or type manually.

**Status:** Won't fix (browser API limitation).

---

## Design Constraints

### 1. No Real-Time Collaboration Editing
**Not Supported:** Multiple users editing same message simultaneously (CRDTs, OT).

**Why:** Single-user design. If you share access, last-write-wins.

---

### 2. No End-to-End Encryption
**Not Supported:** Messages stored in plaintext in SQLite.

**Why:** Single-user on trusted machine. If you need E2EE, encrypt DB at filesystem level (LUKS, FileVault).

---

### 3. No Native Mobile App
**Not Supported:** iOS/Android native apps.

**Why:** PWA (Progressive Web App) via browser is sufficient for mobile access. Native app = 2x maintenance burden.

---

## Migration Gotchas

### Immutable Migrations
**Rule:** Never edit a migration file after it's been applied.

**Why:** `migrations` table tracks by filename. Editing = inconsistent state across deployments.

**If you made a mistake:** Create a new migration to fix it.

---

### Schema Drift
**Symptom:** `schema.sqlite.sql` doesn't match actual DB schema.

**Cause:** Someone manually ran `ALTER TABLE` without creating migration.

**Fix:** 
1. Compare `schema.sqlite.sql` vs `PRAGMA table_info(...)`
2. Create migration to sync
3. Update `schema.sqlite.sql`

---

## Test Coverage Exclusions

### Endpoints Without Tests
**Documented in `.claude/CLAUDE.md`:**

| Endpoint | Reason |
|----------|--------|
| `POST /api/automations/slack/connect` (success case) | Needs valid Slack token |
| `GET /api/workspace/file` | Needs active agent + real file |

**Status:** Intentional. Testing these requires external services.

---

### Flaky Tests

**Known:**
- `Thread — GET /rooms/:id/messages default scope=roots-only` — fails consistently due to test data isolation: earlier thread tests create replies with `state='complete'` that appear in roots-only query results. Pre-existing, not caused by any specific PR. Track separately for fix.

**If you see new flaky test:** File bug, investigate root cause.

---

## Security Notes

### Agent Secret Storage
**Current:** SHA-256 HMAC with hardcoded salt (`'stoa'`).

**Limitation:** Salt is in source code. If attacker has DB + source → can brute-force secrets.

**Mitigation:** Use strong random secrets (32+ chars). Change salt in production.

---

### SQL Injection
**Mitigation:** All queries use prepared statements (`db.prepare(...).run(...)`).

**Exception:** Dynamic table names (sanitized with allowlist).

**Audit:** Search codebase for string interpolation in SQL → none found (as of last audit).

---

### XSS
**Mitigation:** 
- User input rendered via `marked.js` (markdown parser with sanitization)
- No `eval()` or `innerHTML` with unsanitized input

**Audit:** Manual review of message rendering code. No known XSS vectors.

---

### Path Traversal
**Mitigation:**
- All file paths sanitized with `path.basename()` before filesystem access
- Agent workdir paths validated on registration

**Audit:** Search for `../` in file path handling → all blocked.

---

## Performance Notes

### Large Room Scalability
**Tested up to:** 10k messages per room.

**Performance:**
- Message load: ~50ms (indexed query)
- Search: ~100ms (FTS5)
- Render: ~200ms (DOM manipulation)

**Bottleneck:** Frontend rendering for 1000+ messages at once.

**Mitigation:** Lazy load messages (batches of 50).

---

### Concurrent Rooms
**Tested:** 20 active rooms (20 AI sessions, 5 agents).

**Performance:**
- Server memory: ~500MB
- CPU: ~10% idle, ~50% during concurrent AI responses

**Bottleneck:** Claude API rate limits, not Stoa server.

---

### 5. Threading — Parallel Git Operations Risk
**Decision:** Accept risk of two threads editing same workdir + git simultaneously.

**Implications:**
- Two threads in same room using same workdir can cause git conflicts (branch overwrite, mixed commits)
- Already possible today with sub-agents running in parallel

**Mitigation:** Prompt instructs agents to check `git status`/branch before git actions. Backlog: git worktree per thread (`.stoa-worktrees/<thread_id>`).

---

### 6. CLAUDE.md Import — Git-Tracked Files Not Imported
**Decision:** CLAUDE.md files tracked by git are never imported to room system_prompt, never cleared.

**Why:** Avoid diff in user's repo. Claude Code already loads CLAUDE.md from disk — importing creates duplicate instructions.

**Implication:** User must manually set system prompt for rooms using git-tracked CLAUDE.md workdirs.

---

## Future Improvements (Not Implemented)

### Virtual Scrolling
**Would help:** Rooms with 10k+ messages.

**Complexity:** Medium (need to track scroll position, render window).

---

### Message Search Filters
**Missing:** Filter by date, actor, room.

**Workaround:** Search syntax: `"query" room:general after:2024-01-01`

**Status:** Not implemented (FTS5 doesn't support structured filters out-of-box).

---

### Scheduled Automations
**Missing:** Cron-like triggers (e.g., "daily standup reminder").

**Workaround:** Use external cron + webhook.

**Status:** Planned (low priority).

---

### Multi-Connection Slack Pool
**Implemented:** Automations can use different Slack connections.

**Missing:** Round-robin or failover logic.

**Status:** Single connection per automation (manual selection).

---

## Documentation Sync

### 5-Language Requirement
**Rule:** `docs/guide-usage.*.md` must be updated in all 5 languages (EN, ID, JA, KO, ZH) simultaneously.

**Enforcement:** Pre-commit hook blocks partial updates.

**Bypass:** `SKIP_DOCS_SYNC=1 git commit` (emergency only).

---

### Audit Exclusions
**Documented in `.claude/CLAUDE.md`:**

Migration `20260609-automation-connections.sql` has `CHECK(provider IN ('slack','discord'))` but server only supports `'slack'`.

**Why:** Migration is immutable. Schema baseline updated to match server behavior. No runtime impact.

---

## Support & Community

### Bug Reports
**Where:** https://github.com/a-athaullah/stoa/issues

**Include:**
- Server logs (`pm2 logs stoa`)
- Agent logs (if agent-related)
- Steps to reproduce
- Expected vs actual behavior

---

### Feature Requests
**Where:** GitHub Issues with `enhancement` label.

**Priority:** Features that align with single-user, multi-agent design.

**Non-goals:** Multi-user collaboration, enterprise features, native mobile apps.
