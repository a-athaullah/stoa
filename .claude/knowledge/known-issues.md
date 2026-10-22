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

**Self-healing for sub-agent runs (bug/orphan-subagent-wake):**
- Agent processes keep running across a ws drop or server restart. On `agent_connect` the agent
  sends `active_message_ids`; those runs are revived (back to `streaming`), the rest are orphaned.
- Every path that ends a sub-agent run without `agent_complete` (disconnect, reconnect, server
  start, "agent updating", mid-trigger disconnect) stamps `result_meta.exit_reason='interrupted'`
  (server-only value, not in `RESULT_EXIT_REASONS`) and queues a `pending_wakes` row.
  `agent_error` / empty `agent_complete` on a sub-agent queue a normal failure wake.
- `drainWake` only delivers to a connected, current-version agent — otherwise the row waits for
  the next `agent_connect` (triggerAiResponse to an offline/outdated agent returns without
  throwing, which used to consume the wake).
- Loop guard: >3 interrupted runs per (room, thread, sub-agent) in 1 hour → system_event, no wake.
  The server never re-triggers a sub-agent itself; the parent decides.
- Kill switch: `STOA_ORPHAN_WAKE=off` (wakes only; the interrupted stamp stays).
- Agent side: while a tool call is in flight, every trigger watchdog allows up to 30 min of
  silence (`TOOL_STALL_MS` via `idleLimit` in stoa.js): hang watchdog (else 5 min idle / 10 min
  first token), pending update restart (else 3 min). The stale sweep stays a backstop two sweep
  ticks above the watchdog (32 min with a tool, else 20). No tool in flight → old bounds (newfin).
- The 15-min server run timeout (`AGENT_RUN_TIMEOUT_MS`, absolute, not idle) only errors the
  bubble; the agent keeps running. For a sub-agent it writes `result_meta={exit_reason:'timeout',
  awaiting_agent:true}` (server-only key) and does not wake. The disconnect / reconnect / startup
  cleanups treat such rows like `streaming` ones (`RUN_IN_FLIGHT_SQL`), so an agent that dies
  instead of completing still wakes the parent ([sub-agent TERPUTUS]). A late `agent_complete` /
  `agent_error` overwrites/clears the mark → one wake only. Deliberately no time-based sweep: the
  agent watchdogs are idle-based (debug-log defers extend them), so a timer would wake the parent
  for runs still legitimately working.
- Known gap: a half-open agent socket (machine gone without FIN) is not detected by the server
  (no server-side heartbeat), so its runs wait for the OS TCP timeout before the disconnect
  cleanup fires. Pre-existing, applies to `streaming` runs too.
- Tests: run-tests.js sets `AGENT_RUN_TIMEOUT_MS=15000` so the timeout path runs for real.

**Self-healing for parent triggers refused by "agent updating" (bug/outdated-trigger-lost):**
- Incident 2026-10-22 03:30–03:35 UTC, room 68 (msgs 43448/43450/43453/43455): a parent trigger to
  an outdated agent was set `state='error'` + restart and dropped; sub-agents had a wake, parents had nothing.
- Now the refused parent trigger goes into `pending_retriggers` (room, participant, trigger_message_id =
  the `reply_to` it answers or NULL for scheduler/wake/cascade, thread_id, prompt, attachments,
  outside_history, attempts). Placeholder text: "(agent updating — akan diproses otomatis setelah
  restart)"; a sub-agent keeps "(agent updating — please retry)" because its parent is woken and decides.
- Dedup at enqueue: one row per (participant, trigger_message_id), or per (participant, thread, prompt)
  when there is no trigger message.
