# Panduan Setup Browser

Stoa menggunakan fitur browser yang memerlukan izin khusus — terutama saat diakses via HTTP (non-HTTPS) melalui jaringan lokal atau Tailscale. Panduan ini mencakup cara mengaktifkan **Voice Input**, **Push Notification**, dan **Add to Home Screen (PWA)** di desktop dan mobile.

---

## Voice Input (Speech-to-Text)

Stoa punya tombol mikrofon bawaan di composer chat. Klik untuk mulai bicara — ucapan Anda ditranskrip secara real-time ke text field. Klik kirim kalau sudah selesai.

### Persyaratan

- **Browser**: Chrome atau Edge (support penuh). Safari support parsial. Firefox terbatas.
- **Koneksi internet**: Chrome menggunakan speech recognition cloud Google di belakang layar.
- **Izin mikrofon**: Browser harus mengizinkan akses mikrofon untuk origin Stoa.

### Mengizinkan Mikrofon di HTTP (Desktop)

Chrome memblokir akses mikrofon di origin non-HTTPS secara default. Jika Anda mengakses Stoa via IP LAN atau Tailscale (misal `http://192.168.1.100:3001`), perlu di-whitelist:

1. Buka tab baru dan buka: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Di text field, masukkan URL Stoa Anda: `http://IP_ANDA:PORT`
3. Set dropdown ke **Enabled**
4. Klik **Relaunch** untuk restart Chrome

Setelah relaunch, Chrome menganggap origin tersebut sebagai secure dan mengizinkan akses mikrofon.

**Tip**: Jika akses Stoa dari mesin yang sama tempat server berjalan, gunakan `localhost:PORT` — Chrome otomatis menganggap localhost sebagai secure origin, tidak perlu flag.

### Mengizinkan Mikrofon di Android (Chrome)

1. Buka Chrome dan buka: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Masukkan URL Stoa Anda (misal `http://192.168.1.100:3001`)
3. Set ke **Enabled** dan tap **Relaunch**
4. Buka Stoa, tap tombol mic — Chrome akan meminta izin mikrofon, tap **Allow**

### Mengizinkan Mikrofon di iOS (Safari)

iOS Safari mendukung speech recognition di secure origin. Untuk akses HTTP:

1. Buka **Settings > Safari > Advanced > Experimental Features**
2. Pastikan **MediaDevices** dan **SpeechRecognition** aktif
3. Saat Stoa meminta akses mikrofon, tap **Allow**

Catatan: iOS Safari mungkin punya dukungan Web Speech API yang terbatas. Untuk pengalaman terbaik, gunakan browser desktop atau Android Chrome.

### Perintah Suara

Saat mikrofon aktif, Anda bisa menggunakan perintah suara tanpa perlu menyentuh layar:

| Bahasa | Kirim | Berhenti | Hapus |
|--------|-------|----------|-------|
| EN | "send now" | "stop listening" | "clear all" |
| ID | "kirimkan sekarang" | "matikan mic" | "hapus semua" |
| JA | "送信して" | "マイク止め" | "全部消して" |
| KO | "지금 보내" | "마이크 끄" | "전부 지우" |
| ZH | "现在发送" | "关闭麦克风" | "全部清除" |

Ganti bahasa dengan tombol **EN/ID/JA/KO/ZH** di samping tombol mic (EN → ID → JA → KO → ZH). Pilihan Anda disimpan.

### Perbedaan Perilaku: Desktop vs Android

Voice input berfungsi di desktop dan Android, tetapi dengan perilaku berbeda karena keterbatasan Chrome Android:

| Perilaku | Desktop (Chrome/Edge) | Android (Chrome) |
|----------|----------------------|-------------------|
| **Mendengar terus-menerus** | Ya — mic tetap aktif tanpa batas | Terbatas — mic mati setelah jeda singkat (~3-7 detik) |
| **Setelah diam** | Mic otomatis restart | Mic mati — tap mic untuk melanjutkan |
| **Teks antar sesi** | Dipertahankan saat restart | Tetap ada di text field — tap mic untuk lanjut |
| **Perintah suara** | Berfungsi selama mic aktif | Berfungsi selama mic aktif (sebelum timeout) |
| **Mic saat AI merespons** | Dibisukan (teks tidak ditulis) | Sama — dibisukan saat processing |

