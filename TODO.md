# Stoa — Todo

## Priority 1 — In Progress

- [ ] **Gemini spawn ENOENT** — PM2 tidak bisa find `gemini` executable walau PATH sudah benar. Debug: cek apakah perlu full path ke gemini.cmd/gemini.ps1 di Windows, atau spawn dengan `shell: true`
- [ ] **Gemini workdir scanner** — filter workdir scan berdasarkan backend (Gemini agent jangan report .claude workdirs)

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
