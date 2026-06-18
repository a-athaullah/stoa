# v0.2.27 — 2026-06-18

🔧 Bug fixes & improvements

## Changes

- fix ollama proxy: retry key rotation only on 429, not 401 — 401 is permanent key failure
