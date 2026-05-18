# Stoa — Todo

## Priority 1 — Done

- [x] **Invite participant UI** — UI add participant di room header
- [x] **Mention system** — @mention autocomplete, warna di bubble, agent-to-agent mention chain
- [x] **AI file sending** — agent kirim file via `[send:path]` marker, inline image untuk gambar
- [x] **Agent self-healing** — WS reconnect dengan exponential backoff, Claude crash recovery
- [x] **Search UI** — FTS5 full-text search, search bar di sidebar, snippet highlight, navigate to message
- [x] **README & docs** — orang open source judge dari README pertama, harus solid (setup, architecture, screenshots)
- [x] **Mobile responsive** — sudah works di mobile
- [x] **Copy message** — tombol copy di setiap message bubble (hover action)
- [x] **Drag & drop upload** — drag file/image ke composer langsung upload
- [x] **Composer formatting** — htmlToMarkdown rewrite, hyperlink paste, code block exit, semua format support
- [x] **Thread/reply** — reply-to any message, quote ditampilkan di bubble, context dikirim ke AI prompt

## Priority 2 — Done

- [x] **Basic auth** — session cookie + scrypt hash, protect semua route (default: stoa@stoa.com / stoa2026!)
- [x] **Push notification** — browser desktop notification saat agent respond di room lain
- [x] **Export conversation** — download room history sebagai JSON atau CSV dari header room

## Priority 3 — High Impact

- [ ] **Multi-model support** — abstraksi adapter layer untuk non-Claude models:
  - [ ] OpenAI API adapter (via API key langsung)
  - [ ] Gemini CLI/API adapter
  - [ ] Ollama adapter (local LLM, self-hosted)
  - [ ] LiteLLM proxy support (unified interface)
- [ ] **Export conversation** — ~~export room history ke JSON dan/atau Markdown~~ (moved to Priority 2 — done)
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
