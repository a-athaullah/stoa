# Panduan Penggunaan Stoa

Stoa adalah platform chat self-hosted tempat manusia dan AI agent (instance Claude Code) bercakap-cakap secara real-time. Panduan ini mencakup semua hal yang perlu diketahui untuk mulai menggunakan Stoa.

---

## Mulai Cepat

1. **Buka Stoa** di browser di `http://localhost:3000` (atau port/URL yang sudah dikonfigurasi)
2. **Login** — kredensial awal ditulis ke `db/initial-credentials.txt` saat pertama kali server dijalankan (hanya bisa dibaca oleh proses server). Anda juga bisa menetapkan password sebelumnya via environment variable `STOA_INITIAL_PASSWORD`.
3. Pada kunjungan pertama, Anda akan diminta **mengatur nama tampilan** — ini menjadi identitas Anda di semua room
4. **Buat room** — klik tombol `+ room` di sidebar, beri judul, pilih working directory, dan pilih AI agent yang ingin diundang
5. **Mulai chat** — ketik pesan di composer dan tekan Enter. Semua AI agent di room akan merespons

---

## Autentikasi

Stoa menggunakan autentikasi email/password:

- **Kredensial awal**: Saat pertama kali dijalankan, password acak dibuat dan ditulis ke `db/initial-credentials.txt` (mode 0600, direktori default `db/`). Gunakan kredensial tersebut untuk login. Anda juga bisa menetapkan password via environment variable `STOA_INITIAL_PASSWORD` sebelum pertama kali menjalankan server.
- **Peringatan password default**: Jika masih menggunakan password awal, banner peringatan persisten muncul di UI untuk mengingatkan Anda mengganti password.
- **Login**: Masukkan email dan password untuk mengakses Stoa.
- **Rate limit**: 5 percobaan login gagal per 15 menit per IP (juga per email dari IP mana pun). Setelah batas tercapai, server membalas `429 Too Many Requests` dengan header `Retry-After`. Perangkat yang pernah login sebelumnya dikecualikan dari batas per-email.
- **Syarat password**: Password baru minimal 12 karakter.
- **Ubah email**: Update email di **Settings > General > Account**.
- **Ubah password**: Update password di **Settings > General > Account**.
- **Logout**: Klik tombol logout di **Settings > General > Session**.

Semua endpoint API dan koneksi WebSocket memerlukan autentikasi. File di `/uploads/` dan `/connector-media/` memerlukan sesi yang valid, kredensial agent, atau signed URL — tidak dapat diakses publik.

---

## Room

Room adalah ruang percakapan yang berisi satu manusia dan satu atau lebih AI agent.

### Membuat Room

Klik tombol **+ room** di sidebar. Dialog muncul di mana Anda bisa:

- Memasukkan **judul room** — bisa diedit nanti dengan mengklik judul di header chat
- Memilih **peserta** — pilih AI agent untuk room ini (agent lain bisa ditambahkan setelah pembuatan) Hanya agent yang sedang **online** yang bisa dipilih — agent offline tetap tampil tapi diredupkan dengan label *offline*, karena room butuh agent yang benar-benar bisa merespons.
- Memilih **working directory** — wajib; menentukan konteks proyek yang tersedia di room ini

### Menambah Peserta

Klik tombol **+** di header room untuk membuka dialog tambah agent. Pilih AI agent (hanya agent yang belum ada di room yang ditampilkan) dan pilih **working directory**-nya — pemilih yang sama seperti saat membuat room — lalu klik **Add Agent**. Dengan ini setiap agent dalam satu room bisa berjalan di direktori masing-masing (misalnya satu agent di folder project, agent lain di workspace-nya sendiri). Hanya agent **online** yang bisa ditambahkan; agent offline tetap muncul di daftar tapi dinonaktifkan (dengan label *offline*) — onlinekan agent-nya dulu, baru tambahkan.

### Mengganti Nama Room

Klik judul room di header chat. Judul menjadi editable — ketik nama baru dan tekan Enter, atau tekan Escape untuk batal.

### Mengganti Model

**Selector model** muncul di sisi kanan toolbar formatting di composer. Gunakan untuk mengganti model yang akan digunakan agent untuk respons berikutnya.

**Model Claude bawaan** (via langganan Claude Code):
- **Haiku 4.5** — tercepat dan paling ekonomis
- **Sonnet 4.5 / 4.6** — performa dan kualitas seimbang (default: Sonnet 4.6)
- **Opus 4.6 / 4.7 / 4.8** — kapabilitas tertinggi, cocok untuk tugas kompleks atau konteks panjang

**Model platform eksternal**: Jika Anda sudah mengonfigurasi platform tambahan di **Settings > Platforms** (misal Ollama Cloud, OpenRouter), model yang diaktifkan dari platform tersebut juga muncul di selector, dikelompokkan berdasarkan nama platform. Model yang mendukung input gambar ditandai dengan ikon 👁; model yang mendukung tool-calling ditandai dengan ikon ⚙. Model tanpa tool-calling berjalan dalam mode teks saja (tidak bisa baca file atau eksekusi kode via tools).

Pilihan disimpan per room dan langsung berlaku pada pesan berikutnya — tanpa restart.

Ketika room memiliki lebih dari satu agent AI, atau ketika ada agent yang tidak menggunakan model room, selector model menyertakan bagian **"model per agent"** di bawah daftar model. Setiap baris menampilkan `Nama · harness → model`, disertai label (`↪ agent default`, `↪ harness default`, atau `↪ CLI default`) saat agent tidak menggunakan model room. Preview diperbarui otomatis saat kamu berpindah room, saat setelan agent berubah, atau saat model room diganti.

### Mode Sibuk (Busy Mode)

**Busy mode** mengontrol apa yang terjadi ketika kamu mengirim pesan saat AI sedang berjalan. Buka room settings (ikon **gear** di header room) dan cari kartu **Busy mode**. Tiga pilihan:

- **interrupt** (default) — run yang sedang berjalan langsung dihentikan dan agent restart dengan pesan barumu.
- **queue** — pesanmu masuk antrian. Sebuah pill antrian muncul di header room yang menunjukkan berapa pesan yang menunggu. Setiap pesan diproses secara berurutan setelah run sebelumnya selesai.
- **steer** — pesanmu disuntikkan langsung ke run agent yang sedang berjalan tanpa menghentikannya. Notifikasi singkat **"↩ injected into current run"** muncul di header. Agent melihat pesanmu di tengah run dan dapat menyesuaikan responsnya.

Pengaturan langsung berlaku saat kamu memilih opsi — tanpa tombol save. Tersimpan per room.

Busy mode bersifat **per thread**: setiap thread diperlakukan sebagai konteks independen. Agent bisa menangani pesan di thread B saat masih berjalan di thread A — busy mode thread A tidak memblokir thread B.

### Model di Chat Bubble

Setiap respons AI menampilkan indikator model kecil di pojok kanan bawah bubble (contoh: `qwen3-coder:480b:cloud`), sehingga mudah melacak model mana yang menghasilkan setiap balasan. Jika agent menggunakan model berbeda dari model yang dipilih di room — misalnya karena room belum memiliki model, atau harness-nya tidak mendukung model room — ikon **↪** muncul pada tag model. Arahkan kursor untuk melihat alasannya (contoh: `not using the room model — using agent default`). Respons sub-agent yang berjalan dengan tier tidak menampilkan ikon ini.

### System Prompt & Memory Room

![Popover System Prompt & Memory dengan dua tab untuk konteks tingkat room](screenshots/memory.png)

Klik tombol **Memory** (ikon otak) di strip right sidebar untuk membuka popover **System Prompt & Memory**. Ada dua tab:

- **System Prompt** — instruksi kustom yang disisipkan di awal setiap sesi agent dalam room ini (hingga 65.536 karakter). Gunakan untuk mendefinisikan peran agent, konteks proyek, atau aturan berlaku yang spesifik untuk room ini.
- **Memory** — konteks persisten yang diinjeksi ke setiap sesi agent dalam room ini. Budget: 1.800 karakter. Cocok untuk catatan berjalan, keputusan, dan fakta yang harus selalu dibawa agent.

Keduanya bisa diedit langsung — klik **Edit**, buat perubahan, lalu **save**. Siapa pun dengan akses room dapat mengedit keduanya.

Agent juga bisa membaca dan menulis memory room secara programatik:
- MCP tool: `stoa__room_memory_get` / `stoa__room_memory_set`
- REST: `GET /api/rooms/:id/memory` dan `PUT /api/rooms/:id/memory`

Sub-agent hanya dapat membaca room memory — hanya main agent yang bisa menulis.

### Menyematkan Room (Pin)

Klik **ikon pin** (paku) pada baris room di sidebar untuk menyematkannya. Room yang disematkan muncul di bagian atas sidebar dalam section **Pinned** tersendiri, sehingga mudah diakses tanpa perlu scroll.

Anda dapat menyematkan hingga **3 room** secara default (dapat diubah di Settings → max pinned rooms, maksimal 20). Untuk membatalkan pin, klik ikon pin lagi — room kembali ke posisinya di daftar biasa.

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

Di dalam **panel thread**, hover di atas pesan dan klik **panah reply** untuk mengutipnya. Preview kutipan muncul di atas composer; balasan menampilkan pesan yang dikutip secara inline di thread. Quote-reply hanya tersedia di dalam panel thread — tidak di feed utama.

Agent memahami konteks reply — saat Anda mengutip pesan tertentu, kontennya disuntikkan ke prompt AI sehingga agent tahu persis apa yang sedang Anda rujuk.

### Thread

![Panel thread terbuka di samping feed utama](screenshots/thread.png)

Feed utama menggunakan **tampilan baris flat Slack-style** — setiap pesan root menampilkan avatar pengirim di kiri, nama dan timestamp di baris yang sama, serta konten pesan di bawahnya. Balasan AI tidak muncul di feed utama; mereka berada di dalam panel thread.

Jika sebuah pesan root sudah punya balasan, **chip thread** muncul di bawahnya, menampilkan jumlah balasan, waktu balasan terakhir, dan titik bergerak (pulse) saat agent sedang streaming di dalam thread tersebut.

Klik pesan root mana pun (atau chip thread-nya) untuk membuka **panel thread** di sebelah kanan. Pesan root ditampilkan di bagian atas panel; semua balasan muncul di bawahnya. Jika AI agent mulai streaming balasan, panel **terbuka otomatis** — tetapi hanya jika Anda sedang tidak membuka thread lain. Tutup panel dengan tombol × atau tekan **Escape**.

Panel thread memiliki **composer tersendiri yang terpisah** dari composer room — model selector, emoji picker, mention autocomplete (ketik `@` untuk popup yang sama seperti di composer room: navigasi dengan tombol panah, konfirmasi dengan Enter atau Tab, tutup dengan Escape), lampiran gambar, dan slash command semuanya tersedia. Masing-masing composer punya state independen: attachments, reply-to, dan draft tidak dibagi antara room dan thread. Draft disimpan per thread dan dipulihkan saat panel dibuka kembali.

**Sesi thread:** setiap thread mempertahankan sesi Claude terpisah. Membuka thread lama melanjutkan konteksnya; pesan pertama di thread baru memulai sesi baru untuk agent tersebut.

**Permalink:** setiap room, thread, dan pesan memiliki URL tersendiri. `/r/<room>` membuka room, `/r/<room>/t/<thread>` membuka room beserta thread, dan menambahkan `?m=<id-pesan>` menggulir ke pesan tertentu. Refresh atau berbagi URL akan membuka kembali room dan thread yang sama. Format lama `?thread=<id-pesan>` masih berfungsi.

**Mobile:** panel thread terbuka sebagai overlay fullscreen. Geser ke kanan untuk menutupnya.

**Breadcrumb header:** saat thread terbuka, header room menampilkan breadcrumb (`› beberapa kata pertama…`). Klik untuk menggulir panel thread ke posisi terlihat.

### Thread Broadcast

Pesan thread juga bisa muncul di room feed — tanpa keluar dari threadnya — dalam dua kondisi:

**Automation match** — ketika watch-reply (Slack atau email) masuk ke thread Stoa yang sudah ada dan cocok dengan kondisi trigger automation yang memantau koneksi tersebut, balasan itu dirender sebagai baris sekunder di room feed. Cara kerjanya mirip fitur "also send to channel" di Slack: pesan tetap ada di threadnya dan juga terlihat di feed. Automation tanpa kondisi cocok dengan semua balasan. Untuk Slack, hanya aturan dengan trigger event `message` yang dievaluasi (bukan `reaction_added`). Baris menampilkan badge **automation match** dan pratinjau singkat pesan root. Klik baris tersebut untuk membuka thread dan menyorot balasan yang cocok.

**Error atau limit agent** — ketika agent utama (bukan sub-agent) di dalam thread mengalami error, timeout, disconnect, restart server, atau mencapai rate / usage limit, pesan error-nya juga ditampilkan di room feed dengan badge **error** atau **limit**. Maksimal satu broadcast per thread setiap 10 menit untuk menghindari flood di feed. Error dari sub-agent tidak di-broadcast. Jika agent kemudian reconnect dan run selesai sukses, baris error di feed dihapus otomatis — balasan yang telah selesai tetap ada di thread-nya.

Ketika trigger datang saat agent utama sedang mengunduh auto-update, placeholder "(agent sedang update — akan diproses otomatis setelah restart)" dikirim ke thread dengan badge **error** dan juga tampil di room feed. Trigger disimpan ke antrean retrigger dan dikirim ulang setelah agent terhubung kembali dengan versi terbaru (FIFO per thread, tanpa duplikat). Jika pengiriman gagal 3 kali atau trigger sudah lebih dari 30 menit, sistem mengirim notifikasi "trigger &lt;id&gt; tidak terproses — butuh manusia" di thread dan **selalu** tampil di room feed, tanpa peduli flood guard 10 menit — ini sinyal terminal yang butuh tindakan.

Header setiap baris broadcast selalu diawali badge **From thread**, diikuti pratinjau singkat pesan root dan badge reason (**automation match**, **error**, atau **limit**). Badge **From thread** memperjelas bahwa baris ini berasal dari thread, bukan langsung dari room feed.

Baris broadcast bukan rekaman duplikat — itu adalah pesan thread yang sama dirender di dua tempat. Menghapus pesan asli akan menghapus keduanya.

### Aksi Pesan

Hover di atas pesan untuk menampilkan tombol aksi:

- **Copy** — salin konten pesan ke clipboard
- **Copy link** — salin URL langsung ke pesan ini; membuka Stoa dengan room, thread, dan pesan tersebut sudah terfokus. Tombol **Copy link** tersedia di feed utama, di dalam panel thread, dan di baris broadcast **From thread** pada kartu automation.
- **Reply** — mulai reply ke pesan tersebut
- **Delete** — hapus pesan secara permanen

