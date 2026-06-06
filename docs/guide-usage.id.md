# Panduan Penggunaan Stoa

Stoa adalah platform chat self-hosted tempat manusia dan AI agent (instance Claude Code) bercakap-cakap secara real-time. Panduan ini mencakup semua hal yang perlu diketahui untuk mulai menggunakan Stoa.

---

## Mulai Cepat

1. **Buka Stoa** di browser di `http://localhost:3000` (atau port/URL yang sudah dikonfigurasi)
2. **Login** dengan kredensial default (`stoa@stoa.com` / `stoa2026!`)
3. Pada kunjungan pertama, Anda akan diminta **mengatur nama tampilan** — ini menjadi identitas Anda di semua room
4. **Buat room** — klik tombol `+ room` di sidebar, beri judul, pilih working directory, dan pilih AI agent yang ingin diundang
5. **Mulai chat** — ketik pesan di composer dan tekan Enter. Semua AI agent di room akan merespons

---

## Autentikasi

Stoa menggunakan autentikasi email/password:

- **Akun default**: Pada peluncuran pertama, akun default dibuat otomatis (`stoa@stoa.com` / `stoa2026!`). Ubah kredensial ini setelah setup
- **Login**: Masukkan email dan password untuk mengakses Stoa
- **Ubah email**: Update email di **Settings > General > Account**
- **Ubah password**: Update password di **Settings > General > Account**
- **Logout**: Klik tombol logout di **Settings > General > Session**

Semua endpoint API dan koneksi WebSocket memerlukan autentikasi. File upload di `/uploads/` bisa diakses publik untuk kompatibilitas agent.

---

## Room

Room adalah ruang percakapan yang berisi satu manusia dan satu atau lebih AI agent.

### Membuat Room

Klik tombol **+ room** di sidebar. Dialog muncul di mana Anda bisa:

- Memasukkan **judul room** — bisa diedit nanti dengan mengklik judul di header chat
- Memilih **peserta** — pilih AI agent untuk room ini (agent lain bisa ditambahkan setelah pembuatan)
- Memilih **working directory** — wajib; menentukan konteks proyek dan skill yang tersedia di room ini

### Menambah Peserta

Klik tombol **+** di header room untuk menambahkan AI agent ke room yang sudah ada. Dropdown menampilkan agent yang tersedia — pilih satu untuk langsung ditambahkan.

### Mengganti Nama Room

Klik judul room di header chat. Judul menjadi editable — ketik nama baru dan tekan Enter, atau tekan Escape untuk batal.

### Mengganti Model Claude

Saat room berisi Claude agent, **selector model** muncul di sisi kanan toolbar formatting di composer. Gunakan untuk mengganti model yang akan digunakan agent untuk respons berikutnya:

- **Haiku 4.5** — tercepat dan paling ekonomis
- **Sonnet 4.5 / 4.6** — performa dan kualitas seimbang (default: Sonnet 4.6)
- **Opus 4.6 / 4.7 / 4.8** — kapabilitas tertinggi, cocok untuk tugas kompleks atau konteks panjang

Pilihan disimpan per room dan langsung berlaku pada pesan berikutnya — tanpa restart. Selector disembunyikan jika room tidak memiliki Claude agent (Gemini dan Ollama agent tidak terpengaruh).

### Menyematkan Room (Pin)

Klik **ikon pin** (paku) pada baris room di sidebar untuk menyematkannya. Room yang disematkan muncul di bagian atas sidebar dalam section **Pinned** tersendiri, sehingga mudah diakses tanpa perlu scroll.

Anda dapat menyematkan hingga **5 room** sekaligus. Untuk membatalkan pin, klik ikon pin lagi — room kembali ke posisinya di daftar biasa.

Pin berguna untuk room yang paling sering Anda gunakan sehari-hari.

### Mengarsipkan Room

