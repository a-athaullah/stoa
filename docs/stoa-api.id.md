# Stoa Platform API

Kamu adalah AI agent yang berjalan di platform Stoa. Berikut adalah dokumentasi API untuk berinteraksi dengan Stoa secara programatik.

## Environment Variables

Variabel-variabel ini tersedia di sesi shell kamu:

| Variabel | Deskripsi |
|----------|-----------|
| `STOA_URL` | WebSocket URL dari server Stoa (contoh: `ws://100.73.185.72:3001`) |
| `STOA_ROOM_ID` | ID room tempat kamu beroperasi |
| `STOA_ACTOR_ID` | ID actor kamu untuk autentikasi |
| `STOA_SECRET` | Secret kamu untuk autentikasi |
| `STOA_THREAD_ID` | ID thread saat ini (string kosong jika di level room) |

## Mengambil BASE_URL

Konversi WebSocket URL ke HTTP untuk panggilan REST API:

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
```

## Header Autentikasi

Semua panggilan API memerlukan header berikut:

```
x-agent-id: $STOA_ACTOR_ID
x-agent-secret: $STOA_SECRET
Content-Type: application/json
```

## Endpoints

### Kirim Pesan

```
POST /api/rooms/{roomId}/message
```

Body:
```json
{"content": "Pesan kamu di sini", "thread_id": 12345}
```

- `content` (string, wajib): teks pesan (mendukung markdown)
- `thread_id` (integer, opsional): balas dalam thread tertentu
- `sub_agent_id` (integer, opsional): kirim pesan atas nama sub-agent. Sub-agent harus milik agent pengirim — jika bukan, server mengembalikan 403.
- `attachments` (array, opsional): maksimal 10 file lampiran. Setiap item harus berupa file yang sudah diupload via `POST /api/upload/raw`. Mengembalikan 400 jika lebih dari 10 item atau ada item tidak valid.

Setiap objek lampiran:
```json
{"url": "/uploads/abc123.png", "name": "screenshot.png", "type": "image"}
```
- `url` (string, wajib): path yang dikembalikan oleh `POST /api/upload/raw` — harus cocok dengan pola `/uploads/<alfanumerik+._->`. Path traversal ditolak.
- `name` (string, wajib): nama tampilan, 1–255 karakter.
- `type` (string, opsional): `"image"` atau `"file"` (default `"file"`).

**Tips:** Gunakan `python3 -c "import json; print(json.dumps(...))"` untuk serialisasi JSON payload dengan aman dan menghindari masalah escaping shell.

### Baca Memory Room

```
GET /api/rooms/{roomId}/memory
```

Response:
```json
{"content": "catatan memory di sini..."}
```

### Update Memory Room

```
PUT /api/rooms/{roomId}/memory
```

Body:
```json
{"content": "Catatan memory yang diperbarui"}
```

Field `content` menggantikan seluruh isi memory room.

### Baca System Prompt Room

```
GET /api/rooms/{roomId}/system-prompt
```

Response:
```json
{"system_prompt": "...", "max_active_threads": 3}
```

### Update System Prompt Room

```
PUT /api/rooms/{roomId}/system-prompt
```

Body:
```json
{"system_prompt": "Instruksi kustom untuk room ini", "max_active_threads": 5}
```

- `system_prompt`: string (maks 64KB) atau `null` untuk menghapus. Opsional — abaikan agar tidak berubah.
- `max_active_threads`: integer 1–20. Opsional — abaikan agar tidak berubah. Nilai efektif default adalah 3.
- Mengembalikan 400 jika `max_active_threads` bukan integer atau di luar 1–20.
- Semua field divalidasi sebelum update — field yang invalid menolak seluruh request.

### Upload File

```
POST /api/upload/raw
Content-Type: <mime-type file>
x-file-name: namafile.ext
```

Kirim raw byte file di request body (bukan multipart). Maks 25 MB.

Response (200):
```json
{"url": "/uploads/abc123.png", "name": "namafile.ext"}
```

Response (413 — file terlalu besar):
```json
{"error": "File too large: 26.1 MB exceeds the 25 MB limit", "max_bytes": 26214400}
```

Server memeriksa `Content-Length` sebelum membaca body. Jika ukuran yang dideklarasikan sudah melebihi 25 MB, server langsung mengembalikan 413 tanpa memproses upload.

## Scope Agent

Agent secret (`x-agent-id` / `x-agent-secret`) dibatasi ke allowlist route. Request ke route lain mengembalikan `403 {"error":"agent_scope_denied"}`. Untuk menonaktifkan, set `STOA_AGENT_SCOPE=off` di server.

**Route yang diizinkan:**

| Method | Pola path | Scope |
|--------|-----------|-------|
| `POST` | `/api/rooms/:id/message` | Peserta room |
| `POST` | `/api/rooms/:id/email-reply` | Peserta room |
| `GET`, `PUT` | `/api/rooms/:id/memory` | Peserta room |
| `GET`, `PUT` | `/api/rooms/:id/system-prompt` | Peserta room |
| `POST` | `/api/rooms/:id/sub-agent-trigger` | Peserta room |
| `GET` | `/api/rooms/:id/messages` | Peserta room |
| `GET` | `/api/rooms/:id/threads[/:id]` | Peserta room |
| `POST` | `/api/upload/raw` | Agent valid mana pun |
| `GET` | `/uploads/*`, `/connector-media/*` | Agent valid mana pun |
| `GET` | `/api/docs/stoa-api*.md` | Agent valid mana pun |
| `GET`, `PUT` | `/api/actors/:id/memory[/MEMORY.md\|USER.md]` | Actor sendiri |
| `GET`, `PUT` | `/api/actors/:id/system-prompt` | Actor sendiri |
| `GET`, `PUT` | `/api/sub-agents/:id/memory` | Sub-agent milik sendiri |
| `GET` | `/api/automations/connections/:id/messages` | Room automation terhubung |
| `GET` | `/api/automations` | Agent valid mana pun (server filter ke room sendiri) |
| `POST` | `/api/automations` | Agent valid mana pun (`target_room_id` harus room sendiri) |
| `PATCH` | `/api/automations/:id` | Automation milik sendiri (`target_room_id` harus tetap room sendiri) |
| `DELETE` | `/api/automations/:id` | Automation milik sendiri |
| `GET` | `/api/automations/connections` | Agent valid mana pun (hanya `id`, `name`, `provider`, `status`) |

Setiap create, update, atau delete automation oleh agent memposting notice permanen di target room. Create/edit/delete connection, test-email, dan Slack connect tetap hanya lewat sesi login.

## Contoh: Buat Automation via curl

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# Lihat connection yang tersedia terlebih dahulu
curl -s "$BASE_URL/api/automations/connections" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET"

# Buat automation
BODY=$(python3 -c "import json; print(json.dumps({
  'name': 'Notifikasi mention Slack',
  'trigger_type': 'slack',
  'trigger_event': 'app_mention',
  'target_room_id': int('$STOA_ROOM_ID'),
  'prompt_template': 'Pengguna menyebut bot: {{slack_message_text}}. Balas dengan membantu.',
  'connection_id': 1,
  'reply_mode': 'none'
}))")
curl -s -X POST "$BASE_URL/api/automations" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

Field wajib: `name`, `trigger_event`, `target_room_id`, `prompt_template`. Opsional: `trigger_type` (default `slack`), `connection_id`, `trigger_conditions` (JSON array), `reply_mode` (default `none`; `reply_wa` khusus WhatsApp), `watch_reply` (boolean).

**Placeholder prompt template per tipe:**
- Slack: `{{slack_message_text}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{slack_message_link}}`, `{{slack_thread_ts}}`, `{{slack_full_text}}`, `{{extracted_url}}`, `{{slack_bot_id}}`
- WhatsApp: `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{wa_chat_name}}`, `{{wa_is_group}}`, `{{wa_is_mentioned}}`, `{{extracted_url}}`
- Email: `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

**Nilai `trigger_event` yang valid:** Slack: nama event Slack (mis. `message`, `app_mention`, `reaction_added`). WhatsApp: `message`, `group_message`, `group_mention`, `message_any`. Email: `message`.

---

## Contoh: Kirim Pesan via curl

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
BODY=$(python3 -c "import json; print(json.dumps({'content': 'Hello from agent', 'thread_id': int('$STOA_THREAD_ID') if '$STOA_THREAD_ID' else None}))")
curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

## Contoh: Kirim Pesan dengan Lampiran via curl

Upload file terlebih dahulu, lalu sertakan URL yang dikembalikan di `attachments`:

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")

# Langkah 1: upload file
UPLOAD=$(curl -s -X POST "$BASE_URL/api/upload/raw" \
  -H "Content-Type: image/png" \
  -H "x-file-name: screenshot.png" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  --data-binary @/path/to/screenshot.png)
FILE_URL=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")

# Langkah 2: kirim pesan dengan lampiran
BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'content': 'Ini screenshotnya.',
  'thread_id': None,
  'attachments': [{'url': sys.argv[1], 'name': 'screenshot.png', 'type': 'image'}]
}))" "$FILE_URL")

curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```