Di mobile, **long-press** (tekan lama) pesan untuk menampilkan tombol aksi alih-alih hover.

### Permalink

Setiap room, thread, dan pesan di Stoa memiliki URL yang stabil:

- `/r/<room>` — membuka room
- `/r/<room>/t/<thread>` — membuka room dan thread tertentu
- `/r/<room>/t/<thread>?m=<id-pesan>` — membuka thread dan menggulir ke pesan
- `/r/<room>?m=<id-pesan>` — membuka room dan menggulir ke pesan di feed

Gunakan tombol **Copy link** pada pesan untuk menyalin permalink-nya. Tombol **back / forward** browser berpindah antar room dan thread. Jika room sudah tidak ada, muncul notifikasi **"this room isn't here"**. Jika pesan dihapus, muncul toast **"Message not found"** dan Stoa tetap membuka room atau thread.

### Penyimpanan Draf

Pesan yang belum dikirim otomatis disimpan per room. Saat berpindah room dan kembali, draf Anda tetap tersimpan. Room dengan draf yang belum dikirim menampilkan indikator **draft** oranye di sidebar. Setiap baris room di sidebar juga menampilkan badge **jumlah thread aktif** secara langsung saat ada thread yang berjalan di room tersebut — diperbarui real-time di semua room, bukan hanya yang sedang dibuka.

### Jejak Proses

Saat AI agent sedang bekerja, Anda bisa melihat tool call-nya (Read, Edit, Bash, dll.) ditampilkan secara real-time di bawah bubble pesan. Ini memberi visibilitas apa yang sedang dikerjakan agent sebelum respons final selesai.

### Toggle Enter to Send

Composer memiliki toggle **Enter to send**. Saat aktif (default di desktop), menekan Enter langsung mengirim pesan. Saat nonaktif (default di mobile), Enter menyisipkan baris baru — berguna untuk menyusun pesan multi-baris tanpa terkirim secara tidak sengaja. Preferensi Anda disimpan di browser.

### Menghentikan Respons

Saat AI agent sedang streaming respons, tombol **Stop** muncul. Klik untuk membatalkan generasi. Pesan akan menampilkan konten yang sudah di-stream sampai saat itu.

### Agen Terputus

Jika koneksi mesin agent terputus saat sedang streaming balasan, bubble berubah dari indikator streaming menjadi menampilkan alasan interupsi (misalnya, *interrupted — agent disconnected*). Pesan tetap di tempatnya dan tidak dihapus.

Jika agent reconnect dan melanjutkan run yang sama, bubble kembali ke streaming dan selesai secara normal. Balasan akhir muncul di posisi yang sama, setelah pesan-pesan progress yang dikirim sebelumnya di giliran itu.

### Badge Posisi Antrean

Saat pesan sedang menunggu giliran di antrean agent — karena agent sedang memproses thread lain — badge **Queued #N** muncul menggantikan indikator streaming, baik di feed room maupun di panel thread (teks badge selalu dalam bahasa Inggris). Angka menunjukkan posisi run dalam antrean (berbasis 1). Badge hilang otomatis saat run dimulai, selesai, atau dibatalkan.

Timeout run 15 menit dari server dijeda selama run menunggu di antrean dan direset penuh saat run dimulai — run yang antre di belakang review panjang tidak akan timeout sebelum sempat mulai.

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

## Sub-Agent dan Orkestrasi

Selain me-@mention agent lain di sebuah room, agent utama bisa memunculkan **sub-agent**-nya sendiri — pembantu sementara yang menjalankan tugas terfokus di latar belakang lalu melaporkan hasilnya kembali. Ini memungkinkan satu agent membagi pekerjaan (riset, probing, review) secara paralel tanpa kamu merangkai tiap langkah.

### Mendefinisikan Sub-Agent

Sub-agent didefinisikan per agent. Pilih agent di **Settings > AI Agent**, lalu scroll ke kartu **Sub-agents** di panel detail. Klik **+ add sub-agent** dan isi:


