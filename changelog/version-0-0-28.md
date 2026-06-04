# v0.0.28 — 2026-06-04

🔧 Bug fixes & improvements

## Changes

- changelog: 2026-06-04 release notes
- add describe_image vision tool, thinking mode toggle for Ollama, fix attachment-only message content
- sync Ollama backend to JA/KO/ZH docs
- expand tests: 26 pure unit tests + 22 new integration tests, 80 total
- stoa-audit: fix schema drift, add Ollama to docs, add integration tests
- fix done button stays disabled after selecting Ollama model in add agent flow
- hide compact button when room has no Claude agent
- add tool use (bash, read_file, write_file, list_dir, grep, http_get, web_search) to ollama-session.js
- fix actor_status broadcast: include adapter and adapter_config fields
- fix Ollama setup slip: skip early sFinishSetupSlip calls, let agent_scan_complete trigger after capabilities are in DB
- move add agent button below header, above agent list
- separate human actor into own section, AI agents in separate card sorted descending
- redesign edit agent as accordion panel, sort agents descending, add reinstall command slip
- fix Ollama setup: send capabilities before scan result, guard double-call in sFinishSetupSlip
- fix race condition in sFinishSetupSlip: lookup actor from settingsActors first
- ollama setup: show model picker before enabling done button
- add edit agent settings panel and Ollama model discovery
- add persistent chat history for Ollama agent via rawHistory in agent_trigger
- rename Ollama dropdown label: 'Ollama (local)' → 'Ollama'
- add Ollama option to invite-agent UI and install scripts
- add Ollama backend integration (ollama-session.js)
