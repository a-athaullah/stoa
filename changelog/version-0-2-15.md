# v0.2.15 — 2026-06-18

🔧 Bug fixes & improvements

## Changes

- add ollama cloud proxy to changelog
- exempt /v1/messages from auth guard — claude code sdk calls without browser cookie
- log ollama proxy hits — model + upstream status for verifying agent routes through proxy not local daemon
- route vendor=ollama models through stoa proxy in agent trigger — base_url points to stoa /v1/messages, keys injected server-side
- save cached_models after ollama cloud discover — models now persist on reload
- probe each ollama cloud model via /v1/messages instead of marking all usable
- handle ollama vendor in discover-models and health — bypass base_url, fetch direct from ollama.com
- add platform type dropdown in Add Platform form (Custom vs Ollama Cloud)
- add ollama cloud proxy endpoint POST /v1/messages with key rotation
- auto-detect ollama daemon via /api/version before fetching cloud catalog
- rename custom platform vendor from ollama to custom, free ollama vendor for Ollama Cloud
- fix: working directory management — tilde expansion, error states, ghost row cleanup, basename disambiguation (#11)
