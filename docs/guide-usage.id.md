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
- Memilih **working directory** — wajib; menentukan konteks proyek dan skill yang tersedia di room ini

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

**Error atau limit agent** — ketika agent utama (bukan sub-agent) di dalam thread mengalami error, timeout, disconnect, restart server, atau mencapai rate / usage limit, pesan error-nya juga ditampilkan di room feed dengan badge **error** atau **limit**. Maksimal satu broadcast per thread setiap 10 menit untuk menghindari flood di feed. Error dari sub-agent tidak di-broadcast.

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

Pesan yang belum dikirim otomatis disimpan per room. Saat berpindah room dan kembali, draf Anda tetap tersimpan. Room dengan draf yang belum dikirim menampilkan indikator **draft** oranye di sidebar.

### Jejak Proses

Saat AI agent sedang bekerja, Anda bisa melihat tool call-nya (Read, Edit, Bash, dll.) ditampilkan secara real-time di bawah bubble pesan. Ini memberi visibilitas apa yang sedang dikerjakan agent sebelum respons final selesai.

### Toggle Enter to Send

Composer memiliki toggle **Enter to send**. Saat aktif (default di desktop), menekan Enter langsung mengirim pesan. Saat nonaktif (default di mobile), Enter menyisipkan baris baru — berguna untuk menyusun pesan multi-baris tanpa terkirim secara tidak sengaja. Preferensi Anda disimpan di browser.

### Menghentikan Respons

Saat AI agent sedang streaming respons, tombol **Stop** muncul. Klik untuk membatalkan generasi. Pesan akan menampilkan konten yang sudah di-stream sampai saat itu.

### Badge Posisi Antrean

Saat pesan sedang menunggu giliran di antrean agent — karena agent sedang memproses thread lain — badge **antre di posisi N** muncul menggantikan indikator streaming, baik di feed room maupun di panel thread. Angka menunjukkan posisi run dalam antrean (berbasis 1). Badge hilang otomatis saat run dimulai, selesai, atau dibatalkan.

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


