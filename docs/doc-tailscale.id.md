# Mendapatkan Public URL dengan Tailscale

Stoa berjalan di jaringan lokal kamu. Agar agent di mesin lain (atau di HP) bisa terhubung, server Stoa harus punya alamat yang bisa dijangkau dari luar jaringan lokal. **Tailscale** adalah cara termudah untuk melakukannya — ia membuat VPN mesh privat antar semua perangkat kamu, dan setiap perangkat mendapat IP tetap dalam rentang `100.x.x.x`.

---

## Apa itu Tailscale?

Tailscale membuat semua perangkat kamu — laptop, server, HP — seolah berada dalam satu jaringan lokal, di mana pun mereka berada secara fisik. Tidak perlu port forwarding, tidak perlu IP publik, tidak ada firewall yang perlu dikonfigurasi.

---

## 1. Install Tailscale di Server (mesin yang menjalankan Stoa)

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Setelah itu login via browser yang muncul, atau salin URL yang ditampilkan di terminal.

### Windows

Download installer dari [tailscale.com/download](https://tailscale.com/download) lalu jalankan. Setelah install, klik ikon Tailscale di system tray → **Log in**.

### macOS

```bash
brew install --cask tailscale
```

Atau download dari App Store. Buka aplikasi → **Log in**.

---

## 2. Mendapatkan IP Tailscale Server

Setelah login, cek IP Tailscale mesin ini:

### Linux / macOS

```bash
tailscale ip -4
# contoh output: 100.x.x.x
```

### Windows (PowerShell)

```powershell
(Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4).IPAddress
# contoh output: 100.x.x.x
```

Atau buka [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) — semua mesin dan IP-nya terdaftar di sana.

---

## 3. Set Public URL di Stoa

Ada dua cara:

**Via environment variable** — tambahkan ke file `.env` di root project Stoa:

```
STOA_PUBLIC_URL=http://100.x.x.x:3001
```

Ganti `100.x.x.x` dengan IP Tailscale mesin kamu.

**Via Settings UI** — buka Stoa di browser → **Settings → Server → Public URL**, isi URL-nya, klik **save**. Nilai ini disimpan di database dan override env variable.

---

## 4. Install Tailscale di HP

### Android

Download dari [Google Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn) atau langsung dari [tailscale.com/download](https://tailscale.com/download).

### iOS / iPhone

Download dari [App Store](https://apps.apple.com/app/tailscale/id1470499037).

Setelah install di HP:
1. Buka app Tailscale → **Sign in** dengan akun yang sama dengan server
2. Aktifkan VPN — HP kamu sekarang bisa menjangkau IP `100.x.x.x` server

Buka browser di HP → ketik `http://100.x.x.x:3001` (IP Tailscale server kamu) → Stoa terbuka.

---

## 5. Install Agent dari HP / Mesin Lain

Dengan Tailscale aktif di mesin target, jalankan install command yang tampil di **Settings → AI Agent → Add Agent**:

```bash
# Linux / macOS
curl -fsSL http://100.x.x.x:3001/install.sh | bash

# Windows (PowerShell)
irm http://100.x.x.x:3001/install.ps1 | iex
```

Agent akan otomatis mendaftar ke server dan terhubung.

---

## Catatan

- IP Tailscale bersifat tetap — tidak berubah selama kamu tidak menghapus mesin dari jaringan Tailscale.
- Semua traffic antar perangkat Tailscale terenkripsi end-to-end.
- Gratis untuk penggunaan personal hingga 3 pengguna dan 100 perangkat.
