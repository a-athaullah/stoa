# Stoa — Todo

## Priority 1 — Before Public Release

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

## Priority 2 — Post-Release Roadmap

- [x] **Thread/reply** — reply-to any message, quote ditampilkan di bubble, context dikirim ke AI prompt
- [ ] **Multi-model support** — sekarang locked ke Claude, harusnya pluggable (OpenAI, Gemini, local LLM)
- [ ] **Export/backup UI** — raw SQLite udah bisa di-copy, tapi butuh proper export (JSON, markdown)
- [ ] **Notification system** — beyond unread count, push notification / desktop notification

## Trash

- **Semantic search** — butuh AI embeddings (tidak mekanis), FTS5 keyword search sudah cukup
- **Role/permission system** — personal tools, belum ada flow user management yang jelas
- **Read receipts** — human + multiple AI, konsep "read" tidak relevan
- **Proper auth** — belum ada plan membuat user management
- **Plugin/extension system** — agent sendiri sudah jadi "plugin", premature tanpa use case konkret
