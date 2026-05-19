# Stoa — Todo

## Priority 2 — In Progress

- [ ] **Gemini model detection** — detect configured model for Gemini CLI workdirs (saat ini hanya Claude yang ter-detect via `.claude/settings.json`)

## Priority 3 — High Impact

- [ ] **Multi-model support (lanjutan)** — adapter tambahan selain Claude & Gemini:
  - [ ] OpenAI API adapter (via API key langsung)
  - [ ] Ollama adapter (local LLM, self-hosted)
  - [ ] LiteLLM proxy support (unified interface)
- [ ] **Webhook/API** — HTTP endpoint untuk trigger agent dari external (CI/CD, monitoring, script)

## Priority 4 — Enhancement

- [ ] **Agent config via UI** — tambah/manage agent dari browser tanpa CLI
- [ ] **Context window indicator** — notifikasi ketika conversation mendekati batas context window

## Trash

- **Semantic search** — FTS5 keyword search sudah cukup, AI embeddings overkill
- **Role/permission system** — personal tool, premature tanpa multi-tenant use case
- **Read receipts** — human + multiple AI, konsep "read" tidak relevan
- **Plugin/extension system** — agent sendiri sudah jadi "plugin", premature tanpa use case konkret
- **Native mobile app** — PWA sudah cukup untuk sekarang