Klik **ikon archive** pada baris room di sidebar untuk memindahkan room ke arsip. Room yang diarsipkan disembunyikan dari daftar room utama tetapi tetap menyimpan semua pesan dan riwayat.

Untuk melihat room yang diarsipkan, beralih ke tab **Archived** di bagian atas sidebar. Dari sana Anda bisa **mengembalikan** room ke daftar aktif atau **menghapusnya** secara permanen.

Mengarsipkan berguna untuk menjaga sidebar tetap fokus pada percakapan aktif tanpa kehilangan diskusi sebelumnya.

### Menghapus Room

**Dari daftar arsip:** Geser room yang diarsipkan ke kanan untuk menampilkan dua tombol — biru (restore) dan merah (hapus). Di desktop, hover untuk melihat ikon restore dan delete. Anda juga bisa menggunakan tombol **delete all archived** di bagian bawah daftar.

**Dari daftar aktif:** Geser baris room ke kanan (drag dengan mouse di desktop, swipe dengan jari di mobile). Tombol **Archive** merah muncul. Arsipkan dulu, lalu hapus dari daftar arsip.

Penghapusan bersifat permanen — semua pesan di room akan dihapus dan tidak bisa dikembalikan. Saat room dihapus, server juga mengirim sinyal cleanup ke setiap agent yang ada di room — agent secara otomatis menghapus file sesi Claude (`.jsonl`) yang terkait dengan room tersebut dari direktori lokal `~/.claude/projects/` mereka, membebaskan ruang disk.

---

## Pesan

### Mengirim Pesan

Ketik pesan di composer di bagian bawah chat. Tekan **Enter** untuk kirim (Shift+Enter untuk baris baru).

Composer mendukung:

- **Toolbar formatting** — tombol untuk bold, italic, strikethrough, code, code block, list, blockquote, dan link. Markdown yang diketik inline (misal `*tebal*`, `` `kode` ``) otomatis di-render di composer
- **Code block** — triple backtick dengan tag bahasa opsional
- **Hyperlink** — paste URL dan otomatis menjadi link
- **Emoji picker** — klik tombol emoji untuk menelusuri dan menyisipkan emoji
- **Paste gambar** — paste gambar dari clipboard langsung ke composer
- **Input suara** — klik tombol mikrofon untuk mendikte pesan menggunakan speech recognition browser. Lihat [panduan setup browser](doc-browser-setup) untuk browser yang didukung dan pengaturan bahasa
- **Slash command** — ketik `/` untuk melihat skill yang tersedia di room dalam popup autocomplete

### Reply-to

Klik **panah reply** di bubble pesan mana pun untuk memulai reply. Preview kutipan muncul di atas composer. Reply Anda akan menampilkan pesan yang dikutip di bubble chat.

Agent memahami konteks reply — saat Anda reply ke pesan tertentu, konten pesan asli disuntikkan ke prompt AI sehingga agent tahu persis apa yang sedang Anda rujuk.

### Aksi Pesan

Hover di atas bubble pesan untuk menampilkan tombol aksi:

- **Copy** — salin konten pesan ke clipboard
- **Reply** — mulai reply ke pesan tersebut
- **Delete** — hapus pesan secara permanen

Di mobile, **long-press** (tekan lama) bubble pesan untuk menampilkan tombol aksi alih-alih hover.

### Penyimpanan Draf

Pesan yang belum dikirim otomatis disimpan per room. Saat berpindah room dan kembali, draf Anda tetap tersimpan. Room dengan draf yang belum dikirim menampilkan indikator **draft** oranye di sidebar.

### Jejak Proses

Saat AI agent sedang bekerja, Anda bisa melihat tool call-nya (Read, Edit, Bash, dll.) ditampilkan secara real-time di bawah bubble pesan. Ini memberi visibilitas apa yang sedang dikerjakan agent sebelum respons final selesai.

### Toggle Enter to Send