**Kenapa berbeda?** Chrome Android tidak mendukung mode continuous listening dengan benar. Restart otomatis mic di Android menghasilkan bunyi "ding" dan bisa menyebabkan teks terduplikasi. Untuk menghindari masalah ini, Stoa membiarkan mic mati secara alami di Android.

**Tips untuk Android**: Ucapkan seluruh pesan dalam satu kali bicara, lalu ucapkan perintah kirim (misal "kirimkan sekarang" di ID) sebelum berhenti. Ini menghindari timeout dan mengirim dalam satu alur.

### Dukungan Bahasa

Voice input default ke **Bahasa Inggris (en-US)**. Lima bahasa didukung: Inggris, Indonesia, Jepang, Korea, dan Mandarin. Gunakan tombol pengalih bahasa di samping mic untuk beralih.

---

## Push Notification

Stoa mengirim push notification browser saat agent merespons, bahkan ketika tab di background.

### Mengaktifkan di Desktop (Chrome/Edge)

1. Buka **Settings > General > Notifications** dan aktifkan notifikasi
2. Saat browser meminta "Allow notifications?", klik **Allow**
3. Jika tidak sengaja diblokir, klik **ikon gembok/info** di address bar > **Site settings** > set Notifications ke **Allow**

### Mengaktifkan di Android (Chrome)

1. Buka Stoa di Chrome
2. Buka **Settings > General > Notifications** dan aktifkan notifikasi
3. Saat diminta, tap **Allow**
4. Jika terblokir: tap **ikon gembok** di address bar > **Permissions** > **Notifications** > **Allow**

Alternatif: **Chrome Settings > Site Settings > Notifications** > cari URL Stoa dan set ke **Allow**.

### Mengaktifkan di iOS (Safari 16.4+)

Push notification di iOS memerlukan Stoa diinstal sebagai PWA terlebih dahulu:

1. **Tambahkan Stoa ke Home Screen** (lihat bagian selanjutnya)
2. Buka Stoa dari ikon Home Screen
3. Buka **Settings > General > Notifications** dan aktifkan notifikasi
4. Saat diminta, tap **Allow**

Catatan: Push notification iOS hanya berfungsi dari PWA (app Home Screen), bukan dari tab Safari.

---

## Add to Home Screen (PWA)

Instal Stoa sebagai Progressive Web App untuk pengalaman seperti aplikasi native — layar penuh, tanpa chrome browser, dan akses lebih cepat.

### Android (Chrome)

1. Buka Stoa di Chrome
2. Tap **menu titik tiga** (kanan atas)
3. Tap **"Add to Home screen"** atau **"Install app"**
4. Konfirmasi nama dan tap **Add**
5. Stoa muncul di home screen sebagai ikon aplikasi

### iOS (Safari)

1. Buka Stoa di Safari
2. Tap **tombol Share** (kotak dengan panah, bagian bawah tengah)
3. Scroll ke bawah dan tap **"Add to Home Screen"**
4. Konfirmasi nama dan tap **Add**
5. Stoa muncul di home screen sebagai ikon aplikasi

### Desktop (Chrome/Edge)

1. Buka Stoa di Chrome atau Edge
2. Klik **ikon install** di address bar (atau menu titik tiga > "Install Stoa")
3. Klik **Install**
4. Stoa terbuka sebagai jendela mandiri

### Kenapa Instal sebagai PWA?

- **Layar penuh**: Tidak ada address bar atau tab browser yang memakan tempat
- **Akses cepat**: Buka dari home screen seperti aplikasi native
- **Push notification di iOS**: Diperlukan agar push notification iOS bisa berfungsi
- **Indikator offline**: Menampilkan status koneksi dengan jelas

---

## Referensi Cepat

| Fitur | Desktop Chrome | Android Chrome | iOS Safari |
|-------|---------------|----------------|------------|
| Voice Input | Chrome flag | Chrome flag | Dukungan terbatas |
| Push Notification | Prompt Allow | Prompt Allow | Perlu PWA (iOS 16.4+) |
| Add to Home Screen | Ikon install | Menu > Add to Home | Share > Add to Home |
| Workaround HTTP | chrome://flags | chrome://flags | Settings > Safari |
