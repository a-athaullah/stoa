# v0.1.0 — 2026-06-10

✨ New features

## Changes

- update changelog and readme for multi-platform AI models
- simplify to ollama-only vendor, remove generic code path and vendor dropdown
- remove catalog_url field, hardcode ollama.com/v1 for ollama vendor discover
- add vendor field to platforms, ollama discover fetches cloud catalog and probes via localhost with :cloud suffix
- stream discover-models progress via ndjson, show live progress bar in platform form
- fix ollama cloud base url placeholder from api.ollama.com to ollama.com (api. subdomain returns 401)
- add discover-models endpoint: probe each model with real chat call, keep only working ones
- sort models by name asc within each platform group in model dropdown
- auto-capture API key from input field on save (don't require clicking +)
- show full API keys in platform edit form, remove masking from GET and UI
- include .claude in work directory tree (remove from WS_IGNORE)
- show hidden files and folders in work directory tree
- disable browser autofill on platform form fields
- add base URL examples hint below input field
- move add platform button outside card like AI agent, simplify key add button to + icon
- improve API keys UX — chip/pill pattern with add button instead of textarea
- add platform health check, model discovery, multi-key rotation, mask keys in API response
- update platform form placeholders to Ollama Cloud defaults
- update guide-usage docs (EN, ID, JA, ZH) for multi-platform AI models
- sync ZH usage guide with multi-platform AI models changes
- update Korean usage guide for multi-platform AI models
- remove Anthropic from platform list — Claude is built-in, not a configurable platform
- resolve platform api_key server-side from settings, never expose to client
- add platforms settings tab UI, fetch models from API, remove Gemini/Ollama UI remnants
- add AI platform CRUD API endpoints and model list endpoint
- remove gemini-adapter import, clean install scripts from multi-backend branching
- remove query_model handler and readModel from workdir scan — model source is rooms.model only
- update frontend model dropdown to be dynamic, remove Gemini/Ollama session UI remnants, bump client v0.4.0
- remove OllamaSession, GeminiSession, GeminiAdapter — all platforms now via ClaudeSession
- add platform env vars plumbing — server sends base_url/api_key, agent passes to claude spawn
- remove ALLOWED_CLAUDE_MODELS validation and agent_workdirs.model references from server
- remove agent_workdirs.model column — rooms.model is single source of truth
- add per-room automation queue system
- show token plain text in edit connection form
- show existing tokens pre-filled in edit connection form
- show delete button on error state connections
- add multi-connection Slack pool for automations
- feat: configurable auto-compact threshold
- feat: migration system + model switching (#5)
- pin room: pin up to 5 rooms to sidebar top (#4)
- fix: call ack() in all Slack Socket Mode event handlers
