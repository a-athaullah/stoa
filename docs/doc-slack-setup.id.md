# Menghubungkan Slack ke Stoa Automation

Stoa terhubung ke Slack melalui **Socket Mode** — koneksi WebSocket outbound. Tidak perlu URL publik atau port yang dibuka.

Kamu butuh dua token: **App Token** (untuk koneksi WebSocket) dan **User Token** (untuk menerima events dari channel-channelmu).

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
3. Di dialog yang muncul, beri nama token (misal: `stoa-listener`)
4. Scope `connections:write` sudah otomatis — klik **Generate**
5. Copy token yang dimulai dengan `xapp-1-` (ini **App Token**)

---

## Langkah 3 — Tambah User Token Scopes

1. Di sidebar kiri, klik **OAuth & Permissions**
2. Scroll ke bagian **User Token Scopes** (bukan Bot Token Scopes)
3. Tambahkan scope berikut:
   - `channels:history` — membaca pesan di channel publik
   - `channels:read` — membaca info channel
   - `groups:history` — membaca pesan di **private channel**
   - `im:history` — membaca pesan DM

---

## Langkah 4 — Subscribe ke User Events

1. Di sidebar kiri, klik **Event Subscriptions**
2. Toggle **Enable Events** ke **On**
3. Scroll ke bagian **Subscribe to events on behalf of users** (bukan "bot events")
4. Klik **Add Workspace Event** dan tambahkan:
   - `message.channels` — pesan di channel publik yang kamu ikuti
   - `message.groups` — pesan di **private channel** yang kamu ikuti
   - `message.im` — pesan DM yang kamu terima
5. Klik **Save Changes**

---

## Langkah 5 — Install App ke Workspace

1. Di sidebar kiri, klik **Install App**
2. Klik **Install to Workspace** (atau **Reinstall** jika sudah pernah)
3. Setujui permissions
4. Copy **User OAuth Token** yang dimulai dengan `xoxp-`

---

## Langkah 6 — Invite Bot ke Channel (opsional)

Dengan pendekatan User Token, bot **tidak perlu di-invite** ke channel — events datang langsung dari channel yang kamu (user) sudah ada di dalamnya.

---

## Langkah 7 — Hubungkan di Stoa

1. Buka Stoa → **Settings → automation**
2. Klik **Connect Slack**
3. Paste **App Token** (`xapp-1-...`) dan **User Token** (`xoxp-...`)
4. Klik **Connect** — Stoa akan verifikasi koneksi

Setelah terhubung, kamu bisa menambahkan automation rules yang dipicu oleh event Slack.

---

## Catatan: Reinstall setelah ubah permissions

Setiap kali kamu menambah atau mengubah User Token Scopes, Slack meminta reinstall. Di halaman **Install App** klik **Reinstall to Workspace** dan approve. User Token tetap sama; hanya permission yang diperbarui.
