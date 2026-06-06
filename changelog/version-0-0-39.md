# v0.0.39 — 2026-06-06

🔧 Bug fixes & improvements

## Changes

- polish pin button: double-tap guard, error early-return, extract SVG helper
- fix test wrong-secret expect 401, remove dead archived swipe CSS rule
- fix test: wrong secret returns 401 from auth middleware, not 403
- Revert "fix: pin idempotent — no broadcast if already pinned"
- fix: pin idempotent — no broadcast if already pinned
- fix: pin button on mobile swipe — matches archive button pattern
- chore: add pre-commit hook — docs sync guard for guide-usage 5 languages
- docs: sync JA/KO/ZH with EN/ID — 7 missing items from Ara audit
- test: add pin/unpin endpoint tests (4 cases)
- fix: fresh participants per-iteration, always broadcast pin state
- fix: query allAiInRoom per-iteration — prefetch only immutable context
- fix: POST workdirs — preserve existing label when label not provided in request
- fix: POST workdirs — allow label clear, return model in response
- perf: hoist allAiInRoom query out of agent loop; sync Messages settings docs to JA/KO/ZH
- fix: workdir label update on duplicate path — INSERT ON CONFLICT DO UPDATE
- fix: POST /api/actors/:id/workdirs return correct id on duplicate path
- fix: wrap proactive test setup in try/catch, merge pin WS handlers
- fix: unpin idempotent, pinBtn re-enable on network outage
- fix: pin button re-enables on error, unpin guards archived, re-pin idempotent no broadcast
- fix: archive clears is_pinned, count filters archived, pin button in-flight guard, refreshRoomList fallback
- fix: invite resolve test — correct actor_id body field, pass session cookie to WS
- fix: pin handler — transaction, existence check, archived guard, merge pinRoom/unpinRoom
- fix: invite resolve test — correct endpoint and WS type, remove dead variable
- perf: pre-fetch shared room data once per trigger cycle, not per agent
- stoa-audit: add missing index, fix Gemini model badge docs (all 5 langs)
- stoa-audit: add tests for avatar, invite approve, and slack disconnect
- stoa-audit: add PATCH /api/actors/:id rename tests
- test: isolate all write ops in dedicated test rooms, fix proactive message coverage
- stoa-audit: schema drift fix, pin room tests, pin room docs (all 5 langs)
