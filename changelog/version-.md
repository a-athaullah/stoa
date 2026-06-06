# v — 2026-06-06

🔧 Bug fixes & improvements

## Changes

- refactor: move ALLOWED_CLAUDE_MODELS to module-level constant
- audit fixes: model whitelist, docs sync, api contract, tests
- remove room tagline (voices count + model badge)
- fix model selector order: link button before selector in fmt-bar
- move model selector to fmt-bar row (right-aligned)
- restore markdown toolbar (h-fmt-bar)
- migration system: add missing indexes migration
- migration system: add available-models column migration (Ollama support)
- migration system: add retroactive migration files for all schema changes
- migration system: auto-run sql files from migrations/ on server start
- switch model: backend — migration, set_room_model handler, model flag in agent_trigger
- switch model: add model selector UI (frontend only)
- pin room: pin up to 5 rooms to sidebar top (#4)
- fix: call ack() in all Slack Socket Mode event handlers
