# Panduan Setup Ollama

Stoa mendukung **Ollama** sebagai penyedia model AI — baik layanan cloud yang dihosting maupun instalasi lokal di mesin kamu sendiri. Panduan ini menjelaskan kedua opsi tersebut beserta cara konfigurasinya.

---

## Apa itu Ollama?

[Ollama](https://ollama.com) adalah alat open-source untuk menjalankan large language model. Ollama menyediakan HTTP API yang kompatibel dengan OpenAI, sehingga Stoa bisa langsung berkomunikasi dengannya tanpa adapter khusus — cukup arahkan Stoa ke URL-nya dan langsung berfungsi.

Ollama memberi akses ke perpustakaan model open-source yang besar: Llama, Qwen, Mistral, Gemma, DeepSeek, dan banyak lagi. Beberapa model ini juga tersedia melalui layanan cloud Ollama yang dihosting.

---

## Ollama Cloud vs Ollama Lokal

| | Ollama Cloud | Ollama Lokal |
|---|---|---|
| **URL** | `https://ollama.com/v1` | `http://localhost:11434/v1` |
| **Perlu instalasi lokal** | Tidak | Ya |
| **Perlu internet** | Ya | Tidak (setelah unduh model) |
| **Biaya** | Tier gratis + berbayar | Gratis (listrik + hardware) |
| **Ukuran model** | Hingga 480B+ parameter | Dibatasi RAM/VRAM kamu |
| **Privasi** | Prompt dikirim ke server Ollama | Tetap di mesin kamu |
| **Kecepatan** | Tergantung beban server | Tergantung hardware kamu |
| **Terbaik untuk** | Model besar tanpa GPU lokal | Data sensitif, offline, tanpa biaya API |

### Kapan pakai Ollama Cloud

- Kamu ingin menjalankan model sangat besar (70B, 235B, 480B) tanpa punya GPU
- Kamu sedang bereksperimen dan tidak ingin mengelola infrastruktur lokal
- Kecepatan dari server mereka sudah cukup memadai

### Kapan pakai Ollama Lokal

- Prompt kamu mengandung kode sensitif, data pribadi, atau informasi rahasia
- Kamu ingin tanpa biaya API sama sekali (kirim sebanyak apapun, gratis)
- Kamu bekerja offline atau di jaringan terbatas
- Kamu punya Mac Apple Silicon atau GPU — inferensi menjadi cepat
- Kamu ingin respons yang deterministik dan reprodusibel tanpa variabilitas jaringan

---

## Menginstal Ollama Lokal

### macOS

**Opsi 1 — Aplikasi desktop (direkomendasikan):**

Unduh dari [ollama.com/download](https://ollama.com/download). Aplikasi macOS menginstal Ollama sebagai menu bar app dan berjalan otomatis saat login.

**Opsi 2 — Homebrew:**

```bash
brew install ollama
```

Jalankan server:
```bash
ollama serve
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Installer menyiapkan layanan `systemd`. Ollama berjalan otomatis dan mendengarkan di port 11434.

### Windows

Unduh installer dari [ollama.com/download/windows](https://ollama.com/download/windows). Berjalan sebagai background service setelah instalasi.

---

## Mengunduh Model

Setelah Ollama terinstal, unduh model yang ingin kamu gunakan. Buka terminal:

```bash
# Model 7B yang cepat dan capable — titik awal yang baik
ollama pull qwen2.5-coder:7b

# Serba guna, penalaran bagus
ollama pull llama3.2

# Compact, sangat cepat di CPU
ollama pull qwen2.5:3b

# Lebih besar, kualitas lebih tinggi (butuh ~8GB RAM)
ollama pull llama3.1:8b
```

Jelajahi model yang tersedia di [ollama.com/library](https://ollama.com/library).

Untuk melihat daftar model yang sudah diunduh:
```bash
ollama list
```

---

## Menambahkan Ollama Lokal ke Stoa

1. Buka **Settings > Platforms**
2. Klik **+ add platform**
3. Isi:
   - **Name**: `Local Ollama` (atau label lain sesuai preferensimu)
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: kosongkan (Ollama lokal tidak memerlukannya)
4. Klik **Save**
5. Klik **Discover Models** — Stoa memeriksa setiap model yang tersedia dan mendeteksi mana yang mendukung vision (input gambar)
6. Di daftar model, centang model yang ingin tersedia di room selector
7. Klik **Save Selection**

Model lokal kamu sekarang muncul di dropdown model di composer, dikelompokkan di bawah nama platform kamu.

---

## Menambahkan Ollama Cloud ke Stoa

1. Daftar di [ollama.com](https://ollama.com) dan dapatkan API key dari pengaturan akun
2. Buka **Settings > Platforms > + add platform**
3. Isi:
   - **Name**: `Ollama Cloud`
   - **Base URL**: `https://ollama.com/v1`
   - **API Key**: API key Ollama kamu
4. Klik **Save**, lalu **Discover Models**
5. Pilih model yang kamu inginkan dan klik **Save Selection**

---

## Pemecahan Masalah

**"No models found" setelah Discover**

- Pastikan Ollama sedang berjalan: `ollama list` harus menampilkan hasil
- Periksa URL — Ollama lokal menggunakan `http://localhost:11434/v1` (bukan `https://`)
- Jika Stoa berjalan di mesin remote, gunakan IP mesin tersebut alih-alih `localhost`: `http://192.168.x.x:11434/v1`

**Model tidak merespons**

- Model mungkin belum diunduh. Jalankan `ollama pull <model-name>` di terminal
- Periksa memori yang tersedia — model besar membutuhkan RAM signifikan (model 7B butuh ~5GB)

**Respons lambat**

- Inferensi CPU lambat untuk model besar. Coba model yang lebih kecil (3B–7B) atau model yang dioptimalkan untuk CPU
- Di Apple Silicon, Ollama menggunakan Neural Engine — performa jauh lebih baik dibanding CPU x86

**Agent remote tidak bisa menjangkau Ollama lokal**

Jika Stoa agent berjalan di mesin yang berbeda dengan Ollama, agent perlu jalur untuk menjangkau Ollama. Opsi:
- Jalankan Ollama di mesin yang sama dengan agent
- Gunakan `OLLAMA_HOST=0.0.0.0 ollama serve` untuk mengekspos Ollama di semua interface, lalu gunakan IP mesin tersebut
- Gunakan Tailscale — masukkan kedua mesin ke jaringan Tailscale yang sama dan gunakan Tailscale IP