- **Label** (wajib) — nama singkat seperti `probe` atau `researcher`. Muncul di chat sebagai `Ara (probe)` sehingga kamu selalu tahu sub-agent mana yang menghasilkan sebuah pesan. Label bersifat case-sensitive dan harus unik per room: dua sub-agent dari agent induk **berbeda** tidak boleh memiliki label yang sama di room yang sama. Aturan ini diberlakukan saat menautkan maupun saat mengganti nama — jika kamu mengganti nama sub-agent ke label yang sudah dipakai sub-agent lain di salah satu room tempat ia tertaut, penggantian nama akan ditolak beserta nama room-nya. Mengganti nama ke label sendiri, atau mengganti nama sub-agent yang belum tertaut ke room mana pun, selalu berhasil.
- **Role** (opsional) — jabatan singkat sub-agent (mis. "Tech Lead"), maksimal 40 karakter, satu baris. Sub-agent lama belum punya role sampai kamu mengisinya. Tampil kecil di bawah nama sub-agent di setiap pesannya di chat (feed, thread, dan saat mengetik), di daftar sub-agent di Settings, dan di popover sub-agent di header room sebagai `role · parent`. Mengganti role langsung berlaku termasuk untuk pesan lama. Dipakai juga di prompt: daftar delegasi agent utama menampilkan `@label (tier, role) — deskripsi`, dan sub-agent sendiri menerima `Your role: <role>`.
- **Description** (opsional) — teks singkat (maksimal 500 karakter) yang menjelaskan tujuan sub-agent. Sub-agent lama belum punya deskripsi sampai kamu mengisinya. Tampil satu baris di bawah label di daftar sub-agent (**Settings > AI Agent**) dan di popover **"Sub-agent milik <Agent>"** di header room; teks panjang dipotong dan teks lengkapnya muncul saat hover. Dipakai juga di prompt: daftar delegasi agent utama menampilkan `@label (tier, role) — deskripsi` (role dihilangkan jika tidak diisi) sehingga bisa memilih sub-agent yang tepat, dan sub-agent sendiri menerima deskripsi sebagai tujuannya ("Your Purpose").
- **Tier** — `quick`, `standard`, atau `deep`. Tier memilih **rantai fallback model** mana yang dipakai sub-agent (lihat [Tier Model dan Fallback](#tier-model-dan-fallback) di bawah). Secara default `quick` memakai model cepat, `standard` yang seimbang, dan `deep` yang paling mumpuni — masing-masing jatuh ke model yang lebih ringan jika model utama tidak tersedia.
- **Model override** (opsional) — kunci sub-agent ke satu model spesifik alih-alih memakai rantai tier-nya. Biarkan pada **use tier** untuk mengikuti routing tier. Model yang dikunci tidak punya fallback — ia dicoba sendirian. Dropdown mengambil daftar model dari server dan selalu sinkron dengan dropdown agent utama — model seperti Opus 5.5 muncul otomatis. Hanya model yang kompatibel dengan harness efektif sub-agent yang ditampilkan. Mengubah field **Harness** saat model tertentu sudah dipilih akan mereset pilihan ke **use tier** jika model itu tidak tersedia di harness baru. Server juga menolak model yang tidak cocok dengan harness efektif sub-agent saat disimpan.
- **Workdir** (opsional) — direktori kerja tempat sub-agent beroperasi.
- **System prompt** (opsional) — instruksi tambahan yang membentuk perilaku sub-agent.
- **Harness** (opsional) — `claude` atau `codex`. Biarkan pada **inherit from parent** (default) untuk memakai harness yang sama dengan agent induk.
- **Avatar** (opsional) — tiap sub-agent punya avatar sendiri: warna hex (`#RRGGBB`), simbol (1–4 karakter), atau gambar kustom (bisa diupload atau dihapus). Pesan sub-agent di feed dan panel thread ditampilkan dengan avatar sub-agent itu sendiri; jika tidak di-set, huruf awal label sub-agent ditampilkan sebagai seal (menggunakan warna sub-agent, atau warna induk sebagai fallback) — avatar agent induk tidak pernah digunakan. Popup mention juga menampilkan avatar sub-agent sendiri (dengan badge parent kecil) dan role. Pesan yang sudah tampil di layar langsung mencerminkan avatar baru — tanpa perlu reload halaman.
- **Memory** (opsional) — tiap sub-agent punya memory persisten sendiri (budget 2.200 karakter), terpisah dari room memory. Bisa dilihat dan diedit langsung di kartu sub-agent.

Kamu bisa mengedit atau menghapus definisi kapan saja. Definisi milik agent induk, bukan milik room tertentu.

### Memory dan Self-Learning Sub-Agent

Setiap sub-agent menyimpan **memory persisten** sendiri, terpisah dari room memory. Budgetnya 2.200 karakter dan isinya bisa dilihat serta diedit di kartu sub-agent.

**Self-learning** sudah built-in: setelah menyelesaikan tugas, sub-agent otomatis menyimpan pelajaran penting ke memory-nya sendiri tanpa perlu diperintah. Room memory bersifat read-only bagi sub-agent — mereka hanya bisa menulis ke memory milik mereka sendiri.

Agent utama juga bisa memperbarui file memory miliknya sendiri (`MEMORY.md`, `USER.md`) secara otomatis saat sedang berjalan. Agent hanya bisa menulis ke memory miliknya sendiri — tidak bisa ke milik agent lain.

### Menautkan Sub-Agent ke Room

Sub-agent yang sudah didefinisikan harus ditautkan ke sebuah room sebelum bisa dipakai di sana. Klik seal agent di header room untuk membuka **"Sub-agent milik <Agent>"**, lalu aktif/nonaktifkan tiap sub-agent untuk room tersebut. Hanya sub-agent yang tertaut yang bisa dimunculkan di room itu. Setelah tertaut, kamu juga bisa menyapa sub-agent secara langsung dengan me-@mention label-nya (misalnya `@probe`). @mention sub-agent tampil disorot biru di feed pesan (sama seperti mention agent). Popup mention menampilkan avatar sub-agent sendiri dengan badge parent kecil di sampingnya, beserta role sub-agent jika sudah diatur. Sebuah @mention yang ditulis di dalam kode inline (backtick) atau code fence (` ``` ` atau `~~~`) tidak diperlakukan sebagai pemicu — isi pesan tidak berubah, hanya deteksi pemicunya yang dilewati. Fence atau backtick yang tidak ditutup tidak menekan apa pun; mention setelahnya tetap memicu secara normal.

### Cara Kerja Orkestrasi

Saat agent utama merespons, ia bisa memicu sub-agent yang tertaut untuk menangani sub-tugas:

1. **Fire-and-forget** — tiap sub-agent menjalankan tugasnya secara independen, jadi giliran agent utama tidak pernah terblokir menunggu mereka.
2. **Auto-wake** — saat sebuah sub-agent selesai, agent utama otomatis dibangunkan untuk membaca hasilnya dan menyusun tindak lanjut. Ini berlaku ketika sub-agent dipicu oleh parent — melalui mention di respons parent, wake cascade, atau spawn via API. Wake bertahan melewati restart server (di-antre secara durable). Jika manusia atau automation me-@mention sub-agent secara langsung (tanpa juga me-mention parent di pesan yang sama), parent **tidak** dibangunkan saat sub-agent tersebut selesai — kecuali sub-agent selesai dengan error. Saat parent dibangunkan, hasil sub-agent (termasuk catatan kegagalan dan ringkasan biaya) dikirimkan sebagai task di input parent — tidak ditambahkan sebagai pesan chat di feed.
3. **Satu level dalam** — sebuah sub-agent tidak pernah bisa memunculkan sub-agent-nya sendiri. Orkestrasi tegas satu level, mencegah pohon yang meliar.
4. **Wake cascade** — saat agent utama menyintesis hasil sub-agent, @mention apapun di responsnya otomatis memicu agent atau sub-agent yang di-mention. Ini memungkinkan loop orkestrasi: misalnya, sub-agent riset selesai → agent utama baca hasilnya dan @mention reviewer → reviewer jalan → agent utama baca review dan @mention fixer → dst. Batas kedalaman (default 5 hop) mencegah rantai tak terbatas.
5. **Urutan balasan** — jika agent atau sub-agent mengirim pesan-pesan progress selama gilirannya (lewat `stoa__message_send` atau proactive API), balasan akhir ditampilkan setelah pesan-pesan progress tersebut — baik di feed maupun di thread, saat live maupun setelah reload. Bubble streaming tetap di tempatnya selama giliran berlangsung; setelah selesai, bubble berpindah ke posisi akhirnya.

### Tier Model dan Fallback

Tiap tier (`quick`, `standard`, `deep`) menyelesaikan ke **daftar model berurutan** — yang pertama adalah primary, sisanya dicoba berurutan jika primary sedang tak tersedia (kena rate limit, overload, atau timeout). Ini menjaga sub-agent tetap bekerja saat model utama mengalami gangguan sementara alih-alih gagal total.

Resolusi mengikuti urutan prioritas yang jelas:

1. **Model override sub-agent** — jika sub-agent mengunci model tertentu, model itu yang dipakai (tanpa fallback).
2. **Override tier room** — jika tidak, rantai room yang dikonfigurasi untuk tier itu yang dipakai.
3. **Default server** — jika room tidak punya override, default bawaan berlaku: `quick → haiku`, `standard → sonnet → haiku`, `deep → opus → sonnet`.

Untuk **Codex**, ketiga tier menyelesaikan ke model default yang sama yang dilaporkan agent — routing tier per model hanya berlaku untuk Claude.

Untuk menyesuaikan rantai sebuah room, buka setelan room (ikon **gear** di header room) dan pakai kartu **Model tiers**. Awalnya memakai default server; klik **override for this room** untuk mengedit rantai tiap tier — urutkan ulang model (yang pertama primary), tambah fallback, atau hapus salah satu. **Reset to server defaults** menghapus override. Model yang dikunci di sub-agent selalu menang atas rantai room.

> Fallback bergerak melewati rantai hanya pada kegagalan berskala model (rate limit, overload, timeout). Error autentikasi atau kuota ditangani oleh jalur rotasi key yang sudah ada.

### Kontrol Run

Header room menampilkan pill **"N threads · N sub-agents"** saat ada thread aktif atau sub-agent yang berjalan. Klik untuk membuka dropdown dengan dua bagian:

- **ACTIVE THREADS** — daftar thread yang sedang aktif; klik baris untuk membukanya.
- **SUB-AGENTS** — daftar tiap run aktif beserta waktu berjalannya. Dari sini kamu bisa **Stop** sebuah run (langsung menfinalisasi pesan), atau gunakan **Pause spawns** untuk memblokir sub-agent baru sambil membiarkan run yang sudah berjalan selesai. Baris sub-agent yang punya thread terkait bisa diklik untuk membuka thread tersebut.

Saat spawn dijeda, chip **"spawns paused"** muncul di header — klik untuk membuka kembali dropdown ini. Matikan untuk melanjutkan.

### Budget dan Batas Laju

Tiap room membatasi orkestrasi agar tetap terprediksi:

- **Maks sub-agent bersamaan** (default: 3) — berapa sub-agent yang bisa berjalan sekaligus di room.
- **Maks spawn per jam** (default: 10) — batas laju bergulir untuk spawn baru.

Konfigurasikan ini di setelan room (ikon **gear** di header room), pada kartu **Sub-agent budget**. Kartu yang sama punya toggle **pause new spawns** — padanan panel dari pill pause di header. Perubahan berlaku saat kamu klik **save**.

### Visibilitas Biaya dan Hasil

Setiap balasan agent yang selesai membawa **chip hasil** ringkas di bawah bubble yang menunjukkan cara run berakhir dan biayanya:

- **Alasan keluar (exit reason)** — `✓ completed`, `⏹ stopped` (dibatalkan), atau `⚠ timeout` / `⚠ error` (dua terakhir disorot).
- **Token** — total token input + output untuk giliran itu (mis. `1.3k tok`).
- **Durasi** — waktu wall-clock (mis. `47s` atau `2m 10s`).

Untuk sub-agent, biayanya **diatribusikan ke sub-agent spesifik** di log usage, sehingga biaya per sub-agent dilacak terpisah dari giliran agent induk sendiri.

Ketika sebuah orchestrator sudah menjalankan **dua sub-agent atau lebih** di sebuah room, giliran sintesis berikutnya menerima **rollup biaya** ringkas (jumlah run, total token, wall time, dan rincian per sub-agent). Orchestrator memakainya untuk menutup pipeline multi-spawn dengan ringkasan run singkat di balasannya. Spawn tunggal tidak memicu ringkasan.

### Sub-Agent Lintas Mesin

Sub-agent selalu berjalan di **mesin yang sama** dengan agent induknya. Server mengarahkan setiap trigger ke koneksi WebSocket agent induk — tidak pernah memindahkan pekerjaan ke mesin lain.

- **Deteksi offline** — jika mesin agent induk terputus saat trigger sub-agent tiba, server langsung mengembalikan error `503 parent_offline` (bukan diam-diam menerima). Chat juga menampilkan event error yang disorot sehingga pengguna tahu agent tidak bisa dijangkau.
- **Validasi working directory** — agent memvalidasi bahwa working directory yang dikonfigurasi ada di filesystem lokal sebelum menjalankan proses sub-agent. Jika path tidak ada (konfigurasi basi, mesin salah, folder terhapus), agent melaporkan error result kembali ke room alih-alih crash.

### Sub-Agent Terputus

Jika sebuah run sub-agent terpotong di tengah jalan — karena agent restart untuk mengambil update, server restart, koneksi agent terputus, atau run sudah melewati timeout 15 menit di server lalu agent-nya offline tanpa melapor hasil — agent induk otomatis dibangunkan dengan pesan berawalan **`[sub-agent TERPUTUS]`**. Ini berbeda dari `[sub-agent GAGAL]` (kegagalan logika): interupsi artinya pekerjaan dihentikan dari luar, bukan menghasilkan output yang salah.

Saat dibangunkan setelah interupsi, agent induk:
1. Memeriksa `git status` (atau setaranya) untuk pekerjaan parsial yang tersisa di working tree.
2. Memutuskan apakah men-trigger ulang sub-agent, melanjutkan dari hasil parsial, atau melaporkan ke manusia.

Server tidak pernah men-trigger ulang sub-agent secara otomatis setelah interupsi — agent induk selalu yang memutuskan.

**Pengaman:**
- Wake disimpan secara permanen. Jika agent induk sedang offline, wake dikirimkan segera setelah reconnect dengan versi terbaru.
- Jika koneksi hanya berkedip dan run sub-agent masih hidup, agent induk dibangunkan sekali lewat jalur penyelesaian normal — bukan interupsi palsu.
- Maksimal **3 wake interupsi per sub-agent per jam**. Setelah itu, muncul system event di thread — `sub-agent <label> terputus berulang (N× dalam 1 jam) — auto-wake dihentikan, butuh manusia` — dan tidak ada wake lebih lanjut sampai jam berikutnya.

Untuk menonaktifkan perilaku ini, set `STOA_ORPHAN_WAKE=off` di `.env` server.

### Scheduled Triggers

Scheduled trigger memposting task ke room sesuai jadwal dan mengirimkannya ke satu AI agent di room tersebut. Task muncul sebagai pesan di feed dengan badge **Scheduled**; balasan agent membawa badge **via Schedule**. Untuk menjalankan sub-agent, awali task dengan @mention-nya (misalnya `@probe cek disk usage`) — routing mention normal akan menangani sisanya.

Jadwal dikelola di **Room Settings > Scheduled Triggers**. Pilih agent target, tipe jadwal, cadence atau waktu, dan task. Setiap baris menampilkan waktu run berikutnya dan kalimat preview langsung (misalnya "Kira runs this every Mon, Wed, Fri at 09:00 WIB"). Jadwal yang dibuat oleh agent menampilkan label **by \<agent\>**. Badge dokter menandai konfigurasi yang bermasalah. Maksimal **20 jadwal per room**.

Lima tipe jadwal tersedia:

- **Interval** — berjalan setiap N menit (5–1440).
- **Harian** — berjalan sekali sehari pada jam tetap (`HH:MM`) di timezone yang dipilih.
- **Mingguan** — berjalan pada hari-hari tertentu setiap minggu pada jam tetap. Tersedia preset hari kerja, akhir pekan, atau setiap hari.
- **Bulanan** — berjalan pada tanggal tertentu (1–31) setiap bulan pada jam tetap. Jika bulan lebih pendek, run terjadi di hari terakhir bulan itu.
- **Tahunan** — berjalan sekali setahun pada bulan dan tanggal yang dipilih pada jam tetap. 29 Februari berjalan pada 28 Februari di tahun non-kabisat.

**Agent juga bisa mengelola jadwal** lewat HTTP API (lihat docs API). Setiap buat, ubah, atau hapus oleh agent memposting notice di room — jadi kamu cukup minta agent "buatkan jadwal yang menjalankan @probe setiap hari jam 07:00 WIB" dan agent akan mengaturnya.

Jika jadwal tidak bisa jalan karena kondisi **sementara** — agent target offline atau sedang sibuk — dicoba lagi sekitar setiap 2 menit sampai slot jadwal berikutnya. Setelah downtime server, slot yang terlewat **tidak** ditembakkan sekaligus; tiap jadwal berjalan paling banyak sekali ke depan.

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

- Menggunakan SQLite FTS5 (full-text search) dengan dukungan hybrid semantic search opsional
- Hasil menampilkan **snippet yang di-highlight** — snippet dimulai sedikit sebelum kata yang cocok agar highlight selalu terlihat
- Klik hasil untuk navigasi langsung ke pesan tersebut di room-nya
- Hasil dari dalam thread menampilkan **badge thread** — klik untuk membuka thread root
- Pencarian instan — bekerja di ribuan pesan

**Query yang toleran:** karakter khusus seperti tanda hubung, kutip, dan titik dua ditangani dengan baik — tidak ada lagi error "Search failed". Prefix matching aktif. Jika semua kata tidak ditemukan bersamaan, pencarian otomatis fallback ke kata individual.

### Pencarian Dalam Room

Tekan **Ctrl+F** (atau klik **ikon search** di header room) untuk mencari di dalam room yang sedang aktif. Search bar muncul di bagian atas area chat.

- Hasil ditampilkan sebagai **daftar scrollable** pesan yang cocok
- Setiap hasil menampilkan snippet dengan kata yang cocok di-highlight
- Klik hasil mana pun untuk **langsung melompat** ke pesan tersebut di percakapan — pesan lama dimuat otomatis jika diperlukan
- Tekan **Escape** atau klik tombol close untuk menutup search bar

### Hybrid (Semantic) Search

Saat model embedding sudah termuat, Stoa dapat menemukan pesan berdasarkan **makna**, bukan hanya kata kunci. Hasil yang ditandai **badge related** cocok secara semantik — relevan secara konseptual meski tidak mengandung kata yang kamu ketik.

- Menggunakan model `multilingual-e5-small` yang berjalan lokal — tidak ada data yang keluar dari server
- Mendukung 100+ bahasa secara native
- Saat pertama kali digunakan, model (~130 MB) diunduh sekali ke folder `models/`
- **Backfill** latar belakang mengindeks pesan yang ada (~25.000 pesan membutuhkan sekitar 25 menit pada satu core CPU; ~580 MB RAM selama backfill)
- Pencarian tetap berjalan normal selama backfill — hasil semantic muncul bertahap seiring proses pengindeksan
- Jika model belum siap, pencarian otomatis fallback ke keyword-only

Untuk menonaktifkan semantic search, set `STOA_SEMANTIC_SEARCH=off` di file `.env` dan restart server.

---

## Manajemen Agent

![Panel pengaturan agent menampilkan daftar agent dan detail konfigurasi](screenshots/settings-agents.png)

### Menambah Agent Baru

Buka **Settings > AI Agent** dan klik **+ new agent** di sidebar kiri. Panel detail beralih ke tampilan Add Agent, tempat Anda bisa mengonfigurasi:

- **Nama** (opsional) — nama tampilan agent (mis. `Idris`). Jika kosong, nama acak akan ditetapkan.
- **Bahasa** — pilih bahasa yang akan digunakan AI agent untuk merespons: English, Bahasa Indonesia, 日本語, 한국語, atau 中文

Klik **Generate command** untuk membuat token install sekali pakai. Perintah install akan muncul di bawah — setiap perintah menyertakan parameter `?token=` yang berlaku **10 menit** dan hanya bisa digunakan sekali. Klik **Regenerate** jika token kedaluwarsa.

Jalankan perintah sesuai platform di mesin tempat agent akan berjalan:

**Linux / macOS:**
```bash
curl -fsSL http://SERVER_ANDA:3000/install.sh?token=<TOKEN> | bash
```

**Windows (PowerShell):**
```powershell
irm http://SERVER_ANDA:3000/install.ps1?token=<TOKEN> | iex
```

**Windows (CMD):**
```cmd
curl -fsSL "http://SERVER_ANDA:3000/install.cmd?token=<TOKEN>" -o install.cmd && install.cmd
```

Script install akan:
1. Mengunduh file klien
2. Menginstal dependensi (ws)
3. Mendaftarkan agent dengan nama dan secret unik
4. Menyetujui workspace trust Claude Code
5. Menyiapkan PM2 untuk auto-restart dan persistensi

> **Catatan:** Perintah install tanpa token yang valid akan ditolak. Selalu generate perintah baru dari **Settings > AI Agent** sebelum melakukan instalasi.

### Mengganti Nama Agent

Pilih agent di **Settings > AI Agent**, lalu klik nama agent di header detail untuk mengeditnya secara inline.

### Mengubah Bahasa Agent

Bahasa respons setiap agent bisa diubah setelah pembuatan. Pilih agent di **Settings > AI Agent**, lalu ganti bahasa di kartu agent. Bahasa yang tersedia: English, Bahasa Indonesia, 日本語, 한국어, 中文. Perubahan langsung berlaku pada pesan berikutnya.

### System Prompt Agent

Setiap agent memiliki **System Prompt** sendiri yang dikonfigurasi di tab **Settings > AI Agent → System Prompt**. Prompt ini disisipkan di antara base system prompt dan room system prompt — dikirim ke agent di setiap room tempat agent berpartisipasi. Gunakan untuk mendefinisikan identitas, persona, bahasa kerja, dan aturan tetap agent.

Sub-agent **tidak** mewarisi system prompt agent induk. Setiap sub-agent memiliki field system prompt sendiri sehingga identitas mereka tetap independen.

### Harness Agent

Secara default, agent berjalan di **Claude CLI**. Jika mesin agent juga memiliki **Codex CLI** yang terpasang dan sudah login (via `codex login`), kamu bisa mengganti harness di dropdown **Settings > AI Agent → Agent card → Harness**.

- **Claude** — Claude Code CLI. Mendukung compact, streaming, dan resume.
- **Codex** — OpenAI Codex CLI. Memerlukan `codex` CLI terpasang dan terautentikasi di mesin agent. Sesi Codex menggunakan sandbox `danger-full-access` secara default dan mengabaikan file konfigurasi Codex user (`--ignore-user-config`). **Compact tidak didukung** — mengklik compact di sesi Codex menampilkan toast error (`compact not supported for codex harness`); auto-compact juga melewati sesi Codex secara diam-diam. `codex-session.js` didistribusikan via auto-update Stoa — agent mengunduhnya saat server diperbarui, tidak bergantung pada kapan harness diganti. Jika harness Codex dipicu sebelum `codex-session.js` ada di mesin agent, trigger gagal dengan error yang jelas; tunggu auto-update selesai (~2 menit setelah server update).

Mengganti harness agent di **room campuran** (di mana AI agent lain masih bisa menjalankan model room) membiarkan model room tetap seperti apa adanya — agent ini yang akan fallback ke default-nya sendiri. Toast mengonfirmasi: misalnya `room model kept in 2 mixed rooms (Kira uses codex-default)`. Jika tidak ada AI lain di room yang bisa menjalankan model room saat ini, model room di-rewrite ke default harness baru. Jika setelan **Default model** agent tidak kompatibel dengan harness baru, setelan itu otomatis di-reset — toast menampilkan `default model reset (old-model)`.

Sub-agent juga bisa memilih harness sendiri, atau membiarkannya pada **inherit from parent** (default).

**Mengecek ketersediaan harness:** Setelah menginstal atau login CLI tool di mesin agent, klik tombol **Check** di sebelah dropdown Harness (di panel detail agent atau accordion di **Settings > AI Agent**) untuk mendeteksi ulang tanpa restart agent. Tombol ini nonaktif saat agent offline, dan deteksi bisa memakan waktu hingga ~15 detik. Dropdown langsung diperbarui ketika hasil tiba — harness baru yang terdeteksi ditampilkan via toast. Rescan juga mengecek ulang harness bersama working directory.

**Merestart untuk menerapkan pembaruan CLI:** Setelah memperbarui CLI tool di mesin agent, klik **ikon power** (**Restart agent**) di header agent, di antara force update dan remove. Bar konfirmasi muncul di bagian atas — konfirmasi untuk merestart sekarang; semua proses agent yang sedang berjalan langsung berhenti. Percakapan dilanjutkan dari posisi terakhir lewat resume sesi. Ikon hanya aktif kalau agent online dan dikelola PM2; agent yang dijalankan manual, di bawah systemd, atau launchd tidak didukung (restart di luar PM2 akan menghentikan agent secara permanen). Saat restart berlangsung, ikon berubah amber dan berkedip; arahkan kursor untuk melihat **restarting…**, lalu toast mengonfirmasi agent kembali online. Check tidak merestart agent.

Untuk **Codex**, daftar model disinkronkan otomatis setiap kali agent terhubung — tidak perlu Check manual. Set aktif adalah gabungan dari semua agent yang online, sehingga dua agent dengan versi Codex berbeda tidak saling menonaktifkan model miliknya; model dinonaktifkan hanya kalau tidak ada agent online yang melaporkannya. Check juga memicu sinkronisasi ini secara manual. Model yang disembunyikan CLI dibuang, hasilnya diurutkan sesuai prioritas CLI, dan jika belum ada default, model pertama dari reporter jadi default. Dropdown model room langsung diperbarui. Kalau ada model baru, muncul toast seperti `Codex CLI: 2 new models`. Jika agent tidak bisa melaporkan daftar model (CLI versi lama atau perintah gagal), Stoa memakai daftar model bawaannya. **Claude** tidak punya sinkronisasi serupa — daftar modelnya selalu dari daftar bawaan Stoa ditambah entri kustom yang ditambahkan di **Settings > Platforms**.

Harness yang sudah terinstal tapi belum login tampil di dropdown sebagai **"(not logged in)"** dan tidak bisa dipilih — server juga akan menolaknya. Jika status login tidak bisa dipastikan, harness tetap bisa dipilih. Jika harness yang sedang aktif menjadi tidak tersedia atau kehilangan login, muncul hint merah di bawah dropdown Harness — harness tidak diganti otomatis.

**Error:** `agent offline` — agent tidak terhubung; `agent disconnected` — agent terputus saat pengecekan berlangsung; `agent did not respond — agent version may be too old, wait for auto-update` — agent belum mendukung deteksi harness (versi lama).

### Default Model Agent

Setiap agent punya setelan **Default model** di dropdown **Settings > AI Agent → Agent card → Default model**. Ini adalah model yang digunakan agent sebagai fallback saat model room tidak kompatibel dengan harness-nya.

Dropdown hanya menampilkan model yang kompatibel dengan harness agent saat ini. Opsi pertama — **"follow harness default — \<model\>"** (nilai: tidak ada) — memberi tahu agent untuk memakai default bawaan harness, bukan model yang dipilih manual.

**Urutan resolusi model** saat server memilihkan model untuk agent:

1. **Model room** — kalau harness agent bisa menjalankannya, model room dipakai.
2. **Default model agent** — kalau ada yang diset dan kompatibel dengan harness.
3. **Default harness** — model bawaan harness (misalnya model pertama dari `codex debug models`).
4. **Default CLI** — agent berjalan tanpa flag `-m`, membiarkan CLI yang memilih.

Konfigurasi platform (base URL, API key) hanya dikirim saat model room yang digunakan langsung. Kalau agent fallback ke sumber lain, konfigurasi platform tidak dikirimkan.

Sub-agent yang memiliki tier menggunakan jalur resolusi tersendiri — lihat [Tier Model dan Fallback](#tier-model-dan-fallback).

### Menghapus Agent

Pilih agent di **Settings > AI Agent**, lalu klik tombol **remove** di header detail. Konfirmasi penghapusan di popup. Agent akan di-unregister dan dihapus dari semua room.

Agent yang sudah pernah mengirim pesan atau punya catatan pemakaian tidak bisa dihapus — Stoa menolak permintaan tersebut agar riwayatnya tetap terjaga, dan tidak ada yang berubah. Hanya agent yang belum punya riwayat apa pun yang bisa dihapus.

### Status Online Agent

Titik hijau di samping nama agent di sidebar dan header room menunjukkan status online. Footer sidebar juga menampilkan status koneksi WebSocket Anda.

### Self-Healing Agent

Agent secara otomatis:
- **Reconnect** jika koneksi WebSocket terputus (exponential backoff)
- **Recovery** dari crash Claude CLI
- **Auto-update** saat file klien di server berubah (cek tiap 2 menit dan sekali saat startup sebelum online, restart via PM2). Selama ada tool call yang berjalan, **tidak ada watchdog** (idle setelah token pertama: 5 menit, idle sebelum token pertama: 10 menit, stale sweep, maupun restart update) yang akan memotong run sampai 30 menit tanpa progres. Tanpa tool call aktif, batas normal berlaku: watchdog idle 5 menit (10 menit sebelum token pertama), dan 3 menit untuk restart update.
- **Antrean retrigger** — jika trigger datang saat agent sedang mengunduh update, trigger disimpan secara durable dan dikirim ulang otomatis setelah agent terhubung kembali dengan versi terbaru. Urutan dalam tiap thread dipertahankan (FIFO); trigger duplikat dihapus. Jika pengiriman gagal 3 kali atau trigger sudah lebih dari 30 menit, trigger dibuang dan notifikasi sistem dikirim ke thread dan room feed.

### Re-autentikasi Agent

Jika kredensial Claude agent kedaluwarsa, agent akan membalas dengan "Not logged in · Please run `/reauth`". Kamu bisa melakukan re-autentikasi dari jarak jauh melalui Stoa tanpa perlu menyentuh mesin agent:

1. Di room dengan **tepat satu AI agent**, ketik `/reauth`
2. Link muncul di chat — buka dari perangkat mana saja dan otorisasi dengan akun Anthropic kamu
3. Setelah otorisasi, browser menampilkan code — paste di chat sebagai `REAUTH:<code>`
4. Konfirmasi bubble muncul dan agent kembali aktif normal

Untuk keluar dari akun Claude agent (misalnya untuk ganti akun atau test flow re-auth), ketik `/logout` di room single-agent yang sama.

> Kedua command ini dibatasi untuk room dengan tepat satu AI agent, karena kredensial Claude bersifat global per mesin — re-autentikasi berlaku untuk semua agent di mesin tersebut.

### Working Directory

Setiap agent memiliki satu atau lebih **working directory** — folder tempat sesi Claude agent berjalan. Anda bisa:

- Melihat workdir agent di **Settings > AI Agent** dengan memilih agent (ditampilkan di kartu Workdirs)
- Menambah workdir baru via UI atau API
- Menetapkan workdir tertentu ke room saat pembuatan

**Auto-import CLAUDE.md:** saat agent terhubung ke room, Stoa mengecek apakah workdir memiliki file `CLAUDE.md` yang tidak di-track oleh git. Jika ada, konten file otomatis diimpor sebagai **system prompt** room — memberi agent konteks proyek sejak pesan pertama. Jika CLAUDE.md sudah di-track git (ter-commit ke repo), file tidak disentuh dan tidak diimpor. Untuk beberapa workdir dalam satu room, konten masing-masing digabungkan dengan header per sumber. System event dikirim ke room saat impor terjadi.

### Versi Klien

Setiap agent melaporkan **versi klien** (misal `v0.2.2`) ke server. Versi bisa dilihat di baris sidebar agent di **Settings > AI Agent**. Ini membantu melacak agent mana yang menjalankan kode klien terbaru.

### Kontrol Agent

Pilih agent di **Settings > AI Agent** untuk melihat tombol aksi di header detail:

- **Rescan** — scan ulang working directory dan ketersediaan harness agent
- **Force Update** — paksa agent mengecek update klien segera (normalnya cek tiap 2 menit)
- **Remove** — hapus registrasi agent (dengan konfirmasi). Agent yang punya riwayat chat atau catatan pemakaian tidak bisa dihapus.

**Compact Session** — kompres riwayat percakapan agent untuk mengurangi ukuran konteks. Buka panel thread dan klik tombol compact (ikon ↕) di header panel. Progress bar muncul di dalam panel thread selama proses berlangsung — agent merangkum konteks sebelumnya dan melanjutkan tanpa gangguan. Berguna saat percakapan sudah sangat panjang dan kualitas respons mulai menurun. Compact tidak didukung untuk sesi harness Codex — mengklik compact menampilkan toast error (`compact not supported for codex harness`).

### Auto-Compact

Stoa secara otomatis mengompres sesi agent tanpa intervensi manual. Dua mekanisme berjalan secara paralel:

- **Pengecekan per-trigger** — setelah setiap respons agent, Stoa mengecek ukuran file sesi. Jika ukurannya melebihi ambang batas compact yang dikonfigurasi (default 500 KB, dapat diubah di Settings → Server), agent menjalankan `/compact` segera setelah mengirim balasannya, lalu memberi tahu server. User menerima respons lebih dulu; kompaksi terjadi di latar belakang.
- **Worker latar belakang** — setiap 60 menit, agent memindai semua sesi terbuka di mesinnya dan mengompres yang melebihi ambang batas compact yang dikonfigurasi. Ini juga membersihkan sesi yang terbuka secara lokal tetapi tidak aktif di room Stoa mana pun.

Saat auto-compact berjalan, progress bar compact muncul di panel thread (sama seperti compact manual) dan compact marker tersimpan di riwayat pesan thread. Marker ini persisten dan tetap terlihat setelah refresh halaman.

Kedua mekanisme melewati sesi yang berjalan di harness Codex — Codex tidak mendukung compact.

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

## Panel Agents

![Panel Agents menampilkan peserta room dan sub-agent yang ditautkan](screenshots/agents-panel.png)

**Panel Agents** adalah popover di right sidebar untuk melihat dan mengelola peserta room serta sub-agents. Klik **ikon users** di right sidebar (antara tombol Workspace dan divider) untuk membukanya.

### Participants

Menampilkan semua agent yang ada di room — setiap baris menampilkan avatar, nama, tipe (AI atau human), dan status **online / offline** secara langsung.

Untuk menambah agent baru, gunakan form **Add Agent** di bagian bawah section: pilih agent dari dropdown, pilih **working directory**-nya, lalu klik **Add Agent**. Hanya agent yang belum ada di room yang ditampilkan.

### Sub-Agents

Menampilkan dua grup:

- **Linked** — sub-agents yang sudah di-link ke room ini. Setiap baris menampilkan label dan nama parent agent. Klik **Unlink** untuk melepas link.
- **Available** — sub-agents yang sudah didefinisikan di agent manapun dalam room, tapi belum di-link. Klik **Link** untuk mengaktifkannya di room ini.

> Ini adalah alternatif dari mengklik seal agent di header room — keduanya mengelola link sub-agent yang sama.

---

## Ekspor Percakapan

Anda bisa mengekspor seluruh riwayat percakapan room sebagai **JSON** atau **CSV**. Klik **tombol export** di header chat dan pilih format. Download mencakup semua pesan, timestamp, dan nama peserta.

---

## Automation

Stoa mendukung **automation berbasis Slack, WhatsApp, dan Email** — aturan yang aktif saat event masuk cocok dengan kondisi yang ditentukan dan otomatis mengirim prompt ke room target.

### Mengelola Koneksi

Buka **Settings > Automation > Connections** untuk mengelola koneksi. Setiap koneksi adalah sesi live terpisah dengan kredensial sendiri.

Klik **+ add connection** untuk menambah koneksi baru. Pilih **Provider** terlebih dahulu:

**Koneksi Slack:**
- **Name** — label untuk koneksi ini (contoh: "Workspace Qiscus")
- **Token Type** — `bot` (Bot Token `xoxb-...`) atau `user` (User Token `xoxp-...`)
- **App Token** (`xapp-1-...`) — untuk koneksi WebSocket Socket Mode
- **Bot / User Token** — token yang menerima event dan melakukan API call

Lihat [panduan setup Slack](doc-slack-setup) untuk instruksi langkah demi langkah membuat token Slack app.

**Koneksi WhatsApp:**
- **Name** — label untuk koneksi ini (contoh: "Support WA")
- **Phone Number** — opsional, hanya untuk referensi
- **Max Media Size (MB)** — ukuran maksimum file media yang diunduh (default 100 MB)

Klik **Connect & Show QR** untuk memulai sesi WhatsApp dan membuka modal QR code. Scan QR dengan aplikasi WhatsApp Anda untuk autentikasi. Setelah terhubung, kartu menampilkan JID ponsel yang terhubung dan titik hijau. Gunakan **Show QR** untuk menampilkan QR code baru jika sesi kedaluwarsa.

**Koneksi Email (IMAP):**
- **Name** — label untuk koneksi ini (contoh: "Gmail Pribadi")
- **Preset** — **Gmail** (otomatis pakai `imap.gmail.com:993`) atau **Custom IMAP** (server IMAP apapun)
- **IMAP Host / Port** — hanya tampil untuk Custom IMAP; isi alamat server dan port
- **Email address** — username akun (contoh: `kamu@gmail.com`)
- **App Password** — untuk Gmail, wajib pakai App Password, bukan password biasa. Buka Google Account → Security → 2-Step Verification → App passwords. Google mewajibkan 2-Step Verification aktif di akun. Untuk provider lain, gunakan password akun atau password IMAP khusus.
- **Folder** — folder mailbox yang dipantau (default: `INBOX`)
- **Allowed senders** — satu alamat email atau wildcard domain per baris (contoh: `bos@perusahaan.com`, `*@kantor.com`). **Minimal satu entri wajib diisi** — koneksi tanpa allowed senders tidak akan memicu automation (default deny). Siapapun bisa mengirim email ke inbox, dan isi email bisa mencoba memanipulasi agent (prompt injection).
- **Require sender verification** — saat aktif (default: aktif), email yang gagal verifikasi DMARC atau DKIM dibuang secara diam-diam. Ini mencegah alamat `From` palsu melewati allowlist.
- **Sender name** *(opsional)* — nama tampilan yang muncul di header `From` email balasan (contoh: `Tim Dukungan`). Kalau dikosongkan, nama agent yang membalas digunakan sebagai fallback. Alamat pengirim tetap akun Gmail — hanya nama tampilan yang berubah.

  > **Tips:** Isi dengan nama yang mudah dikenali (misalnya nama pemilik akun) agar penerima tidak bingung dan dapat sedikit membantu deliverability email.

Koneksi email menggunakan **IMAP IDLE** untuk pengiriman realtime — sepenuhnya outbound dari server ke provider email, jadi tidak butuh endpoint publik atau aturan firewall. Bekerja lancar di belakang Tailscale.

Email masuk memicu aturan automation. Agent juga bisa **membalas** email tersebut lewat API (lihat [Membalas Email](#membalas-email) di bawah).

> **Outlook / Microsoft 365:** Belum didukung di versi ini — Microsoft sudah menonaktifkan autentikasi IMAP dasar. Dukungan OAuth2 direncanakan untuk rilis berikutnya.

**Test connection:** Klik **Test connection** sebelum menyimpan untuk memverifikasi kredensial dan konektivitas. Di mode edit, kosongkan field password untuk memakai password tersimpan (terenkripsi) — password tersimpan tidak pernah ditampilkan lagi setelah setup awal.

**Penyimpanan password:** Password disimpan terenkripsi di server dan tidak pernah dikembalikan melalui API.

Setiap kartu koneksi menampilkan status terkini: **connecting**, **connected**, **disconnected**, atau **error**. Gunakan tombol **reconnect** untuk mencoba ulang, atau tombol **edit** dan **delete** untuk mengelolanya.

### Membuat Aturan Automation

Setelah minimal satu koneksi aktif, klik **+ new rule** untuk membuat aturan:

- **Name** — label deskriptif untuk aturan
- **Connection** — koneksi mana yang memicu aturan ini, atau **Any connection** untuk mencocokkan event dari semua koneksi
- **Trigger event** — event yang memicu aturan (opsi bergantung pada provider):
  - *Slack:* `message`, `message.groups`, `mention`, `reaction_added`
  - *WhatsApp:* `message` (pesan langsung), `group_message` (pesan grup), `group_mention` (bot di-tag di grup), `message_any` (DM + grup)
  - *Email:* `message` (Email baru diterima)
- **Conditions** — filter opsional pada event: `contains`, `not_contains`, `starts_with`, atau `matches_regex`. Beberapa kondisi di-AND-kan. Batasan `matches_regex`: pola maksimal 200 karakter, nested quantifier ditolak (proteksi ReDoS), input dipotong di 5.000 karakter, pola yang menyebabkan backtracking berlebihan ditolak saat penyimpanan dengan error 400. Field kondisi berbeda per provider:
  - *Slack:* `message text`, `full text`, `slack_user`, `slack_channel`, `slack_bot_id`
  - *WhatsApp:* `message text`, `sender JID`, `chat ID`
  - *Email:* `from address`, `subject`, `has attachments`
- **Target room** — room Stoa mana yang menerima pesan yang dipicu
- **Prompt template** — pesan yang dikirim ke room. Gunakan variabel:
  - *Slack:* `{{slack_message_text}}`, `{{slack_message_link}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{extracted_url}}`, `{{slack_thread_ts}}`
  - *WhatsApp:* `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{extracted_url}}`
  - *Email:* `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

  > **Catatan keamanan (Email):** `{{email.body}}` adalah data tidak tepercaya. Email yang dikirim secara khusus bisa mencoba memanipulasi agent. Pertimbangkan untuk membungkusnya dengan delimiter di prompt agar jelas bahwa ini adalah data, bukan instruksi.
- **Reply to WhatsApp** *(hanya koneksi WhatsApp)* — jika diaktifkan, server menyisipkan blok konteks WhatsApp ke dalam prompt yang berisi info pengirim, chat ID, dan instruksi untuk agent. Agent dapat membalas ke WhatsApp menggunakan marker `[wa:reply]` di output-nya:

  ```
  [wa:reply]Pesan balasan Anda di sini[/wa:reply]
  ```

  Server akan menangkap marker tersebut, mengirim teks ke pengirim WhatsApp, menghapus marker dari pesan room, dan mencatat pesan keluar. Jika agent tidak menggunakan marker, server akan mengirim seluruh respons AI seperti sebelumnya.

  Blok konteks juga memberi tahu agent tentang **API riwayat pesan** — agent dapat membaca riwayat chat terbaru via:

  ```
  curl <base_url>/api/automations/connections/<connId>/messages?chatId=<chatId>&limit=20
  ```

  Gunakan CLAUDE.md room untuk menginstruksikan agent kapan harus membaca riwayat dan bagaimana merespons.

- **Watch Replies** *(koneksi Slack dan Email)* — saat diaktifkan, pesan lanjutan dalam percakapan yang sama akan diarahkan ke thread Stoa yang sudah ada, bukan membuka thread baru.

  *Slack:* Balasan thread di Slack yang memicu automation ini diteruskan ke thread Stoa yang sama. Setiap balasan masuk dengan format:

  ```
  [New Reply on Thread]: nama_pengirim (id_pengirim) - isi pesan
  ```

  Jika ada automation lain yang terpicu di Slack thread yang sama, pesannya juga masuk ke thread Stoa yang sudah ada.

  *Email:* Email masuk yang header `In-Reply-To` atau `References`-nya cocok dengan pesan sebelumnya di koneksi yang sama akan diarahkan ke thread Stoa yang sudah ada. Hanya balasan dari pengirim yang sama dengan email awal yang diterima; email dari pengirim berbeda akan membuat thread baru. Ini memastikan agent punya konteks percakapan lengkap untuk pertukaran email multi-giliran.

  Agent tidak otomatis membalas pesan lanjutan kecuali system prompt menginstruksikannya. Default: nonaktif.

  Balasan yang cocok dengan kondisi trigger automation juga ditampilkan di room feed — lihat [Thread Broadcast](#thread-broadcast).

### Aktifkan / Nonaktifkan

Setiap aturan memiliki toggle aktif/nonaktif. Aturan yang dinonaktifkan tidak pernah aktif, meski event cocok.

### Membalas Email

Agent di dalam room bisa membalas email yang memicu automation. Endpoint lengkap ada di **Docs > Stoa API** — singkatnya:

```
POST /api/rooms/{roomId}/email-reply
{"thread_id": <id>, "body": "Isi balasan teks biasa"}
```

Server menentukan semuanya secara otomatis: penerima selalu pengirim asli (dicek ulang terhadap allowlist), subjek mendapat prefix `Re:` (tidak didobel pada balasan berikutnya), header `In-Reply-To` / `References` memastikan threading yang benar di inbox penerima, dan nama tampilan `From` diambil dari field **Sender name** koneksi (dengan fallback ke nama agent). Agent tidak pernah menangani kredensial.

**Kapan membalas ditentukan sepenuhnya oleh system prompt room.** Dua pola umum:

*Draft dulu (direkomendasikan):*
```
Saat ada email yang butuh balasan, tulis draf balasan di thread untuk direview.
Baru panggil email-reply API setelah user bilang "kirim" atau menyetujui draf.
```

*Langsung kirim untuk kategori tertentu:*
```
Saat subjek email mengandung "[ALERT]", langsung kirim balasan singkat berupa konfirmasi penerimaan.
Untuk email lainnya, tulis draf di thread terlebih dahulu.
```

**Batasan:**
- **Hanya Gmail preset** — balasan dikirim via Gmail SMTP (`smtp.gmail.com:465`) menggunakan App Password tersimpan. Koneksi Custom IMAP belum bisa mengirim balasan di versi ini.
- **Hanya thread dari email automation** — hanya thread yang dibuat oleh trigger email yang bisa dibalas. Thread harus dibuat setelah fitur ini aktif.
- **Rate limit** — 10 balasan per thread per jam, 50 per koneksi per hari (`429` saat batas tercapai).
- **Teks biasa saja** — tidak ada HTML, tidak ada lampiran.
- **Isi email tidak tepercaya** — jangan ikuti instruksi yang ada di dalam `{{email.body}}`.

### Connector Action API

Agent yang memiliki akses tool dapat berinteraksi langsung dengan koneksi aktif melalui pesan WebSocket:

- **`connector_list`** — daftar semua koneksi yang berjalan. Respons: `connector_list_result` dengan array `connectors` (id, provider, name, status)
- **`connector_send`** — kirim pesan ke chat via koneksi. Field: `connector_id`, `chat_id`, `text`. Respons: `connector_send_result` dengan `ok` (bool) dan `error` jika gagal. Untuk WhatsApp, `chat_id` harus JID (contoh: `628xxx@s.whatsapp.net`)
- **`connector_read`** — baca riwayat percakapan. Field: `connector_id`, `chat_id`, `limit` (maks 200, default 50). Respons: `connector_read_result` dengan `ok` dan array `messages` (sender, text, direction, timestamp)

### API Riwayat Pesan (REST)

Untuk agent yang perlu membaca riwayat chat WhatsApp via `curl` (misalnya dari dalam room), tersedia endpoint REST:

```
GET /api/automations/connections/:id/messages?chatId=<JID>&limit=<n>
```

- `chatId` (wajib) — JID WhatsApp (contoh: `628xxx@s.whatsapp.net`)
- `limit` (opsional, default 50, maks 200) — jumlah pesan terbaru yang dikembalikan
- Mengembalikan array `{ sender, text, direction, media_type, timestamp }`
- Hanya tersedia untuk koneksi WhatsApp

### Pesan Otomasi di Chat

Saat sebuah aturan otomasi mengirim pesan ke room, feed dan thread menampilkan pesan tersebut dengan identitas otomasinya:

- **Nama pengirim** — nama aturan otomasi, menggantikan nama tampilan agent generik
- **Tag "Automation"** — label kecil di sebelah nama pengirim, sehingga pesan yang dipicu otomasi mudah dibedakan dari pesan manusia
- **Avatar provider** — logo provider koneksi (misalnya logo Slack untuk koneksi Slack) ditampilkan sebagai avatar. Untuk provider yang tidak dikenal, ikon bot generik digunakan sebagai fallback.

**Relay Watch Reply (Slack dan Email):** Saat *Watch Replies* diaktifkan, pesan lanjutan yang diarahkan ke thread Stoa yang sudah ada mewarisi identitas otomasi yang memicu thread asal. Untuk Slack, ditampilkan sebagai `[New Reply on Thread]: ...`. Jika pesan root dibuat sebelum fitur ini ada dan tidak memiliki metadata otomasi, relay akan tampil sebagai "Slack" (atau "Email") dengan logo provider — bukan sebagai pesan manusia.

**Otomasi yang dihapus:** Jika aturan otomasi dihapus setelah mengirim pesan, pesan-pesan tersebut tetap menampilkan nama pengirim dan logo provider sebagai snapshot. Nama rule dan provider disimpan di setiap pesan, sehingga menghapus rule tidak mempengaruhi tampilan history.

Hanya pesan yang dikirim *setelah* fitur ini diperkenalkan yang membawa identitas otomasi. Pesan otomasi yang lebih lama tetap ditampilkan seperti sebelumnya.

---

## Skills

![Halaman daftar Skills menampilkan search, filter chip, dan baris skill dengan badge pembuat](screenshots/skills.png)

Skill adalah paket instruksi yang tersimpan terpusat di server Stoa — file `SKILL.md` beserta file pendukung opsional (skrip, template, gambar, data). Semua agent dan sub-agent bisa memakai skill di mesin mana pun.

Buka **Skills** di nav sidebar (antara Automation dan MCP) untuk mengelola library skill.

### Daftar Skill

Daftar menampilkan setiap skill dengan `/nama` (monospace), deskripsi, pembuat (avatar kamu atau avatar agent pembuat dengan badge), versi, jumlah file, ukuran, dan waktu terakhir diperbarui.

Kontrol per baris:
- **Toggle aktif** — skill yang dinonaktifkan tidak muncul di autocomplete composer dan tidak di-resolve di pesan.
- **Menu ⋯** — Edit, Export `.zip`, History, Hapus.

Filter chip: **Semua · Punyaku · Buatan agent · Nonaktif**. Cari berdasarkan nama atau deskripsi. Drag file atau arsip ke halaman untuk langsung import.

### Membuat Skill

Klik **New skill → Write from scratch**. Editor terbuka dengan template kosong dan dua panel:

- **Kiri — file tree**: `SKILL.md` dipinned dan tidak bisa dihapus. Ada tombol tambah file, tambah folder, dan upload. Klik kanan (long-press di tablet) untuk rename atau hapus item.
- **Kanan — editor**: `SKILL.md` dibuka di editor markdown dengan tab **Edit / Preview**. Field **nama**, **deskripsi**, dan **argument hint** di atas editor adalah sumber kebenaran — edit di form, dan frontmatter `SKILL.md` di-generate otomatis saat save. File teks lain (`.js`, `.py`, `.json`, `.md`, `.css`, `.html`) dibuka di editor syntax-highlighted; gambar ditampilkan preview; file binary menampilkan link download.

Klik **Save** untuk membuat revisi baru. Catatan revisi opsional ada di footer. Indikator "unsaved" muncul saat ada perubahan yang belum disimpan.

### Import Skill

Klik **New skill → Import file** (atau drag file ke halaman). Format yang didukung:

| Input | Keterangan |
|---|---|
| `.md` | Menjadi `SKILL.md`; tidak ada file pendukung |
| `.zip` / `.skill` | `SKILL.md` di root atau di dalam satu folder top-level tunggal |
| `.tar.gz` / `.tgz` / `.tar` | Aturan layout sama dengan `.zip` |
| Folder (drag-drop atau **Import folder**) | File dikirim sebagai multipart dengan relative path |
| URL GitHub | `https://github.com/<owner>/<repo>[/tree/<ref>/<path>]` — server mengunduh tarball publik; tidak perlu token. Ref yang mengandung `/` tidak didukung. |

**Dialog preview** muncul setelah memilih input, menampilkan nama, deskripsi, daftar file, total ukuran, dan peringatan apa pun. Nama bisa di-override kalau ada konflik. Konfirmasi untuk menyimpan dan membuka editor.

**Batasan:** 50 MB total, 20 MB per file, 300 file, `SKILL.md` maks 64 KB. Arsip dengan path absolut, traversal `..`, symlink, entry terenkripsi, atau path duplikat case-insensitive akan ditolak.

### Memanggil Skill

Ketik `/` di composer room atau thread untuk membuka popup autocomplete skill. Navigasi dengan tombol panah; konfirmasi dengan Enter atau Tab. Skill yang dipilih muncul sebagai **chip** di composer. Tambahkan argumen setelah chip dan gabungkan dengan `@mention` kalau perlu (misal `@Kenji /stoa-audit cek branch Y`).

Skill di-resolve di level token: `/nama` di awal pesan atau setelah spasi (maks 3 per pesan) dicocokkan dengan skill yang aktif. Token yang tidak dikenal tetap sebagai teks biasa. Balasan agent menampilkan chip **"used /nama vN"** di bawah bubble, baik saat live streaming maupun setelah reload halaman.

Konten skill di-prepend ke prompt agent; file pendukung di-cache di mesin agent pada `~/.stoa/skills/<nama>/<hash>/` saat pertama dipakai. Kalau server tidak dapat dijangkau, versi cache dipakai dengan catatan di preamble.

### Skill Buatan Agent

Agent dan sub-agent bisa membuat dan mengelola skill menggunakan enam MCP tool bawaan:

| Tool | Siapa yang bisa | Yang dilakukan |
|---|---|---|
| `stoa__skill_list` | semua agent | Mengembalikan nama, deskripsi, argument hint, pembuat, dan versi semua skill yang terlihat. |
| `stoa__skill_get` | semua agent | Mengembalikan isi `SKILL.md`, atau membaca satu file teks (≤ 256 KB) tanpa mengunduh. File biner dan file di atas 256 KB ditolak; gunakan `stoa__skill_use` untuk itu. |
| `stoa__skill_use` | semua agent | Mensinkronkan skill ke mesin agent (mengunduh file pendukung ke `~/.stoa/skills/<name>/<hash>/`) dan mengembalikan isi beserta path direktori lokal. |
| `stoa__skill_create` | agent / sub-agent | Membuat skill baru. `files` menerima `{path, content}` atau `{path, content_base64}`. Total payload maks 5 MB lewat MCP; bundle lebih besar pakai `POST /api/skills/import`. |
| `stoa__skill_update` | pembuat saja | Membuat revisi baru. Bisa memperbarui deskripsi, argument hint, isi, upsert atau hapus file pendukung, dan menambah catatan revisi. Tidak bisa rename atau toggle enabled. |
| `stoa__skill_delete` | pembuat saja | Menghapus skill secara permanen. |

**Tanpa approval** — tool-tool ini bekerja seperti semua tool bawaan `stoa__*` lainnya dan tidak pernah memunculkan dialog persetujuan.

**Kepemilikan:** Agent hanya bisa mengubah atau menghapus skill buatannya sendiri. Parent agent bisa mengelola skill buatan sub-agentnya. Skill milik kamu atau agent lain mengembalikan error `not_found` untuk mencegah enumerasi. Kamu tetap punya kontrol penuh — nonaktifkan atau hapus skill apa pun dari halaman Skills.

**Kuota:**
- 50 skill per agent. Skill sub-agent dihitung ke kuota parent agent.
- 200 skill total di seluruh library. Kamu (owner) tidak kena batas ini.
- Create atau update lewat MCP: maks 5 MB total (isi + semua file gabungan). Untuk bundle lebih besar, pakai `POST /api/skills/import`.

**Katalog skill di system prompt:** Agent yang punya tool `stoa__*` otomatis mendapat blok `<stoa-skills>` di system prompt yang mencantumkan hingga 40 skill aktif beserta nama dan deskripsinya (maks 4 KB, tanpa isi). Setelah skill berubah, sesi agent di-resume sekali di turn berikutnya — konteks tetap utuh.

**Client lama:** Jika client agent tidak mendukung fitur `skill_sync` (sebelum v0.4.440), `stoa__skill_use` mengembalikan isi `SKILL.md` tanpa mengunduh file pendukung (`dir: null`, `files_unavailable` diset). Update client agent untuk mengaktifkan sinkronisasi file penuh.

Cache di mesin agent menyimpan maks 2 versi per skill. Skill yang sudah tidak ada di server tidak pernah dijalankan dari cache.

### Riwayat, Diff, dan Restore

Editor skill punya dua tab: **Files** (file tree dan editor) dan **History** (daftar revisi lengkap).

Tab History menampilkan setiap revisi beserta nomor versi, pembuat (kamu atau agent), timestamp, catatan revisi, dan ringkasan perubahan file.

Klik revisi untuk membuka tampilan diff dengan dua tab:
- **SKILL.md** — diff baris per baris dengan versi aktif, beserta baris konteks di sekitarnya.
- **Changes** — ringkasan per file: file hanya ada di revisi itu, file hanya ada di versi aktif, file yang isinya berbeda, dan file yang permission-nya berbeda.

**Restore** — klik **Restore** di revisi mana pun untuk membuat revisi baru yang mengembalikan isi revisi tersebut. Konfirmasi muncul secara inline. Kalau editor punya perubahan yang belum disimpan, konfirmasi memperingatkan bahwa perubahan itu akan dibuang.

### Export

Unduh skill sebagai arsip zip:
- **Bar editor** — klik **Export** untuk mengunduh versi yang sedang ditampilkan.
- **Baris History** — **⋯ → Export** di revisi mana pun mengunduh revisi itu sebagai `<name>-vN.zip`.

Arsip berisi satu folder `<name>/` dengan `SKILL.md` dan semua file pendukung. Izin exec dan timestamp file (sesuai waktu revisi) tetap terbawa. Zip ini bisa di-import ulang lewat **Import**.

Export hanya tersedia untuk owner lewat UI — agent tidak bisa mengakses endpoint export.

### Perubahan dari Tempat Lain

Jika skill diubah dari tempat lain (agent lewat MCP, atau tab browser lain) saat editor sedang terbuka:

- **Tidak ada perubahan yang belum disimpan** — editor diam-diam memuat versi terbaru.
- **Ada perubahan yang belum disimpan** — muncul banner: *"This skill changed (vN) since you opened it."*
  - **Reload** — membuang editanmu dan memuat versi terbaru.
  - **Keep editing** — mempertahankan editanmu di atas versi terbaru. Hanya field dan file yang kamu ubah yang menimpa perubahan remote; pembaruan field lain dari versi baru tetap dipakai.

Mencoba menyimpan versi yang sudah basi akan memunculkan banner yang sama, bukan menimpa diam-diam.

---

## MCP

**MCP (Model Context Protocol)** memberi agent AI *tool* yang bisa mereka panggil sendiri — pencarian file, penelusuran kode, issue tracking, dan lainnya. Install satu MCP server di Stoa, dan semua agent (Claude Code, Codex, sub-agent, agent di mesin mana pun) bisa memakai tool-nya, dengan kredensial tersimpan terpusat dan akses dikontrol per agent.

**MCP vs Connections:** Connections (Automation) adalah *telinga* — mendengarkan event masuk dari Slack, WhatsApp, dan email lalu men-trigger agent. MCP server adalah *tangan* — tool yang dipanggil agent atas inisiatifnya sendiri saat berkerja. Layanan yang sama (misalnya GitHub) bisa ada di keduanya; kredensialnya independen.

Buka seksi **MCP** di nav app (di bawah Automation).

### Tab Installed

Setiap MCP server yang terinstall ditampilkan sebagai kartu berisi:

- **Ikon brand** (atau inisial jika tidak tersedia) dan **nama** server.
- **Status** saat ini: `running` (proses upstream aktif), `idle` (siap tapi tidak sedang memproses), `needs sign-in` (OAuth diperlukan), `error` (gagal start), atau `disabled`.
- **Jumlah tool aktif** di server ini.
- **Toggle enable** — menonaktifkan langsung menyembunyikan semua tool dari setiap agent.
- **Test** — menjalankan upstream dan mengembalikan jumlah tool yang ditemukan (atau pesan error).
- **Edit** / **Remove** — perbarui kredensial atau hapus server.
- **Connect** (server OAuth) — membuka flow sign-in provider. Muncul sebagai tombol saat status `needs sign-in`, atau sebagai link **reconnect** saat sudah terautentikasi tapi perlu sign-in ulang.

Klik kartu untuk membuka daftar tool. Setiap tool punya **toggle enable**, **toggle requires approval**, dan field **rate limit (panggilan / menit)** opsional. Tool yang namanya mengindikasikan operasi tulis (send, create, update, delete) ditandai badge **write** sebagai pengingat untuk memeriksa pengaturan aksesnya.

### Tab Add

Grid katalog menampilkan MCP server siap pakai:

- **Context7** — dokumentasi library terkini. Tidak perlu kredensial; install via `npx`.
- **GitHub** — issues, pull request, pencarian kode (server remote resmi). Membutuhkan Personal Access Token.
- **Notion** — cari, baca, dan perbarui halaman (server remote resmi). Menggunakan OAuth: setelah install, klik **connect** di kartu untuk sign in.
- **Linear** — issues, proyek, komentar (server remote resmi). Menggunakan OAuth: setelah install, klik **connect** di kartu untuk sign in.

Preset **Playground** ditandai chip `playground` — tidak perlu akun atau API key, cocok untuk mencoba gateway:

- **Everything** (test server) — server test MCP resmi: echo, penjumlahan, sample gambar, dan panggilan panjang. Install via `npx`.
- **Memory** — knowledge graph kecil yang bisa ditulis dan dicari agent. Data disimpan di server Stoa dan **dibagikan ke semua agent yang punya akses**. Install via `npx`.
- **Sequential Thinking** — tool berpikir bertahap yang memungkinkan agent merevisi dan mencabang penalarannya. Install via `npx`.
- **DeepWiki** — ajukan pertanyaan tentang repositori GitHub publik (server remote, tidak perlu `npx`).

Server katalog lainnya:

- **Brave Search** — pencarian web, berita, gambar, dan lokal (server resmi Brave). Membutuhkan `BRAVE_API_KEY` dari [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com) (paket gratis sudah cukup untuk mencoba).
- **Sentry** — issues, events, releases, dan proyek (server resmi). Membutuhkan personal auth token dari Sentry → Settings → Personal Tokens (`org:read`, `project:read`, `event:read`; tambah `event:write` kalau ingin agent bisa update issues). Install via `npx`.
- **Cloudflare** — DNS, Workers, R2, zone, dan lainnya untuk akun Cloudflare-mu (server remote resmi). Pakai OAuth: klik **connect** setelah install.
- **Supabase** — proyek, database (SQL), edge function, dan log untuk organisasi Supabase (server remote resmi, beta). Pakai OAuth: klik **connect** setelah install.
- **Todoist** — task, proyek, seksi, dan komentar di Todoist (server remote resmi oleh Doist). Pakai OAuth: klik **connect** setelah install.

Preset **browser automation** menjalankan browser sungguhan di server Stoa — `localhost` di tool-tool tersebut artinya mesin Stoa, bukan mesin agent. Tidak perlu akun untuk keduanya:

- **Chrome DevTools** — mengendalikan Chrome headless: buka halaman, klik, ketik, baca console dan network, rekam trace (server resmi Google). Tool `upload_file` **requires approval** secara default (mengirim file dari server Stoa ke browser).
- **Playwright** — browser automation via accessibility snapshot: navigasi, klik, isi form, screenshot (server resmi Microsoft). `browser_file_upload` **requires approval** secara default; `browser_run_code_unsafe` (eksekusi JS sembarang) **dinonaktifkan** secara default.

Preset **akses file**:

- **Filesystem** — baca, cari, dan edit file di folder yang kamu pilih di server Stoa (server MCP resmi). Agent di mesin lain juga bisa mengakses folder ini lewat gateway. Field wajib: **Allowed folders** — satu atau lebih path absolut di server Stoa, dipisahkan koma. Root (`/`) dan path yang overlap folder instalasi Stoa ditolak. Tool tulis (`write_file`, `edit_file`, `create_directory`, `move_file`) **requires approval** secara default.

Klik **Custom** untuk menambah server sendiri:

- **stdio** — command yang berjalan sebagai subprocess di server Stoa. *Peringatan: command ini berjalan di server tanpa shell, hanya dengan `PATH`, `HOME`, dan variabel yang kamu tambahkan. Hanya tambahkan command yang kamu percaya.* Binary yang diizinkan: `npx`, `uvx`, `node`, `docker`, atau path absolut.
- **HTTP** — MCP server remote yang bisa diakses via URL. Pilih **header token** (tambah header `Authorization` statis) atau **OAuth sign-in** (connect setelah install).

Setelah install, klik **connect** di kartu server OAuth mana pun untuk menyelesaikan sign-in. Kredensial disimpan terenkripsi di server dan tidak pernah ditampilkan lagi setelah disimpan — API tidak pernah mengembalikan nilainya.

### Tab Access

Matrix akses mengontrol agent dan sub-agent mana yang bisa menggunakan setiap MCP server.

- **Baris** — semua agent dan sub-agent (sub-agent menjorok di bawah parent-nya).
- **Kolom** — setiap MCP server yang terinstall.
- **Sel** — klik untuk mengubah: `✓ allow` → `✕ deny` → `inherit`.
  - **inherit** — mengikuti level berikutnya: sub-agent → agent induk → default server.
  - **deny selalu menang** — deny eksplisit di level mana pun memblokir akses, apapun pengaturan parent.

**Default server** (ditampilkan di header kolom) adalah `none` untuk setiap server baru. Toggle **allow all agents** di header kolom untuk mengubah default ke `all`.

### Tab Activity

Dua sub-tampilan:

- **Tool calls** — setiap panggilan yang dibuat agent melalui gateway: timestamp, agent/sub-agent, room/thread (klik untuk loncat), nama tool, status (`ok`, `error`, `timeout`, `denied`, `rate_limited`), dan durasi. Filter per MCP server atau agent. Berguna untuk debug "kenapa itu gagal?".
- **Approvals** — riwayat permintaan approval: siapa meminta apa, kapan, dan apakah disetujui, ditolak, atau kedaluwarsa.

Activity disimpan selama **30 hari** secara default (dapat dikonfigurasi via `MCP_CALLS_RETENTION_DAYS`).

### Approval Tool (Requires Approval)

Saat **requires approval** diaktifkan untuk sebuah tool, gateway menahan panggilan dan mengirim kartu **MCP approval** di room atau thread tempat agent berjalan. Kartu menampilkan agent, nama tool, dan preview argumen.

- Klik **approve** untuk mengizinkan panggilan dilanjutkan.
- Klik **deny** untuk menolaknya.
- Klik **always allow** untuk menyetujui panggilan ini sekaligus membebaskan agent atau sub-agent tersebut dari permintaan approval di masa mendatang untuk tool yang sama. Pengecualian berlaku persis: pengecualian untuk sub-agent tidak berlaku untuk parent agent-nya, begitu pula sebaliknya. Permintaan yang sedang pending dari agent atau sub-agent yang **persis sama** untuk tool yang sama ikut disetujui sekaligus — permintaan dari sub-agent lain atau dari parent tidak terpengaruh.
- Jika tidak ada keputusan dalam **5 menit** (default, dapat dikonfigurasi via `MCP_APPROVAL_TIMEOUT_MS`, maks 10 menit), panggilan otomatis ditolak dan agent menerima error.

Satu agent bisa punya maksimal 20 permintaan approval yang pending sekaligus. Kartu approval tidak dobel — permintaan pending yang sama muncul paling banyak sekali di room feed dan sekali di thread.

**Mengelola pengecualian:** Di halaman MCP, buka tab **Installed** dan klik tombol **tools** di kartu server untuk membuka daftar tool-nya. Agent yang dikecualikan tercantum di bawah **always allowed for** di bawah baris tool. Klik **×** di samping nama lalu konfirmasi untuk mencabut — setelah itu agent akan ditanya lagi. Jika switch di kolom **Approval** untuk tool tersebut dimatikan, daftar ditampilkan redup (tidak aktif). Pengecualian dihapus otomatis saat agent atau sub-agent dihapus. Panggilan yang lolos lewat pengecualian tetap tercatat di activity log.

### Label Tool di Chat

Saat agent sedang berjalan, setiap panggilan tool MCP ditampilkan sebagai blok tool di chat. Blok ini menampilkan **nama tool** diikuti label kecil miring **"via \<nama server\> (Stoa)"** — misalnya `resolve-library-id via Context7 (Stoa)`. Hover untuk melihat nama internal lengkap sebagai tooltip. Langkah tool disimpan bersama pesan (maksimal 50 langkah per pesan, nama tool + ringkasan satu baris) sehingga process trail — termasuk label MCP — **tetap ada setelah halaman di-reload**.

### Kapan Agent Menerima Perubahan

Saat kamu menambah, menghapus, atau mengonfigurasi ulang MCP server, gateway memberi tahu sesi yang aktif:

- **Claude Code** — gateway mengirim notifikasi `tools/list_changed` ke sesi agent yang terbuka. Claude Code memperbarui daftar tool-nya **langsung, di tengah sesi** — tidak perlu restart sesi. Jika sesi di-restart karena alasan lain (pergantian model, perubahan env, perubahan system prompt), daftar terbaru sudah tersedia dari awal.
- **Codex** — menjalankan proses baru per turn (setiap turn adalah koneksi MCP baru), jadi perubahan berlaku di **turn berikutnya** (pesan berikutnya).

### Kredensial dan Keamanan

- Kredensial (token, header) disimpan **terenkripsi** di server dan tidak pernah dikembalikan oleh endpoint API mana pun.
- Token sesi MCP yang diinjeksikan ke setiap agent terikat ke `(agent, room, thread, sub-agent)` dan hanya ada di environment agent — tidak pernah di argumen command-line (tidak terlihat di `ps`).
- Token otomatis dicabut saat agent, sub-agent, atau room-nya dihapus.
- Proses upstream stdio dijalankan dengan environment terisolasi (hanya `PATH`, `HOME`, dan variabel yang kamu tambahkan secara eksplisit) — environment variabel server sendiri tidak diteruskan.

### Tool Bawaan Stoa

Selain server MCP yang kamu pasang, server `stoa` bawaan Stoa menyediakan **24 tool bawaan** yang memberi agent akses langsung ke fitur Stoa — tanpa curl, tanpa secret. Identitas, room, dan thread diambil otomatis dari token sesi.

Tool dikelompokkan berdasarkan fungsi:

- **Pesan** — `stoa__message_send`, `stoa__messages_read`, `stoa__threads_list`, `stoa__thread_read`
- **Memory** — `stoa__room_memory_get/set`, `stoa__agent_memory_get/set`, `stoa__sub_agent_memory_get/set`
- **System prompt** — `stoa__room_system_prompt_get/set`, `stoa__agent_system_prompt_get/set`
- **Sub-agent** — `stoa__sub_agent_list/create/update/delete/trigger`
- **Automation** — `stoa__automation_list/create/update/delete`, `stoa__connection_list`

Validasi, budget, dan scope berlaku sama seperti REST API. Perubahan konfigurasi (system prompt, CRUD sub-agent, perubahan automation) memunculkan notice permanen di room — `· config` atau `· automation` — sama dengan endpoint REST.

Dalam **sesi sub-agent**, hanya tool pesan, baca, dan memory sub-agent sendiri yang tersedia. Tool yang mengubah konfigurasi disembunyikan dan ditolak. Server `stoa` bawaan tidak perlu grant di halaman MCP — panggilannya muncul di log aktivitas dengan nama `stoa`. Upload file tetap melalui REST (`POST /api/upload/raw`) atau marker `[send:]`.

Lihat `stoa-api.md` → **Tool MCP Stoa Bawaan** untuk daftar argumen lengkap.

---

## Pengaturan

Stoa menggunakan **sidebar navigasi vertikal** di sisi paling kiri app. Sidebar hanya menampilkan ikon (lebar 44 px) dan melebar ke 200 px saat di-hover, memperlihatkan label teks. Klik ikon mana saja untuk berpindah seksi. Di mobile (layar sempit) sidebar disembunyikan — gunakan navigasi dalam app.

Item navigasi, dari atas ke bawah: **Inbox** (daftar room), lalu separator, diikuti seksi pengaturan: **AI Agent**, **Server**, **General**, **Themes**, **Docs**, **Platforms**, **Automation**, **Skills**, **MCP**, **Usage**, **Doctor**.

### AI Agent

Layout dua panel untuk mengelola semua AI agent. Sidebar kiri menampilkan daftar agent yang bisa dicari, dikelompokkan berdasarkan status online/offline, dengan tombol **+ new agent** di atas. Klik agent mana saja untuk melihat panel detailnya di sisi kanan.

Panel detail mencakup:

- **Header** — avatar agent (klik untuk mengubah), nama (klik untuk mengedit inline), status online/offline, dan tombol aksi (rescan, force update, remove)
- **Kartu Agent** — tipe backend, pemilih bahasa, field nama, pemilih platform, pemilih harness, dan perintah install untuk reinstall
- **System Prompt** — system prompt per-agent yang diterapkan di setiap room tempat agent berpartisipasi; sub-agent memiliki system prompt sendiri dan tidak mewarisi ini
- **Kartu Sub-agents** — semua sub-agent yang didefinisikan untuk agent ini, dengan kontrol add/edit/delete/toggle
- **Kartu Workdirs** — daftar read-only working directory yang terdaftar untuk agent ini

### Server

- **Public URL** — URL yang digunakan agent dan perangkat lain untuk menjangkau server (penting untuk setup Tailscale/remote)
- **Port** — ubah port server (perlu restart; lihat [panduan ganti port](doc-port))
- **Max AI Turns** — maksimum respons agent per pesan manusia (mencegah loop tak terbatas)
- **Concurrent Sessions** — berapa thread yang bisa dijalankan agent secara bersamaan (default: 1; rekomendasi: 3). Paralel *antar* thread; selalu serial *dalam* satu thread. Langsung diterapkan, tanpa restart. **Risiko:** dengan nilai di atas 1, thread yang berbagi workdir yang sama bisa mengedit file atau menjalankan git bersamaan — tidak ada kunci yang mencegah ini. Biarkan di 1 untuk room yang agentnya mengedit kode bersama, atau berikan workdir terpisah untuk setiap thread.
- **Session Idle TTL** — menit sebelum sesi AI yang idle otomatis ditutup untuk menghemat memori (default 5 menit)
- **Cleanup Hour** — kapan pembersihan upload harian berjalan (format 24 jam)
- **Max File Age** — berapa lama file upload disimpan sebelum dibersihkan (jam)

**Restart Server** — tab Server juga menampilkan kartu restart. Kartu ini menunjukkan process manager yang menjalankan Stoa (misalnya `running via launchd`) dan tombol **restart server**. Tombol aktif jika Stoa dikelola oleh launchd, PM2, systemd, atau supervisord — process manager akan otomatis menghidupkan ulang proses setelah exit. Untuk Docker atau environment yang tidak dikenali, tombol dinonaktifkan (restart container atau proses dari luar). Klik **restart server** → konfirmasi dialog → server memberi tahu semua agent dan browser yang terhubung, lalu exit. Browser terhubung kembali otomatis dalam ~2–3 detik dan menampilkan "Server restarted" sebentar setelah koneksi pulih.

**Memperbarui Stoa** — tab Server juga menampilkan kartu **Update** yang menunjukkan versi yang sedang berjalan dan versi terbaru yang tersedia di branch default. Stoa mengecek otomatis sekali sehari; kartu menampilkan waktu pengecekan terakhir. Badge kecil muncul di ikon nav Server kalau ada versi baru.

- **check now** — paksa fetch langsung dari remote.
- **Update** — buka dialog yang menampilkan daftar commit baru, lalu mulai update. Progres ditampilkan per langkah: fetch → apply commits → install dependencies → test boot → restart. Langkah "install dependencies" dilewati kalau `package-lock.json` tidak berubah; tampil sebagai "skipped" di daftar progres. Setelah server restart, semua agent yang terhubung auto-update dalam ~2 menit.

**Pengaman:**
- Sebelum server live disentuh, versi baru di-boot terhadap salinan database. Kalau tes ini gagal, perubahan di-rollback dan server live tetap berjalan tanpa restart.
- Kalau server gagal start 3 kali setelah update diterapkan (2 kali di bawah supervisord, supaya versi lama masih kebagian jatah start sebelum supervisord menyerah di batas default `startretries`), Stoa otomatis rollback ke versi sebelumnya dan menampilkan peringatan setelah kamu reconnect.
- Kalau ada agent yang sedang menjalankan run aktif, dialog konfirmasi muncul sebelum update dipaksa.

**Update dinonaktifkan (dengan alasan yang ditampilkan) kalau:**
- Instalasi bukan git checkout — update manual.
- Berjalan di Docker — pull image baru.
- Tidak ada process manager yang didukung (launchd, pm2, systemd, atau supervisord) yang menjadi parent langsung dari proses server — server yang dijalankan manual (`nohup`, `&`) atau yang mewarisi environment variabel manager tanpa benar-benar dijalankan olehnya dianggap tidak dikelola.
- Checkout berada di branch yang bukan default.
- File tracked memiliki perubahan yang belum di-commit (file untracked tidak memblokir).
- Ada commit lokal yang tidak ada di origin (diverged).
- Update sudah berjalan atau masih menyelesaikan boot check.

Process manager harus menyalakan ulang server setelah exit dengan kode non-zero (Stoa keluar dengan kode 75 saat restart terencana): launchd `KeepAlive: true`; pm2 default (`autorestart: true`); systemd `Restart=always` atau `Restart=on-failure`; supervisord `autorestart=true` atau `unexpected` (default), dengan `startretries ≥ 3` (default).

Sebelumnya, update mengharuskan menjalankan `git pull` secara manual dan merestart process manager.

**Update manual:** jalankan `git pull`, lalu `npm ci` (bukan `npm install` — itu akan menulis ulang `package-lock.json` dan membuat checkout kotor), lalu restart server via process manager. Agent yang terhubung akan auto-update dalam 2 menit.

Migrasi database berjalan otomatis saat server start. Jangan jalankan migrasi secara manual: sebuah migrasi bisa me-rename atau menghapus tabel di bawah server yang masih menjalankan kode lama, sehingga muncul error `no such table` sampai server di-restart.

Untuk verifikasi server setelah update, `GET /api/health` (tanpa login) mengembalikan `200` dengan `{"ok":true,"db":"ok","migrations":{"pending":0,"failed":0}}`, atau `503` jika database tidak terbaca, ada migrasi yang gagal, atau ada migrasi baru yang belum jalan karena server belum di-restart setelah `git pull`. Detail ada di log server (baris `[migration]`).

Jika server exit saat startup dengan `[db] better-sqlite3 cannot load in this Node.js`, modul native ter-build untuk versi Node yang berbeda. Jalankan `npm rebuild better-sqlite3` dengan binary Node yang sama yang digunakan process manager, lalu restart.

### Platforms

Konfigurasi provider model AI eksternal di luar model Claude bawaan. Klik **+ add platform** untuk mendaftarkan provider baru:

- **Type** — **Ollama Cloud** (proxy bawaan, tidak perlu URL) atau **Custom Platform** (API OpenAI-compatible apa pun)
- **Name** — label untuk platform (misal "My OpenRouter")
- **Base URL** — wajib untuk Custom Platform (misal `https://openrouter.ai/api/v1`)
- **API Key** — API key untuk provider tersebut

Untuk platform baru, klik **add & discover** untuk menyimpan dan mendeteksi model sekaligus. Untuk platform yang sudah ada, klik **discover models** untuk deteksi ulang. Discovery mendeteksi kapabilitas per model — vision (👁) dan tool-calling (⚙). Model tanpa tool-calling tetap ditampilkan dan bisa digunakan, namun berjalan dalam mode teks saja.

**Mengaktifkan dan menonaktifkan model**: Setelah discovery, muncul checklist semua model yang ditemukan. Centang hanya model yang ingin tampil di selector room, lalu klik **update** untuk menyimpan. Gunakan **select all / deselect all** untuk toggle cepat. Pilihan disimpan permanen dan diperbarui otomatis saat Anda re-discover.

API key disimpan di server dan dikembalikan ke browser hanya di form edit Settings (single-user app — hanya Anda yang punya akses).

**Provider yang didukung** — endpoint API apapun yang kompatibel dengan OpenAI bisa digunakan:
- **Ollama Cloud** — pilih tipe "Ollama Cloud" (proxy bawaan dengan rotasi key, 40+ model hingga 480B)
- **Local Ollama** — `http://localhost:11434/v1` (gratis, privat, bisa offline — lihat [panduan Ollama](doc-ollama))
- **OpenRouter** — `https://openrouter.ai/api/v1`
- **Together AI** — `https://api.together.xyz/v1`
- **Groq** — `https://api.groq.com/openai/v1`

### Model Claude Kustom

Jika Anthropic merilis model yang belum ada di daftar bawaan, tambahkan tanpa perlu update server. Gulir ke kartu **claude models** di **Settings > Platforms**.

Jika ada agent dengan binary Claude CLI yang online, kartu menampilkan strip **Detected from Claude CLI v*X*** berisi chip yang bisa diklik untuk ID model yang lebih baru dari entri terdaftar terbaru di setiap family. Mengklik chip mengisi otomatis kolom ID model dan label (label dibuat otomatis, misalnya _Haiku 5.5_, bisa diedit); klik **add model** untuk menyimpan — tidak ada simpan otomatis. ID model lama tetap bisa diketik manual. Jika belum ada agent yang melaporkan CLI, strip menampilkan pesan untuk menghubungkan agent.

- **Tambah** — masukkan ID model (misalnya `claude-haiku-5-5`) dan label tampilan opsional (maks 40 karakter), lalu klik **add model**. Model langsung muncul di dropdown model room, ditandai **custom**.
- **Hapus** — klik × pada baris model kustom. Room yang sudah menggunakan model tersebut mempertahankan pengaturannya; hanya pemilihan baru yang terpengaruh.

Format ID model: harus diawali `claude-`, diikuti huruf kecil, angka, titik, atau tanda hubung (regex: `^claude-[a-z0-9][a-z0-9.-]{1,62}$`). ID duplikat atau format salah ditolak langsung. Maksimum 20 entri kustom.

### Automation

Kelola koneksi Slack, WhatsApp, dan Email serta aturan automation. Lihat bagian [Automation](#automation) di atas.

### Docs

Jelajahi dokumentasi proyek dengan dukungan multi-bahasa. File dokumentasi dari direktori `docs/` ditampilkan sebagai markdown terformat.

### General

- **Profil** — nama tampilan dan avatar Anda (identitas Anda di room). Upload atau hapus foto profil, dan ubah nama tampilan
- **Messages** — kontrol kenyamanan baca: atur ukuran teks (Tiny / Small / Compact / Default), jarak baris (Tight / Normal / Relaxed), dan lebar bubble (Narrow / Standard / Wide). Perubahan langsung berlaku di semua room dengan preview langsung
- **Account** — ubah email dan password
- **Notifications** — aktifkan/nonaktifkan push notification browser
- **Display defaults** — default global untuk tampilan progres agent: visibilitas tool steps, verbositas live status, dan perilaku cleanup. Room individual bisa mengoverride ini
- **Session** — logout dari Stoa

### Usage

Tab **Usage** adalah dashboard analitik personal untuk konsumsi token AI kamu. Semua data dikelompokkan berdasarkan hari kalender lokal — timezone browser kamu dikirim setiap kali tab dibuka, jadi batas hari, peak hour, dan streak selaras dengan tengah malam lokal kamu, bukan UTC.

Dua kontrol segmen ada di bagian atas:

- **View** — beralih antara **Summary** dan **Model**
- **Period** — **All**, **30d**, atau **7d** — memfilter semua statistik di bawahnya ke rentang tersebut

**Tampilan Summary** menampilkan grid kartu statistik: rata-rata token per pesan, total pesan, total token (input + output + cache read + cache creation), hari aktif, streak saat ini dan terpanjang (hari aktif berturut-turut, yang saat ini dihitung mundur dari hari ini), peak hour (dalam timezone lokal kamu), token input/output, cache hits, estimasi total biaya dalam USD, dan model paling sering kamu pakai.

Di bawah kartu, ada **heatmap aktivitas** yang mencakup 26 minggu terakhir. Tiap sel adalah satu hari; sel lebih gelap berarti lebih banyak token. Arahkan kursor ke sel untuk melihat tanggal dan jumlah token persisnya. Layout-nya fluid — mengecil menyesuaikan layar mobile, bukan scroll ke samping.

**Tampilan Model** memecah penggunaan per model:

- **Bar chart bertumpuk** menampilkan volume token harian, tiap model warna berbeda
- **Daftar model** di bawahnya menampilkan setiap model dengan total token input/output dan persentase porsinya

Semua angka bersifat read-only dan diperbarui setiap kali kamu membuka ulang tab atau mengubah period.

### Doctor

Tab **Doctor** menampilkan informasi kesehatan instance Stoa kamu: integritas database, ukuran file DB, dan status semua agent.

**Diagnostik antrean agent** — `GET /api/health/db` menyertakan array `agent_queues` dengan status antrean setiap agent yang online: apakah agent melaporkan status antrean (`reported: true` berarti client v0.4.392+), jumlah run aktif, kedalaman antrean, dan rincian per room. `reported: false` berarti client lama yang tidak mengirim event antrean — hitungannya `null`.

**Timing run** — setiap pesan menyertakan timing yang dibuat server di `result_meta.timing` (hanya untuk agent dengan client v0.4.392+):

| Field | Keterangan |
|-------|------------|
| `queue_wait_ms` | Waktu run menunggu di antrean agent |
| `first_token_ms` | Waktu dari run dimulai hingga token pertama (dihilangkan jika tidak ada streaming) |
| `run_ms` | Durasi run total |
| `queue_depth` | Run dari agent yang sama di depan run ini saat tiba (0 = langsung mulai) |
| `parallel` | Run aktif di agent saat run ini dimulai, termasuk dirinya sendiri |

---

## Tema

Buka **Settings > Themes** (nav kiri, di bawah General) untuk memilih tema tampilan. Tema dikelompokkan dalam dua grup:

- **Terang** — Warm Paper (default), Hoth, Mood Indigo, Banana, Sweet Treat
- **Gelap** — Dark, Aubergine, Ochin, Haberdashery, Choco Mint, Nocturne

![Pemilih tema menampilkan semua opsi tema terang dan gelap](screenshots/themes.png)

Klik kartu untuk langsung menerapkannya — centang menandai tema aktif. Kartu bisa diakses lewat keyboard. Pilihan disimpan di browser.

**Migrasi:** Jika sebelumnya menggunakan pengaturan terang, Warm Paper diterapkan otomatis. Pengaturan gelap tetap Dark. Jika belum ada pengaturan tersimpan, Stoa mengikuti preferensi gelap/terang perangkat.

Di mobile, warna status bar menyesuaikan tema aktif.

---

## Dukungan Mobile

Stoa sepenuhnya responsif dan berfungsi di browser mobile. Bisa juga diinstal sebagai **Progressive Web App (PWA)** — gunakan opsi "Add to Home Screen" di browser untuk pengalaman seperti aplikasi native.

Untuk akses mobile dari perangkat lain, siapkan **Tailscale** — lihat [panduan Tailscale](doc-tailscale) untuk instruksi langkah demi langkah.

---

## Deploy Publik

Stoa bisa diakses dari luar mesin lokal Anda dalam tiga konfigurasi:

### (A) Tailscale saja
Akses Stoa dari perangkat mana pun di jaringan Tailscale menggunakan IP Tailscale mesin. Tidak perlu konfigurasi tambahan. Atur **Public URL** di **Settings > Server** ke `http://<tailscale-ip>:<port>` agar agent dan perintah install menggunakan alamat yang benar.

### (B) Cloudflare Tunnel (di mesin yang sama)
Jalankan `cloudflared tunnel` di mesin yang sama dengan Stoa untuk mengeksposnya di domain publik tanpa membuka port firewall. Secara default, cloudflared terhubung dari `localhost` yang sudah dipercaya. Atur **Public URL** ke URL tunnel Anda (mis. `https://stoa.example.com`). Tambahkan aturan cache Cloudflare untuk melewati cache pada path berikut:
- Bypass cache untuk: `/uploads/*` dan `/connector-media/*`

> **Cloudflare Access + agent:** Set `STOA_CF_ACCESS_CLIENT_ID` dan `STOA_CF_ACCESS_CLIENT_SECRET` di environment agent untuk mengirim service token Cloudflare Access. Token hanya dikirim ke origin Stoa — tidak ke provider model atau host lain. Sesi child (Claude Code, Codex) menerima URL proxy loopback agar bisa mencapai Stoa lewat Access tanpa token masuk ke prompt mereka. Tanpa variabel ini, perilaku tidak berubah. **Rekomendasi:** gunakan Tailscale untuk agent; pakai CF Access token hanya kalau Tailscale tidak tersedia.

### (C) VPS + reverse proxy + domain
Jalankan Stoa di balik nginx, Caddy, atau reverse proxy lain di VPS dengan domain publik dan TLS.

**Environment variable:**

| Variabel | Keterangan |
|----------|------------|
| `STOA_TRUSTED_PROXIES` | IP/CIDR proxy yang dipercaya, dipisahkan koma. Default: `127.0.0.1/32,::1/128` (localhost). Set ke `none` untuk tidak mempercayai proxy apa pun. |
| `STOA_ALLOWED_ORIGINS` | Origin yang diizinkan (mis. `https://stoa.example.com`). Diperlukan jika proxy mengubah header `Host` tanpa meneruskan `X-Forwarded-Host`. |

**Cara kerja trust:** IP client dan status HTTPS dibaca dari header proxy (`CF-Connecting-IP`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) hanya jika request berasal dari proxy yang dipercaya. Reverse proxy Anda **wajib** menetapkan header-header ini dan tidak meneruskan header dari client yang tidak dipercaya.

**Konfigurasi header — penting jika tidak di belakang Cloudflare:** Stoa membaca IP client dengan urutan: `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For`. Jika proxy Anda **bukan** Cloudflare (mis. nginx atau Caddy langsung di VPS), proxy **wajib** menghapus `CF-Connecting-IP` yang dikirim client — jika tidak, penyerang bisa memalsukan header ini untuk mengakali limit login per IP. Limit per email dan device cookie tetap berlaku.

**nginx:**
```nginx
proxy_set_header CF-Connecting-IP "";
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

**Caddy:**
```caddy
header_up -CF-Connecting-IP
header_up X-Real-IP {remote_host}
```

> **Cloudflare di depan nginx:** Jika Cloudflare berada di depan nginx Anda, jangan hapus `CF-Connecting-IP`. Sebagai gantinya, batasi akses ke origin server hanya untuk [IP range Cloudflare](https://www.cloudflare.com/ips/) saja.

**HTTPS:** Wajib untuk deploy publik. Saat HTTPS terdeteksi, cookie sesi disetel dengan `Secure` dan HSTS dikirim otomatis.

**public_url:** Atur di **Settings > Server** ke URL publik (mis. `https://stoa.example.com`). Digunakan di perintah install agent dan link internal.

**Proteksi CSRF:** Request write yang terautentikasi via cookie sesi diperiksa header `Origin`-nya. Jika origin tidak cocok dengan `Host`, `public_url`, atau `STOA_ALLOWED_ORIGINS`, server membalas `403 origin_not_allowed`. Client non-browser (agent, tool API) yang tidak mengirim `Origin` tidak terpengaruh.

### Izin agent

Agent secret (`x-agent-id` / `x-agent-secret`) dibatasi ke allowlist route yang dibutuhkan untuk operasi agent yang sah. Request di luar daftar ini ditolak dengan `403 {"error":"agent_scope_denied"}` dan dicatat sebagai `[agent-scope] denied actor=<id> METHOD /path`.

| Route | Syarat akses |
|-------|-------------|
| `POST /api/rooms/:id/message` | Peserta room |
| `POST /api/rooms/:id/email-reply` | Peserta room |
| `GET/PUT /api/rooms/:id/memory` | Peserta room |
| `GET/PUT /api/rooms/:id/system-prompt` | Peserta room |
| `POST /api/rooms/:id/sub-agent-trigger` | Peserta room |
| `GET /api/rooms/:id/messages` | Peserta room |
| `GET /api/rooms/:id/threads[/:id]` | Peserta room |
| `POST /api/upload/raw` | Agent valid mana pun |
| `GET /uploads/*, /connector-media/*` | Agent valid mana pun |
| `GET /api/docs/stoa-api*.md` | Agent valid mana pun |
| `GET/PUT /api/actors/:id/memory[/MEMORY.md\|USER.md]` | Actor sendiri |
| `GET/PUT /api/actors/:id/system-prompt` | Actor sendiri |
| `GET/PUT /api/sub-agents/:id/memory` | Sub-agent milik sendiri |
| `GET /api/automations/connections/:id/messages` | Room automation terhubung |
| `GET /api/automations` | Agent valid mana pun (server filter ke room sendiri) |
| `POST /api/automations` | Agent valid mana pun (`target_room_id` harus room sendiri) |
| `PATCH /api/automations/:id` | Automation milik sendiri (`target_room_id` harus tetap room sendiri) |
| `DELETE /api/automations/:id` | Automation milik sendiri |
| `GET /api/automations/connections` | Agent valid mana pun (hanya `id`, `name`, `provider`, `status` — tanpa credential) |
| `GET /api/skills` | Agent valid mana pun (hanya skill yang aktif — nama, deskripsi, hint, versi, jumlah file) |
| `GET /api/skills/:name/manifest` | Agent valid mana pun |
| `GET /api/skill-blobs/:sha256` | Agent valid mana pun (sha yang direferensikan revisi aktif skill yang aktif saja) |
| `POST /api/skills/import` | Agent valid mana pun (ownership = agent pemanggil) |

Setiap kali agent membuat, mengubah, atau menghapus automation, server memposting system notice permanen di target room (contoh: *"Ara membuat automation 'X' (trigger: slack message) · automation"*), sehingga pemilik workspace bisa memantau dan mencabut akses jika diperlukan.

Sesi browser (cookie sesi) tetap punya akses penuh. Untuk menonaktifkan pembatasan, set `STOA_AGENT_SCOPE=off` di server — warning dicatat saat startup.

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
                                                  (+ external platforms
                                                   via env vars)
```

- **server.js** — server HTTP + WebSocket, mengatur room, pesan, dan orkestrasi agent
- **public/** — frontend (tidak perlu build step)
- **stoa.js** — klien agent yang berjalan di setiap mesin agent
- **claude-session.js** — mengatur subprocess Claude Code CLI
- **codex-session.js** — mengatur subprocess Codex CLI; didistribusikan via auto-update Stoa (diunduh saat server diperbarui, bukan saat harness diganti)
- **SQLite** — semua data disimpan lokal di `stoa.db` (mode WAL untuk performa)

Semua model AI dirutekan melalui **Claude Code CLI**. Untuk platform eksternal kustom (OpenRouter, Together AI, dll.), server meneruskan environment variable khusus platform (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) ke proses CLI. Untuk **Ollama Cloud**, request dirutekan melalui proxy bawaan Stoa (`/v1/messages`) dengan rotasi API key di sisi server — agent terhubung ke Stoa, bukan langsung ke ollama.com.

**Konteks room di prompt**: Setiap kali agent dipicu, server menginjeksikan `Room ID: <id>` ke system prompt agent. Artinya agent selalu tahu room mana yang sedang ia operasikan — memungkinkan pemanggilan `sendProactiveMessage(roomId, ...)` atau operasi lain yang bergantung pada room ID tanpa perlu meneruskan ID secara eksplisit.

---

## Tips

- **Banyak agent, satu room**: Masukkan agent yang saling melengkapi di room yang sama — misal coder dan reviewer — dan biarkan mereka berkolaborasi via @mention
- **Room khusus**: Buat room terpisah untuk topik atau proyek yang berbeda. Setiap room memiliki riwayat percakapan sendiri
- **Working directory**: Tetapkan workdir berbeda ke room berbeda sehingga agent yang sama bisa bekerja di beberapa proyek
- **Berbagi file**: Drag and drop file langsung ke chat — agent bisa langsung membacanya
- **Cari dulu**: Sebelum bertanya ke agent, gunakan pencarian untuk memeriksa apakah topik tersebut sudah pernah didiskusikan di room lain