- `drainRetriggers` runs on every `agent_connect`: chains per (participant, thread), FIFO by id,
  next row only after the previous replay returned. Delivered only to a current-version agent
  (`agentReadyForWake`). The row stays until the replay returns → a crash mid-replay re-delivers
  (at-least-once); a row whose trigger already has a complete/streaming reply from that participant
  is dropped without replay. A successful replay runs `cascadeMentionsAfterWake` (the refused run
  never reached triggerAgentsSequential's cascade).
- Give-up: `attempts >= 3` (each refused/failed replay +1) or older than 30 min → row deleted +
  system_event "trigger <id> tidak terproses — butuh manusia" in the thread. Attempts are checked on
  drain; age is also checked by `sweepExpiredRetriggers` every `RETRIGGER_SWEEP_MS` (60 s, 500 ms
  under run-tests), so an agent that never reconnects still produces the notice. The sweep skips
  chains being drained; `giveUpRetrigger` only reports when its DELETE removed the row (no double notice).
- Room feed: the placeholder goes through `maybeBroadcastError` (`broadcast_reason='error'`, 10-min
  per-thread flood guard kept). The give-up system_event calls `setBroadcastReason` directly and
  always reaches the feed (threaded rows only): it is the terminal "a human must act" signal, at most
  once per queued trigger, so it cannot flood — and the placeholder usually spent the guard already.

---

### 4. File Upload Size Limit
**Limit:** 10MB per file (configurable via `MAX_UPLOAD_SIZE` env var).

**Why:** SQLite `BLOB` limit is ~1GB, but large files slow down DB. Use external storage (S3, CDN) for large assets.

**Workaround:** Agent can reference files by path (no upload needed).

---

## Known Bugs & Workarounds

### 0. Theme — Design Rules (do not flag in audit)

**Rule: Never use `.dark` selector or hardcoded colors.**

All colors must use CSS tokens (e.g., `var(--h-ink)`). The old binary `.dark` class is gone — there is no `.dark { }` block. Themes are applied via `[data-theme="<id>"]` on `<html>`.

**Rule: New tokens must be defined in all 11 themes.**

If a token is added to one theme's block in `base.css`, it must be added to all 11 theme blocks. Missing it causes invisible or broken UI in the themes that lack it.

**Rule: No `.dark` in JS either.**

Do not check `document.documentElement.classList.contains('dark')` or toggle `.dark` class. Use `currentTheme()` from `core.js` to read the active theme ID, or `document.documentElement.dataset.theme`.

**Known tight pairs (by design, not a bug):**
- Warm Paper hint text: ~3.57:1 against minimum 3.0
- Dark hint/card text: ~3.31:1 against minimum 3.0
These are the pre-existing colors; they were not degraded by the themes feature.

---

### 0b. Thinking-Signature 400 — 3-Layer Defense (R19)
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

### 4. `.env` Lost PORT → Server Came Up on 3000 (2026-10-21)
**Symptom:** After a restart the server listened on 3000 (`parseInt(process.env.PORT) || 3000`) and every client lost it. The live `.env` held only `MAX_AI_TURNS=15`.

**Cause:** `writeEnv()` did read → `writeFileSync` (truncate + write). The throwaway server from `run-tests.js` ran with the project dir as `__dirname`, so `PATCH /api/settings` in test.js wrote the **live** `.env`; parallel runs (mutation worktrees symlinked `.env`) raced the truncate and one wrote a file with only its own key.

**Fix (`lib/env-file.js`, branch bug/env-clobber):**
- `STOA_ENV_FILE` overrides the env file path (loader + writer). `run-tests.js` points it at a temp copy of `.env` and fails the run (`liveEnvTouched`) if the live `.env` changes anyway.
- `setEnvKey` writes a temp file in the same dir and `renameSync`s it over (readers never see a truncated file), keeps the file mode (new file 0600), follows a symlinked `.env`, and saves the previous content to `.env.bak` (gitignored). Synchronous → serial within one process. Two *processes* writing the same file can still lose one update (last rename wins), but never get an empty/partial file.
- Values with CR/LF are rejected (key injection, e.g. `HUMAN_NAME="x\nPORT=1"`); `PATCH /api/settings` returns 400 for such `human_name`.
- Startup logs `[env] PORT not set, falling back to 3000; check <file>` to stdout **and** stderr when PORT is missing/unusable. Default behavior unchanged.

**Mutation worktrees:** copy `.env` into the worktree, never symlink it.

---

## Design Constraints

### 0. max_concurrent > 1 — No Workdir File Lock
**Decision:** When `max_concurrent` is raised above 1 (default: 1), threads in different Stoa threads but the same workdir can run git or edit files simultaneously. No file lock or coordination is added.

**Why:** Single-user design; each thread is expected to own its workdir. The default of 1 is safe for all cases. Users who raise the limit are expected to either work on different workdirs or accept the race risk.

**Implication:** Keep `max_concurrent = 1` for rooms where the agent edits shared code or runs git. Assign separate workdirs per thread to safely run parallel.

---

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

### 4. Claude Model List Is Static (No Agent Sync)
**Decision:** Claude harness models are **not** synced from agent reports. `syncHarnessModels()` skips `harnessName === 'claude'`.

**Why:** Claude CLI has no `claude debug models` equivalent. The model list is maintained manually in `ANTHROPIC_MODELS` (server.js). Owners add unreleased models via `POST /api/settings/custom-models` (Settings > Platforms > claude models card).

**Implication:** After Anthropic releases a new model, the owner must add it manually. Existing models never auto-disappear from the list.

---

### 5. Custom Claude Models: Format Constraint
**Constraint:** IDs must match `^claude-[a-z0-9][a-z0-9.-]{1,62}$`. Max 20 entries. Stored in `settings` table under key `custom_claude_models` as JSON.

**Why:** The regex mirrors Anthropic's naming convention and is enforced both client-side (`S_CUSTOM_MODEL_RE`) and server-side (`CUSTOM_CLAUDE_MODEL_RE`). Consistent constraint avoids surprises when the model ID is passed as `--model` to the CLI.

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

**Implementation:** `matchAgentRoute(method, pathname)` in `lib/agent-scope.js` returns `{scope, id}` or null. Scope checks are: `room` (participant check), `self` (actor id match), `sub-agent` (ownership), `connection` (automation feed), `automation` (automation targets agent's room), `any` (valid agent sufficient). Non-matching requests → `403 {error:'agent_scope_denied'}` + one log line.

**Escape hatch:** `STOA_AGENT_SCOPE=off` on server (warning logged at boot). Not gated by request headers — cannot be spoofed.

**Implication:** Do not flag `requireAuth` agent bypass as "agent has full access" — that was closed in R21. When auditing, check `lib/agent-scope.js` for allowlist coverage instead.

### Agent Automation Access (R21 extension — PR #171)
**Decision (owner):** Agents can create, update, and delete automations, but only targeting rooms they are participants of. Scope `automation` was added to cover PATCH/DELETE by automation id.

**Rationale:** Workspace owner explicitly requested this so agents can set up automations on their behalf (e.g., "Ara, create an automation for email from client X"). Alternative (session-only) would require the human to do it manually.

**Risk mitigation:**
- `target_room_id` is validated against participant membership on POST and PATCH — an agent cannot create or move an automation to a room it doesn't belong to.
- `GET /api/automations/connections` strips credential/token fields; agents receive only `id`, `name`, `provider`, `status`.
- Every agent create/update/delete posts a permanent system message in the target room (suffix `· automation`) — the owner sees all changes live and can revoke them.
- Connection create/edit/delete, test-email, and Slack connect remain session-only (human login required); agents cannot touch credentials.

**Do not flag** the automation routes in `lib/agent-scope.js` as "agents have admin automation access" — the handler-level participant check is the enforcement layer, not scope alone.

---

### MCP Gateway — Token Without TTL (design decision, PR #186 audit INFO 2)
**Decision:** MCP session tokens have no expiry (revoked only when agent/sub-agent/room deleted).

**Rationale:** A token with TTL would expire mid-session, forcing a new token to be injected into the agent's env. Changing env causes session restart (`needsEnvChange` check in `stoa.js`), violating session persistence. Token lives only in agent process env (never in argv, never in API responses), scoped to `(actor, room, thread, sub_agent)`, stored as SHA-256 hash.

**Audit note:** Do not flag as "no TTL = infinite validity". The token cannot be extracted from the process env of a running agent by any API. If the agent process is compromised, the token is only useful for that agent's own MCP scope — no cross-room or cross-agent access.

---

### MCP Gateway — No Private IP Blocklist on HTTP Upstream URL (design decision, PR #186 audit INFO 1)
**Decision:** `validateUrl` in `lib/mcp-upstreams.js` checks protocol (http/https) and embedded credentials only — does not block private/internal IP ranges.

**Rationale:** Owner-only endpoint; single-user system. Connecting to `localhost` or LAN addresses is a legitimate use case (local MCP server). Note is marked "Not a finding." inline in `lib/mcp-upstreams.js`.

**Audit note:** If Stoa becomes multi-user, add SSRF protection (private IP blocklist + DNS rebinding guard). For now, do not flag.

---

### MCP Tool Output — Prompt Injection Risk
**Risk:** Tool results (e.g., Slack messages, Notion page content) are injected into the agent's context. A crafted document could attempt to hijack the agent.

**Mitigations in place:**
- `requires_approval` flag for write tools (owner reviews before execution)
- Rate limit per tool to cap blast radius
- `args_preview` in `mcp_calls` is redacted (keys containing token/secret/password → `***`)
- Owner can disable individual tools or entire servers instantly

**Implication:** High-trust MCP servers (read-only Notion, documentation lookups) are low risk. Write-capable servers (GitHub PR creation, Slack messages) should always have `requires_approval` or strict access policy.

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

### 7. Hybrid Search — Local Embeddings, Best Effort
**Decision:** Semantic search uses a local ONNX model (`Xenova/multilingual-e5-small` q8 via optional dependency `@huggingface/transformers`), never a paid API. Brute-force cosine over an in-memory index in a worker thread (`lib/semantic-worker.js`); no vector extension. GET /api/search `mode=hybrid` (default) fuses FTS + vector ranks with RRF; `match` = keyword|semantic|both; header `X-Stoa-Search-Semantic: 1|0`.

**Why:** Owner rejects pay-as-you-go APIs. 25k messages × 384 floats ≈ 40 MB, query 5–120 ms on M4.

**Implications / gotchas:**
- Semantic is best effort: model loading/failed/missing dependency/`STOA_SEMANTIC_SEARCH=off`/4 s timeout → keyword result, still 200. Status: GET /api/search/status.
- First start downloads ~130 MB into `models/` (`STOA_MODEL_DIR`, gitignored); full backfill of ~26k messages ≈ 25 min at ~1 core (sleeps as long as each batch took). Server+worker RSS ≈ 600 MB while backfilling.
- Never `worker.terminate()` the embedding worker while it is inferring: onnxruntime-node aborts the whole process (`libc++abi: Napi::Error`). It is only terminated after it reports `fatal` (idle). Plain process exit is fine.
- e5 cosine scores are tightly packed (relevant ≈ 0.86, unrelated ≈ 0.80): no absolute threshold; semantic hits below best − 0.05 are dropped, max 20.
- Tests run with `STOA_SEMANTIC_BACKEND=hash` (set by run-tests.js): deterministic trigram hashing, no model. Keyword tests pin `mode=keyword`, because backfill timing would flip `match` between keyword and both. Real-model quality is not covered by automated tests (needs the 130 MB download) — measured manually, see ~/project/stoa-feature/search-hybrid.md.

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
