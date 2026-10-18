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

### Trust Proxy Design (R20 — public exposure hardening)
**Decision:** Client IP and HTTPS flag are only derived from proxy headers when the socket IP is in `STOA_TRUSTED_PROXIES` (default: loopback only).

**Why:** Prevents IP spoofing via `X-Forwarded-For` and `X-Forwarded-Proto` from untrusted clients. Required for correct rate limiting, CSRF, and Secure cookie behavior behind a public reverse proxy.

**Implication:** Self-hosters running behind nginx/Caddy on VPS must set `STOA_TRUSTED_PROXIES` to their proxy IP(s). Do not flag `clientIp()` or `isHttps()` as potentially spoofy — the guard is in `lib/net-trust.js`.

---

### Signed File URLs (R20)
**Design:** `/uploads/*` and `/connector-media/*` are no longer public. External access (agents on remote machines, Slack/email automations sending media links) uses signed URLs: `?exp=<unix_seconds>&sig=<hmac>`.

**TTL:** Default 7 days, max 8 days (`exp <= now + 8 days`). Sig = `HMAC-SHA256(signingKey, 'file|' + pathname + '|' + exp)`.

**Why:** Files could contain sensitive data (WA media, uploaded documents). Signed URLs tie access to a time window without requiring a session.

**Implication:** Any code path that sends file URLs to agents or external services must call `signFileUrl()`. Browser access still works via same-origin session cookie — no change for UI.

---

### Ollama Proxy Token (R20)
**Old format:** `stoa-proxy:<platform_id>` — no secret, trivially forgeable.

**New format:** `stoa-proxy:<platId>:<actorId>:<sig>` where `sig = HMAC-SHA256(signingKey, 'proxy|platId|actorId|sha256(actor.secret))`.

**Why:** Old format allowed any client to proxy arbitrary Ollama requests through Stoa. New format ties the token to a specific actor's secret — rotating or deleting the actor invalidates the token automatically.

**Implication:** Ollama sessions started before the server upgrade may need to be re-triggered. Do not flag the bearer verification block as redundant — bypass in `requireAuth` is intentional (SDK doesn't send cookies), but the handler itself verifies before reading the body.

---

### Device Cookie for Rate Limit Exemption (R20)
**Cookie:** `stoa_device = <userId>.<issuedAt>.<hmac(signingKey,'device|'+userId+'|'+issuedAt)>`, HttpOnly, SameSite=Lax, Max-Age 180 days.

**Purpose:** Distinguishes a known device from a fresh attacker IP. When an email is under brute-force from many IPs, only the known device (holding a valid `stoa_device` for that user) is exempt from the per-email lockout. IP-based lockout still applies to the device's IP independently.

---

### Install Token Required for Agent Install (R20)
**Old behavior:** `GET /install.sh` was public — anyone who could reach the server could install an agent.

**New behavior:** `GET /install.sh?token=<t>` — token must be generated by a logged-in human (`POST /api/agent/install-token`). Token is 64-char hex, valid 10 min, one-time use. Script without valid token returns `exit 1` with a clear error message.

**Why:** Public install endpoint let any network-reachable client register agents and obtain agent secrets, giving full API access.

---

### Agent Secret Scoping (R21)
**Decision:** Agent secrets (`x-agent-id` / `x-agent-secret`) are restricted to a least-privilege allowlist (`lib/agent-scope.js`). Before R21, a valid agent secret had near-admin access to the full API — identical to a human session.

**Risk it closes:** Prompt injection via untrusted content (WhatsApp, email, Slack, web) could cause an agent to curl admin endpoints (delete rooms, read settings, generate install tokens, etc.).

**Implementation:** `matchAgentRoute(method, pathname)` in `lib/agent-scope.js` returns `{scope, id}` or null. Scope checks are: `room` (participant check), `self` (actor id match), `sub-agent` (ownership), `connection` (automation feed), `any` (valid agent sufficient). Non-matching requests → `403 {error:'agent_scope_denied'}` + one log line.

**Escape hatch:** `STOA_AGENT_SCOPE=off` on server (warning logged at boot). Not gated by request headers — cannot be spoofed.

**Implication:** Do not flag `requireAuth` agent bypass as "agent has full access" — that was closed in R21. When auditing, check `lib/agent-scope.js` for allowlist coverage instead.

---

### Cloudflare Access Service Token for Agents (R21)
**Decision:** `lib/cf-access.js` adds optional CF Access service token support for agents connecting through a Cloudflare Access-protected domain (use case: agents on machines without Tailscale).

**Design — token isolation:**
- Headers sent **only to the Stoa origin** (origin comparison in `cfHeadersFor`)
- Child sessions (Claude Code, Codex) use a loopback forward proxy (`startCfForwardProxy`) that injects the CF headers — token never enters child env or their prompts
- CF env vars deleted from `process.env` after reading — children don't inherit

**Design — proxy security:**
- Binds `127.0.0.1` only; random path prefix (only handed-out URLs can use it)
- Absolute-form and CONNECT requests refused
- Body capped at 25MB; hop-by-hop and CF headers stripped from incoming requests
- No logging of header values or secrets

**Zero regression guarantee:** When `STOA_CF_ACCESS_CLIENT_ID` / `STOA_CF_ACCESS_CLIENT_SECRET` are not set, code paths that attach headers are never reached and child sessions receive the normal `STOA_URL` value.

**Implication:** Do not flag loopback proxy as "open proxy" — it only forwards to the Stoa origin (enforced by `target.origin !== upstream` check) and is unreachable from outside the machine.

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