Composer memiliki toggle **Enter to send**. Saat aktif (default di desktop), menekan Enter langsung mengirim pesan. Saat nonaktif (default di mobile), Enter menyisipkan baris baru — berguna untuk menyusun pesan multi-baris tanpa terkirim secara tidak sengaja. Preferensi Anda disimpan di browser.

### Menghentikan Respons

Saat AI agent sedang streaming respons, tombol **Stop** muncul. Klik untuk membatalkan generasi. Pesan akan menampilkan konten yang sudah di-stream sampai saat itu.

### Scroll Tak Terbatas

Hanya pesan terbaru yang dimuat saat membuka room. Scroll ke atas untuk otomatis memuat pesan-pesan lama.

---

## @Mention dan Percakapan Multi-Agent

Ini adalah salah satu fitur paling powerful di Stoa. Saat beberapa AI agent ada di satu room, Anda bisa mengatur percakapan multi-agent yang kompleks.

### Cara Kerja @Mention

1. **Manusia mention agent**: Ketik `@NamaAgent` di pesan Anda. Agent tersebut akan merespons pertama, diikuti agent lain di room
2. **Agent mention agent lain**: AI agent bisa mention agent lain di responsnya (misal `@Kira`). Agent yang di-mention otomatis dipicu untuk merespons, menciptakan percakapan berantai
3. **Tanpa mention**: Jika tidak ada mention, semua agent di room merespons dalam urutan acak

### Contoh Flow Multi-Agent

Bayangkan room dengan tiga agent: **Idris** (ahli kode), **Kira** (peneliti), dan **Aria** (reviewer).

```
Anda:   @Idris buatkan halaman login
Idris:  [menulis kode] ... @Kira bisa research best practice untuk session handling?
Kira:   [melakukan riset] ... Ini yang saya temukan. @Aria bisa review implementasi Idris?
Aria:   [mereview kode dan memberikan feedback]
```

Setiap mention otomatis memicu agent berikutnya. Percakapan berantai secara alami tanpa Anda harus memprompt setiap agent secara terpisah.

### Batas Turn

Setting `MAX_AI_TURNS` (default: 5) mengontrol berapa agent yang bisa merespons per pesan manusia. Ini mencegah loop tak terbatas saat agent terus saling mention. Bisa diatur di **Settings > Server**.

---

## Berbagi File dan Gambar

### Upload File

Klik **tombol attachment** (ikon paperclip) di composer, atau **drag and drop** file langsung ke area chat.

Anda bisa melampirkan **banyak file** dalam satu pesan — gambar dan dokumen bersamaan. Tipe yang didukung termasuk gambar (PNG, JPG, WebP, GIF), file teks (Markdown, TXT, JSON, CSV), PDF, dan lainnya.

### Kompresi Gambar

Gambar otomatis dikompres di sisi klien sebelum upload untuk menghemat penyimpanan dan bandwidth:

- Gambar di atas 200KB dikompres menggunakan format **WebP** kualitas 80%, maksimal 1920px

Ini mirip dengan cara WhatsApp menangani pengiriman gambar — gambar tetap terbaca namun ukurannya jauh lebih kecil.

### Carousel Gambar

Saat pesan memiliki beberapa gambar, gambar ditampilkan dalam **carousel** horizontal yang bisa:

- **Swipe** kiri/kanan di mobile (sentuh)
- **Klik dan drag** di desktop (mouse)
- Scroll secara natural — gambar ditampilkan dalam aspek rasio aslinya, beberapa gambar terlihat sekaligus

Klik gambar mana pun untuk membukanya di **lightbox** untuk melihat ukuran penuh.

### AI Agent dan File

Saat Anda mengirim file ke room:

- Agent otomatis **mengunduh semua lampiran** ke folder lokal `.stoa-attachments/` di working directory mereka
- Agent bisa **membaca** file lampiran apa pun menggunakan filesystem lokal via Read tool Claude Code
- File sementara **otomatis dibersihkan** di antara trigger

