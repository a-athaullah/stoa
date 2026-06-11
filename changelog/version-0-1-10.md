# v0.1.10 — 2026-06-11

🔧 Bug fixes & improvements

## Changes

- fix room_model_changed WS handler — update custom dropdown instead of removed #model-select
- rebuild minified assets
- document tools requirement in Ollama guide — 5 languages
- filter out models without tools support from discover — unusable with Claude CLI adapter
- add hover tooltips to capability icons — Vision, Tools, Local model
- add tests for fetchModelList, fetchOllamaCloudModels, probeCapabilities edge cases
- rebuild minified assets
- fix local model detection — try /api/tags first for remote_model filtering
- filter cloud models from local fetch — use remote_model field from Ollama API
- preserve enabled_models selection on re-discover — prune stale, keep existing
- add local model indicator — HDD icon from discover source, not name suffix
- fix model dropdown background opacity — use solid bg color
- custom model dropdown with SVG capability icons per option
- dual-fetch discover: local models from base_url + cloud models from ollama.com
- fix fetchModelList: fallback to /v1/models for raw Ollama base URLs
- replace emoji with SVG capability icons in settings + clean up model selector text
- add tools capability detection + SVG capability badges on model selector
- fix disabled-platform silent mis-route + extract shared platform helpers + unify model list
- fix compact: SessionClass crash + increase timeout to 10min
- use theme ink color for selected radio indicator in new room dialog
- replace radio button with custom filled circle indicator in new room dialog
- fix test cleanup: pre-cleanup stale __test* actors at start of each run
- add multi-machine Ollama setup guide with OLLAMA_HOST=0.0.0.0 for Tailscale access
- add Ollama setup guide and update platform docs
- rebuild minified assets
- fix populateModelDropdown crash when called without sel argument
- fix health stale write + missing :cloud suffix, stale base_url priority, set_room_model cached_models check
- fix set_room_model null enabled_models, discover-models stale write, fetchPlatformModels race
