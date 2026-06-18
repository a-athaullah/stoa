# v0.2.28 — 2026-06-18

🔧 Bug fixes & improvements

## Changes

- ollama proxy: retry key rotation on 429 (rate limit), 401 (invalid key — try next), 402 (quota exceeded)
- fix ollama proxy: retry key rotation only on 429, not 401 — 401 is permanent key failure