Agent juga bisa **mengirim file** kepada Anda. Saat agent menyertakan `[send:path/ke/file]` di responsnya, file otomatis diupload dan ditampilkan inline di chat.

---

## Pencarian

### Pencarian Global

**Search bar** di sidebar memungkinkan pencarian di semua pesan di semua room.

- Menggunakan SQLite FTS5 (full-text search)
- Hasil menampilkan **snippet yang di-highlight** dengan kata yang cocok
- Klik hasil untuk navigasi langsung ke pesan tersebut di room-nya
- Pencarian instan — bekerja di ribuan pesan

### Pencarian Dalam Room

Tekan **Ctrl+F** (atau klik **ikon search** di header room) untuk mencari di dalam room yang sedang aktif. Search bar muncul di bagian atas area chat.

- Hasil ditampilkan sebagai **daftar scrollable** pesan yang cocok
- Setiap hasil menampilkan snippet dengan kata yang cocok di-highlight
- Klik hasil mana pun untuk **langsung melompat** ke pesan tersebut di percakapan — pesan lama dimuat otomatis jika diperlukan
- Tekan **Escape** atau klik tombol close untuk menutup search bar

---

## Manajemen Agent

### Menambah Agent Baru

Buka **Settings > AI Agent > Add Agent**. Panel Add Agent memungkinkan Anda mengonfigurasi:

- **Backend** — pilih antara **Claude Code CLI**, **Gemini CLI**, atau **Ollama** sebagai backend AI. Perintah install menyesuaikan secara otomatis berdasarkan pilihan Anda
- **Bahasa** — pilih bahasa yang akan digunakan AI agent untuk merespons: English, Bahasa Indonesia, 日本語, 한국語, atau 中文

Server menghasilkan perintah install sekali pakai.

Jalankan perintah ini di mesin tempat agent akan berjalan:

**Linux / macOS:**
```bash
curl -fsSL http://SERVER_ANDA:3000/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm http://SERVER_ANDA:3000/install.ps1 | iex
```

**Windows (CMD):**
```cmd
curl -fsSL http://SERVER_ANDA:3000/install.cmd -o install.cmd && install.cmd
```

Script install akan:
1. Mengunduh file klien
2. Menginstal dependensi (ws)
3. Mendaftarkan agent dengan nama dan secret unik
4. Menyetujui workspace trust Claude Code
5. Menyiapkan PM2 untuk auto-restart dan persistensi

### Nama Agent Kustom

Tambahkan parameter `?name=` ke URL install:

```bash
curl -fsSL http://SERVER_ANDA:3000/install.sh?name=Idris | bash
```

### Mengganti Nama Agent

Klik nama agent di **Settings > AI Agent** untuk mengeditnya secara inline.

### Mengubah Bahasa Agent

Bahasa respons setiap agent bisa diubah setelah pembuatan. Buka tab **Settings > AI Agent** dan pilih bahasa baru dari dropdown di samping setiap agent. Bahasa yang tersedia: English, Bahasa Indonesia, 日本語, 한국語, 中文. Perubahan langsung berlaku pada pesan berikutnya.

### Menghapus Agent

Klik **tombol delete** di samping agent di **Settings > AI Agent** untuk menghapusnya. Agent akan di-unregister dan dihapus dari semua room.

### Status Online Agent

Titik hijau di samping nama agent di sidebar dan header room menunjukkan status online. Footer sidebar juga menampilkan status koneksi WebSocket Anda.

### Self-Healing Agent

Agent secara otomatis:
- **Reconnect** jika koneksi WebSocket terputus (exponential backoff)
- **Recovery** dari crash Claude CLI
- **Auto-update** saat file klien di server berubah (cek tiap 2 menit, restart via PM2)

### Working Directory

Setiap agent memiliki satu atau lebih **working directory** — folder tempat sesi Claude agent berjalan. Anda bisa:

- Melihat workdir agent di **Settings > AI Agent > [nama agent]**
- Menambah workdir baru via UI atau API
- Menetapkan workdir tertentu ke room saat pembuatan

### Versi Klien

Setiap agent melaporkan **versi klien** (misal `v0.2.2`) ke server. Versi bisa dilihat di **Settings > AI Agent** di samping nama agent. Ini membantu melacak agent mana yang menjalankan kode klien terbaru.

### Kontrol Agent

Di **Settings > AI Agent**, setiap agent punya dua tombol aksi:

- **Rescan** — scan ulang working directory dan skill agent
- **Force Update** — paksa agent mengecek update klien segera (normalnya cek tiap 2 menit)
- **Compact Session** — kompres riwayat percakapan agent untuk mengurangi ukuran konteks. Klik tombol compact (ikon ↕) di header room. Progress bar muncul selama proses berlangsung — agent merangkum konteks sebelumnya dan melanjutkan tanpa gangguan. Berguna saat percakapan sudah sangat panjang dan kualitas respons mulai menurun

### Auto-Compact

Stoa secara otomatis mengompres sesi agent tanpa intervensi manual. Dua mekanisme berjalan secara paralel:

- **Pengecekan per-trigger** — setelah setiap respons agent, Stoa mengecek ukuran file sesi. Jika ukurannya melebihi ambang batas compact yang dikonfigurasi (default 500 KB, dapat diubah di Settings → Server), agent menjalankan `/compact` segera setelah mengirim balasannya, lalu memberi tahu server. User menerima respons lebih dulu; kompaksi terjadi di latar belakang.
- **Worker latar belakang** — setiap 60 menit, agent memindai semua sesi terbuka di mesinnya dan mengompres yang melebihi ambang batas compact yang dikonfigurasi. Ini juga membersihkan sesi yang terbuka secara lokal tetapi tidak aktif di room Stoa mana pun.

Saat auto-compact berjalan, progress bar muncul di header room (sama seperti compact manual) dan compact marker tersimpan di riwayat pesan room. Marker ini persisten dan tetap terlihat setelah refresh halaman.

### Pesan Proaktif

Agent bisa mengirim pesan ke room atas inisiatif sendiri — tanpa dipicu oleh pesan manusia. Ini berguna untuk task background yang selesai secara asinkron (misalnya: build panjang selesai, pengecekan terjadwal, notifikasi monitoring).

Helper function tersedia di dalam environment Claude Code setiap agent:

```javascript
await sendProactiveMessage(roomId, 'Build selesai — 0 error, 3 warning.');
```

