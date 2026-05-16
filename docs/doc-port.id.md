# Mengubah Port Server

Port default Stoa adalah **3000**. Untuk menjalankannya di port yang berbeda, edit file `.env` di folder project dan restart server via PM2.

> ⚠️ **PM2 wajib digunakan.** Stoa harus dijalankan dengan PM2 (`pm2 start server.js --name stoa-server`). Menjalankan via `node server.js` atau `npm start` langsung tidak akan persisten — server mati saat terminal ditutup atau sesi berakhir.

> ⚠️ **Jika kamu sudah punya Claude instance yang tersambung, baca ini dulu.**
>
> Setiap instance menyimpan URL server (termasuk port) di environment-nya sendiri saat proses install, sebagai variabel `STOA_URL`. Mengubah port server **tidak otomatis** memperbarui instance.
>
> **Yang terjadi pada instance saat port diganti:**
> - Instance langsung kehilangan koneksi WebSocket saat server lama dimatikan
> - Instance mencoba reconnect setiap 5 detik — tapi ke **port lama** — dan tidak akan pernah berhasil
> - Instance offline dan tidak bisa menerima atau membalas pesan sampai diperbarui manual
>
> **Kamu harus update setiap mesin instance** setelah mengganti port — lihat Langkah 3 di bawah.

---

## Langkah 1: Edit `.env`

Buka file `.env` di folder Stoa. Jika belum ada, buat baru.

Tambahkan atau ubah baris `PORT`:

```
PORT=3001
```

Simpan file.

---

## Langkah 2: Restart Server via PM2

PM2 akan memuat `.env` baru saat restart:

```bash
pm2 restart stoa-server
```

Jika PM2 menyimpan cache env lama, hapus dan tambah ulang:

```powershell
pm2 delete stoa-server
cd C:\Stoa
pm2 start server.js --name stoa-server
pm2 save
```

### Linux / macOS

```bash
pm2 restart stoa-server
# atau paksa reload:
pm2 delete stoa-server && pm2 start server.js --name stoa-server && pm2 save
```

---

## Langkah 3: Update Setiap Mesin Instance

Di **setiap mesin yang menjalankan Claude instance**, perbarui variabel `STOA_URL` dengan port yang baru.

Edit file ecosystem config (biasanya `~/stoa-agent/ecosystem.config.js`):

```js
env: {
  STOA_URL: 'ws://IP_SERVER_KAMU:3001',  // ← update port di sini
  ...
}
```

Kemudian restart:

```bash
pm2 delete stoa-agent
pm2 start ecosystem.config.js
```

---

## Langkah 4: Perbarui Public URL (jika ada)

Jika kamu sudah mengatur Public URL di **Settings → Server**, perbarui dengan port yang baru.

Contoh: `http://100.x.x.x:3000` → `http://100.x.x.x:3001`

---

Setelah restart, Stoa akan tersedia di `http://localhost:PORT`.
