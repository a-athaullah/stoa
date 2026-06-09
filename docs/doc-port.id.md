# Mengubah Port Server

Port default Stoa adalah **3030**. Untuk mengubahnya, atur `port` di `config.yaml` (atau `PORT` di `.env`, yang akan menimpa config.yaml), lalu restart gateway.

> Stoa berjalan sebagai service background native — **gateway** (launchd di macOS, systemd di Linux). Tidak perlu PM2. Kelola dengan `stoa gateway <start|stop|restart|status>`.

> ⚠️ **Jika kamu sudah punya agent yang tersambung, baca ini dulu.**
>
> Setiap agent menyimpan URL server (termasuk port) sebagai `STOA_URL` di service unit-nya saat install. Mengubah port server **tidak** otomatis memperbarui agent.
>
> - Agent kehilangan koneksi WebSocket saat server lama dimatikan
> - Agent reconnect tiap beberapa detik — tapi ke **port lama** — dan tidak akan berhasil
> - Agent tetap offline sampai diperbarui
>
> **Update setiap mesin agent** setelah mengganti port — lihat Langkah 3.

---

## Langkah 1: Atur port

Edit `config.yaml` di folder data (`~/.stoa/server/config.yaml` saat installed, atau root repo saat development):

```yaml
port: 3031
```

(Alternatif: atur `PORT=3031` di `.env` — environment menimpa `config.yaml`.)

---

## Langkah 2: Restart gateway

```bash
stoa gateway restart
```

Setelah itu server tersedia di `http://localhost:3031`.

---

## Langkah 3: Update setiap mesin agent

Setiap agent punya `STOA_URL` tertanam di service unit-nya. Cara termudah: **jalankan ulang perintah install** untuk agent itu (lihat di Settings → Agents) supaya agent mendaftar ulang dengan URL baru.

Untuk mengubah langsung, edit service unit agent lalu restart:

- macOS: `~/Library/LaunchAgents/com.stoa.agent.<id>.plist`
- Linux: `~/.config/systemd/user/stoa-agent-<id>.service`

Ubah nilai `STOA_URL` ke port baru, lalu reload service-nya.

---

## Langkah 4: Perbarui Public URL (jika ada)

Jika kamu mengatur public URL, perbarui di `config.yaml` (`public_url`) atau lewat **Settings** di web UI — mis. `http://100.x.x.x:3030` → `http://100.x.x.x:3031`.