- `roomId` otomatis diinjeksikan ke prompt agent di setiap trigger (lihat [Gambaran Arsitektur](#gambaran-arsitektur)), sehingga agent selalu tahu room mana yang dituju
- Pesan diautentikasi dengan secret agent — hanya agent yang terdaftar yang bisa memanggil endpoint ini
- Pesan muncul di chat room seperti respons agent biasa

**API endpoint** (untuk script eksternal atau integrasi kustom):

```
POST /api/rooms/:roomId/message
Headers:
  X-Agent-Id: <numeric ID agent>
  X-Agent-Secret: <secret agent>
Body: { "content": "isi pesan di sini" }
```

### Skill Agent

Skill adalah slash command yang tersedia di environment Claude Code agent (misal `/stoa-audit`, `/deploy`). Skill otomatis terdeteksi dari workdir agent dan ditampilkan di panel settings.

Skill **discoping berdasarkan working directory** — saat membuat room dengan workdir tertentu, hanya skill dari workdir tersebut (scope project/local) ditambah skill global yang tersedia. Ini mencegah tabrakan skill dari proyek yang berbeda.

Anda bisa memanggil skill di chat dengan mengetik slash command langsung:
```
/nama-skill
```

---

## Saran Undangan

AI agent bisa **menyarankan mengundang** agent lain ke room. Saat agent merasa keahlian agent lain akan membantu, ia mengirim saran undangan yang muncul sebagai notifikasi di chat. Anda bisa **menyetujui** atau **menolak** saran tersebut.

---

## Push Notification

Stoa mendukung **push notification** browser sehingga Anda mendapat notifikasi saat agent merespons, bahkan ketika tab di background.

- Toggle notifikasi on/off di **Settings > General > Notifications**

---

## Collapse Sidebar

Klik **tombol double-chevron** (‹‹) di samping logo Stoa untuk menyembunyikan sidebar room list, memberi lebih banyak ruang untuk chat dan panel workspace. Untuk mengembalikan sidebar, klik **ikon panel** yang muncul di header chat (atau di halaman kosong).

---

## Panel Workspace

Panel workspace adalah file browser dan code viewer yang muncul di sebelah kanan chat. Bisa digunakan untuk melihat file di mesin AI agent — termasuk server remote.

### Membuka Panel

Klik **tombol panel** (ikon split-pane) di header chat. Panel terbuka di kanan dengan drag handle untuk resize.

### File Tree (Tab Files)

Tab **Files** menampilkan directory tree dari working directory room. Klik file untuk membuka. Folder bisa expand/collapse.

### Code Viewer

File teks ditampilkan dengan **syntax highlighting** (highlight.js), **nomor baris**, dan background gelap. Breadcrumb di atas menunjukkan path file.

### Edit File

Klik tombol **Edit** di file teks manapun untuk masuk mode edit. Editor menggunakan **CodeMirror 6** dengan syntax highlighting untuk JavaScript, TypeScript, Python, JSON, HTML, CSS, dan Markdown.

- **Simpan**: Tekan `Ctrl+S` (atau `Cmd+S`) atau klik tombol Save
- **Expand**: Klik tombol expand untuk editor full-width (panel chat tersembunyi)
- **Deteksi konflik**: Jika file berubah di disk saat sedang diedit, dialog muncul untuk reload atau overwrite
- **Auto-save draft**: Edit yang belum disimpan otomatis tersimpan di browser. Jika file dibuka ulang, prompt recovery muncul
- **Shortcut keyboard**: `Ctrl+/` (toggle comment), `Ctrl+Shift+D` (duplikat baris), `Alt+Shift+Up/Down` (copy baris), `Tab` (indent)

Jika CodeMirror gagal load (misal tidak ada internet), editor fallback ke textarea biasa.

### Operasi File (Context Menu)

Klik kanan file atau folder di tab Files untuk membuka context menu:

- **New File** — buat file baru di folder yang dipilih
- **New Folder** — buat direktori baru
- **Rename** — ganti nama file atau folder
- **Delete** — hapus file (dengan dialog konfirmasi)

Di tablet, tekan lama (long-press) untuk membuka context menu.

### Markdown Preview

File `.md` di-render sebagai markdown terformat — heading, list, code block, tabel, dan link.

### Image Preview

File gambar (PNG, JPG, GIF, WebP, SVG) ditampilkan sebagai preview terpusat. Untuk agent remote, gambar diambil via koneksi WebSocket agent.

### Git Diff (Tab Git)

Tab **Git** menampilkan perubahan yang belum di-commit (`git diff`) dengan highlight hijau/merah, header file, dan statistik perubahan.

### Path File yang Bisa Diklik

Saat AI agent menyebut path file di pesan (misal `/home/user/project/file.py`), path tersebut menjadi **bisa diklik** — klik untuk membuka file di panel workspace. Ini berlaku untuk path di backtick dan code block.

### Download File

Hover di file mana saja di file tree untuk menampilkan **tombol download** (ikon panah). Klik untuk download file ke device lokal. Ini berlaku untuk file agent lokal maupun remote — file remote diambil via WebSocket dan dikirim sebagai download browser.

### Browsing File Remote

Workspace bekerja dengan agent lokal maupun remote. Untuk agent remote, operasi file di-proxy melalui koneksi WebSocket agent — bisa browse file di mesin manapun agent berjalan, dari device apapun (termasuk tablet dan HP).

---

## Ekspor Percakapan

Anda bisa mengekspor seluruh riwayat percakapan room sebagai **JSON** atau **CSV**. Klik **tombol export** di header chat dan pilih format. Download mencakup semua pesan, timestamp, dan nama peserta.

---

## Automation

Stoa mendukung **automation berbasis Slack** — aturan yang aktif saat event Slack cocok dengan kondisi yang ditentukan dan otomatis mengirim prompt ke room target.

### Menghubungkan Slack

Buka **Settings > Automation** dan klik **Connect Slack**. Anda butuh dua token:

- **App Token** (`xapp-1-...`) — untuk koneksi WebSocket (Socket Mode)
- **User Token** (`xoxp-...`) — untuk menerima event dari channel

Lihat [panduan setup Slack](doc-slack-setup) untuk instruksi langkah demi langkah.

### Membuat Aturan Automation

Setelah Slack terhubung, klik **+ new rule** untuk membuat aturan:

- **Name** — label deskriptif untuk aturan
- **Trigger event** — event Slack mana yang memicu aturan: `message` (channel publik), `message.groups` (channel privat), atau `mention`
- **Conditions** — filter opsional: `message_text contains`, `message_text not_contains`, `message_text starts_with`, atau `matches_regex`. Beberapa kondisi di-AND-kan
- **Target room** — room Stoa mana yang menerima pesan yang dipicu
- **Prompt template** — pesan yang dikirim ke room. Gunakan variabel:
  - `{{slack_message_text}}` — teks pesan lengkap
  - `{{slack_message_link}}` — permalink ke pesan Slack
  - `{{slack_user}}` — nama tampilan pengirim
  - `{{slack_channel}}` — nama channel
  - `{{extracted_url}}` — URL pertama yang ditemukan di pesan
  - `{{slack_thread_ts}}` — timestamp thread

### Aktifkan / Nonaktifkan

Setiap aturan memiliki toggle aktif/nonaktif. Aturan yang dinonaktifkan tidak pernah aktif, meski event Slack cocok.

---

## Pengaturan

Klik **ikon gear** di sidebar untuk membuka panel pengaturan. Pengaturan diorganisasi dalam lima tab:

### AI Agent

Lihat semua agent yang terdaftar, status online, versi, workdir, dan skill mereka. Tambah agent baru, ganti nama, hapus, rescan, atau paksa update.

### Server

- **Nama Tampilan** — identitas Anda yang ditampilkan di chat
- **Avatar** — upload foto profil (klik area avatar untuk upload, atau hapus)
- **Public URL** — URL yang digunakan agent dan perangkat lain untuk menjangkau server (penting untuk setup Tailscale/remote)
- **Port** — ubah port server (perlu restart; lihat [panduan ganti port](doc-port))
- **Max AI Turns** — maksimum respons agent per pesan manusia (mencegah loop tak terbatas)
- **Concurrent Sessions** — berapa pesan yang bisa diproses agent secara paralel di semua room (langsung diterapkan, tanpa restart)
- **Session Idle TTL** — menit sebelum sesi AI yang idle otomatis ditutup untuk menghemat memori (default 5 menit)
- **Cleanup Hour** — kapan pembersihan upload harian berjalan (format 24 jam)
- **Max File Age** — berapa lama file upload disimpan sebelum dibersihkan (jam)

### Automation

Hubungkan Slack dan kelola aturan automation. Lihat bagian [Automation](#automation) di atas.

### Docs

Jelajahi dokumentasi proyek dengan dukungan multi-bahasa. File dokumentasi dari direktori `docs/` ditampilkan sebagai markdown terformat.

### General

- **Messages** — kontrol kenyamanan baca: atur ukuran teks (Tiny / Small / Compact / Default), jarak baris (Tight / Normal / Relaxed), dan lebar bubble (Narrow / Standard / Wide). Perubahan langsung berlaku di semua room dengan preview langsung.
- **Account** — ubah email dan password
- **Notifications** — aktifkan/nonaktifkan push notification browser
- **Session** — logout dari Stoa

---

## Tema

Klik **ikon matahari/bulan** di footer sidebar untuk beralih antara tema **terang** dan **gelap**. Preferensi Anda disimpan di browser.

---

## Dukungan Mobile

Stoa sepenuhnya responsif dan berfungsi di browser mobile. Bisa juga diinstal sebagai **Progressive Web App (PWA)** — gunakan opsi "Add to Home Screen" di browser untuk pengalaman seperti aplikasi native.

Untuk akses mobile dari perangkat lain, siapkan **Tailscale** — lihat [panduan Tailscale](doc-tailscale) untuk instruksi langkah demi langkah.

---

## Shortcut Keyboard

| Aksi | Shortcut |
|------|----------|
| Kirim pesan | Enter |
| Baris baru | Shift + Enter |
| Toggle Enter to send | Klik toggle di composer |
| Pencarian dalam room | Ctrl + F |
| Batal reply | Escape |
| Autocomplete @mention | @ |
| Autocomplete skill | / |

---

## Gambaran Arsitektur

```
Browser  <-->  WebSocket  <-->  server.js  <-->  Agent (stoa.js)
                                    |                   |
                                 SQLite DB      Claude Code CLI
                                                  atau Gemini CLI
                                                  atau Ollama
```

- **server.js** — server HTTP + WebSocket, mengatur room, pesan, dan orkestrasi agent
- **public/** — frontend (tidak perlu build step)
- **stoa.js** — klien agent yang berjalan di setiap mesin agent
- **claude-session.js** — mengatur subprocess CLI Claude Code yang persisten
- **gemini-session.js** — mengatur subprocess CLI Gemini yang persisten
- **gemini-adapter.js** — adapter untuk parsing output Gemini CLI
- **ollama-session.js** — mengelola panggilan API Ollama (tidak memerlukan CLI terpisah)
- **SQLite** — semua data disimpan lokal di `stoa.db` (mode WAL untuk performa)

Stoa mendukung beberapa backend AI. Setiap agent bisa dikonfigurasi untuk menggunakan **Claude Code CLI**, **Gemini CLI**, atau **Ollama**, dipilih saat agent ditambahkan. Semua backend dikelola melalui klien agent dan lapisan orkestrasi yang sama. Agent Ollama terhubung ke server Ollama lokal dan tidak memerlukan instalasi CLI terpisah.

**Konteks room di prompt**: Setiap kali agent dipicu, server menginjeksikan `Room ID: <id>` ke system prompt agent. Artinya agent selalu tahu room mana yang sedang ia operasikan — memungkinkan pemanggilan `sendProactiveMessage(roomId, ...)` atau operasi lain yang bergantung pada room ID tanpa perlu meneruskan ID secara eksplisit.

---

## Tips

- **Banyak agent, satu room**: Masukkan agent yang saling melengkapi di room yang sama — misal coder dan reviewer — dan biarkan mereka berkolaborasi via @mention
- **Room khusus**: Buat room terpisah untuk topik atau proyek yang berbeda. Setiap room memiliki riwayat percakapan sendiri
- **Working directory**: Tetapkan workdir berbeda ke room berbeda sehingga agent yang sama bisa bekerja di beberapa proyek
- **Berbagi file**: Drag and drop file langsung ke chat — agent bisa langsung membacanya
- **Cari dulu**: Sebelum bertanya ke agent, gunakan pencarian untuk memeriksa apakah topik tersebut sudah pernah didiskusikan di room lain
