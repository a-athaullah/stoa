# Menghubungkan Slack ke Stoa Automation

Stoa terhubung ke Slack melalui **Socket Mode** — koneksi WebSocket outbound. Tidak perlu URL publik atau port yang dibuka.

Kamu butuh dua token: **App Token** (untuk koneksi WebSocket) dan **Bot Token** (untuk membaca pesan).

---

## Langkah 1 — Buat Slack App

1. Buka [https://api.slack.com/apps](https://api.slack.com/apps) dan klik **Create New App**
2. Pilih **From scratch**
3. Masukkan nama app (misal: `Stoa`) dan pilih workspace kamu
4. Klik **Create App**

---

## Langkah 2 — Aktifkan Socket Mode

1. Di sidebar kiri, klik **Socket Mode**
2. Toggle **Enable Socket Mode** ke **On**

---

## Langkah 3 — Dapatkan App Token

1. Buka **Settings → Basic Information**
2. Scroll ke bawah ke bagian **App-Level Tokens**
3. Klik **Generate Token and Scopes**
4. Beri nama (misal: `stoa-socket`)
5. Tambah scope: `connections:write`
6. Klik **Generate** — copy token yang dimulai dengan `xapp-1-`

---

## Langkah 4 — Tambah Bot Scopes

1. Di sidebar kiri, klik **OAuth & Permissions**
2. Di bagian **Bot Token Scopes**, tambahkan:
   - `app_mentions:read` — membaca mention ke bot
   - `channels:history` — membaca pesan di channel
   - `users:read` — mengambil nama display user

---

## Langkah 5 — Subscribe ke Events

1. Di sidebar kiri, klik **Event Subscriptions**
2. Toggle **Enable Events** ke **On**
3. Di bagian **Subscribe to bot events**, tambahkan:
   - `app_mention` — saat bot di-mention
   - `message.channels` — pesan di channel publik

---

## Langkah 6 — Install App ke Workspace

1. Di sidebar kiri, klik **OAuth & Permissions**
2. Klik **Install to Workspace** (atau **Reinstall** jika sudah pernah)
3. Setujui permissions
4. Copy **Bot User OAuth Token** yang dimulai dengan `xoxb-`

---

## Langkah 7 — Invite Bot ke Channel

Bot adalah entitas terpisah dari akun kamu. Meskipun kamu sudah ada di channel, bot tetap harus di-invite secara terpisah.

Di setiap channel Slack yang ingin dipantau, ketik:

```
/invite @namabot
```

Ganti `namabot` dengan nama bot yang kamu buat (misal: `/invite @Stoa`).

---

## Langkah 8 — Hubungkan di Stoa

1. Buka Stoa → **Settings → automation**
2. Klik **Connect Slack**
3. Paste App Token (`xapp-1-...`) dan Bot Token (`xoxb-...`)
4. Klik **Connect** — Stoa akan verifikasi koneksi dan menampilkan nama workspace

Setelah terhubung, kamu bisa menambahkan automation rules yang dipicu oleh event Slack.

---

## Catatan: Reinstall setelah ubah permissions

Setiap kali kamu menambah atau mengubah Bot Token Scopes, Slack akan meminta reinstall. Di halaman **OAuth & Permissions** akan muncul banner kuning — klik **Reinstall to Workspace** dan approve. Bot Token tidak berubah, hanya permission yang diperbarui.