- **Label** (wajib) — nama singkat seperti `probe` atau `researcher`. Muncul di chat sebagai `Ara (probe)` sehingga kamu selalu tahu sub-agent mana yang menghasilkan sebuah pesan.
- **Role** (opsional) — jabatan singkat sub-agent (mis. "Tech Lead"), maksimal 40 karakter, satu baris. Sub-agent lama belum punya role sampai kamu mengisinya. Tampil kecil di bawah nama sub-agent di setiap pesannya di chat (feed, thread, dan saat mengetik), di daftar sub-agent di Settings, dan di popover sub-agent di header room sebagai `role · parent`. Mengganti role langsung berlaku termasuk untuk pesan lama. Dipakai juga di prompt: daftar delegasi agent utama menampilkan `@label (tier, role) — deskripsi`, dan sub-agent sendiri menerima `Your role: <role>`.
- **Description** (opsional) — teks singkat (maksimal 500 karakter) yang menjelaskan tujuan sub-agent. Sub-agent lama belum punya deskripsi sampai kamu mengisinya. Tampil satu baris di bawah label di daftar sub-agent (**Settings > AI Agent**) dan di popover **"Sub-agent milik <Agent>"** di header room; teks panjang dipotong dan teks lengkapnya muncul saat hover. Dipakai juga di prompt: daftar delegasi agent utama menampilkan `@label (tier, role) — deskripsi` (role dihilangkan jika tidak diisi) sehingga bisa memilih sub-agent yang tepat, dan sub-agent sendiri menerima deskripsi sebagai tujuannya ("Your Purpose").
- **Tier** — `quick`, `standard`, atau `deep`. Tier memilih **rantai fallback model** mana yang dipakai sub-agent (lihat [Tier Model dan Fallback](#tier-model-dan-fallback) di bawah). Secara default `quick` memakai model cepat, `standard` yang seimbang, dan `deep` yang paling mumpuni — masing-masing jatuh ke model yang lebih ringan jika model utama tidak tersedia.
- **Model override** (opsional) — kunci sub-agent ke satu model spesifik alih-alih memakai rantai tier-nya. Biarkan pada **use tier** untuk mengikuti routing tier. Model yang dikunci tidak punya fallback — ia dicoba sendirian. Dropdown mengambil daftar model dari server dan selalu sinkron dengan dropdown agent utama — model seperti Opus 5.5 muncul otomatis. Hanya model yang kompatibel dengan harness efektif sub-agent yang ditampilkan. Mengubah field **Harness** saat model tertentu sudah dipilih akan mereset pilihan ke **use tier** jika model itu tidak tersedia di harness baru. Server juga menolak model yang tidak cocok dengan harness efektif sub-agent saat disimpan.
- **Workdir** (opsional) — direktori kerja tempat sub-agent beroperasi.
- **System prompt** (opsional) — instruksi tambahan yang membentuk perilaku sub-agent.
- **Harness** (opsional) — `claude` atau `codex`. Biarkan pada **inherit from parent** (default) untuk memakai harness yang sama dengan agent induk.
- **Avatar** (opsional) — tiap sub-agent punya avatar sendiri: warna hex (`#RRGGBB`), simbol (1–4 karakter), atau gambar kustom (bisa diupload atau dihapus). Pesan sub-agent di feed dan panel thread ditampilkan dengan avatar sub-agent itu sendiri; jika tidak di-set, fallback ke avatar agent induk. Popup mention juga menampilkan avatar sub-agent sendiri (dengan badge parent kecil) dan role. Pesan yang sudah tampil di layar baru mencerminkan avatar baru setelah reload halaman.
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

Saat ada sub-agent berjalan, header room menampilkan pill **"N running"**. Klik untuk membuka popover yang mendaftar tiap run aktif beserta waktu berjalannya. Dari sana kamu bisa:

- **Stop** sebuah run — langsung menfinalisasi pesan sub-agent tersebut.
- **Pause spawns** — memblokir sub-agent baru untuk dimulai; run yang sudah berjalan tetap selesai normal. Pill **"spawns paused"** muncul di header selama dijeda. Matikan lagi untuk melanjutkan.

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

### Sub-Agent Terjadwal (Proactive Trigger)

Sub-agent persisten yang sudah di-link ke room bisa berjalan otomatis sesuai jadwal — tanpa @mention dan tanpa orchestrator. Ini berguna untuk pengecekan berkala (misalnya `probe` yang memeriksa penggunaan disk setiap 30 menit) atau laporan harian pada jam tetap.

Jadwal dikelola di **Room Settings > Scheduled Triggers**. Klik **+ add schedule** lalu pilih sub-agent yang sudah di-link, tipe jadwal (interval atau harian), cadence atau waktu, dan task. Setiap jadwal bisa di-toggle on/off, diedit, atau dihapus dari barisnya. Saat sebuah run terpicu, task yang dikonfigurasi dikirimkan langsung ke input sub-agent — tidak muncul sebagai pesan chat di room.

Jadwal punya salah satu dari dua bentuk:

- **Interval** — berjalan setiap N menit (minimum 5).
- **Harian** — berjalan sekali sehari pada jam dinding tetap (`HH:MM`) di timezone yang dipilih.

Setiap eksekusi terjadwal memakai jalur yang sama dengan trigger manual, jadi semua pengaman tetap berlaku: room tidak boleh diarsipkan atau sedang pause spawns, batas sub-agent konkuren tetap berlaku, dan mesin agent induk harus online. Jika sebuah run tidak bisa jalan karena kondisi **sementara** — mesin induk sedang offline sebentar, atau batas konkuren kebetulan penuh — run itu dicoba lagi tak lama kemudian, sampai batas jadwal berikutnya. Artinya jadwal **harian** tidak hilang seharian penuh hanya karena mesin kebetulan offline persis di menit itu; ia jalan begitu mesin kembali online, lalu lanjut ke waktu normalnya keesokan hari. Setelah downtime (misalnya restart), slot yang terlewat **tidak** ditembakkan sekaligus — tiap jadwal berjalan paling banyak sekali ke depan, bukan sekali untuk setiap slot yang terlewat. Sub-agent terjadwal tetap tidak bisa memunculkan sub-agent-nya sendiri.

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

**Mengecek ketersediaan harness:** Setelah menginstal atau login CLI tool di mesin agent, klik tombol **Check** di sebelah dropdown Harness (di panel detail agent atau accordion di **Settings > AI Agent**) untuk mendeteksi ulang tanpa restart agent. Tombol ini nonaktif saat agent offline, dan deteksi bisa memakan waktu hingga ~15 detik. Dropdown langsung diperbarui ketika hasil tiba — harness baru yang terdeteksi ditampilkan via toast. Rescan juga mengecek ulang harness bersama working directory dan skill.

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

### Status Online Agent

Titik hijau di samping nama agent di sidebar dan header room menunjukkan status online. Footer sidebar juga menampilkan status koneksi WebSocket Anda.

### Self-Healing Agent

Agent secara otomatis:
- **Reconnect** jika koneksi WebSocket terputus (exponential backoff)
- **Recovery** dari crash Claude CLI
- **Auto-update** saat file klien di server berubah (cek tiap 2 menit dan sekali saat startup sebelum online, restart via PM2). Selama ada tool call yang berjalan, **tidak ada watchdog** (idle setelah token pertama: 5 menit, idle sebelum token pertama: 10 menit, stale sweep, maupun restart update) yang akan memotong run sampai 30 menit tanpa progres. Tanpa tool call aktif, batas normal berlaku: watchdog idle 5 menit (10 menit sebelum token pertama), dan 3 menit untuk restart update.

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

- **Rescan** — scan ulang working directory, skill, dan ketersediaan harness agent
- **Force Update** — paksa agent mengecek update klien segera (normalnya cek tiap 2 menit)
- **Remove** — hapus registrasi agent (dengan konfirmasi)

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

## Panel Agents

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

## Pengaturan

Stoa menggunakan **sidebar navigasi vertikal** di sisi paling kiri app. Sidebar hanya menampilkan ikon (lebar 44 px) dan melebar ke 200 px saat di-hover, memperlihatkan label teks. Klik ikon mana saja untuk berpindah seksi. Di mobile (layar sempit) sidebar disembunyikan — gunakan navigasi dalam app.

Item navigasi, dari atas ke bawah: **Inbox** (daftar room), lalu separator, diikuti seksi pengaturan: **AI Agent**, **Server**, **General**, **Themes**, **Docs**, **Platforms**, **Automation**, **Usage**, **Doctor**.

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
