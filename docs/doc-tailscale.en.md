# Getting a Public URL with Tailscale

Stoa runs on your local network. For agents on other machines — or on your phone — to connect, the Stoa server needs a reachable address. **Tailscale** is the easiest way to do this: it creates a private mesh VPN across all your devices, giving each one a stable IP in the `100.x.x.x` range.

---

## What is Tailscale?

Tailscale makes all your devices — laptops, servers, phones — behave as if they're on the same local network, no matter where they physically are. No port forwarding, no public IP, no firewall rules needed.

---

## 1. Install Tailscale on the Server (the machine running Stoa)

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

A browser window or a login URL will appear — complete the sign-in there.

### Windows

Download the installer from [tailscale.com/download](https://tailscale.com/download) and run it. After installing, click the Tailscale icon in the system tray → **Log in**.

### macOS

```bash
brew install --cask tailscale
```

Or install from the App Store. Open the app → **Log in**.

---

## 2. Find Your Server's Tailscale IP

Once signed in, get the Tailscale IP of this machine:

### Linux / macOS

```bash
tailscale ip -4
# example: 100.x.x.x
```

### Windows (PowerShell)

```powershell
(Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4).IPAddress
# example: 100.x.x.x
```

Or open [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) — all your machines and their IPs are listed there.

---

## 3. Set the Public URL in Stoa

Two ways:

**Via environment variable** — add to the `.env` file at the Stoa project root:

```
STOA_PUBLIC_URL=http://100.x.x.x:3001
```

Replace `100.x.x.x` with your machine's Tailscale IP.

**Via the Settings UI** — open Stoa in your browser → **Settings → Server → Public URL**, enter the URL, click **save**. This value is stored in the database and overrides the env variable.

---

## 4. Install Tailscale on Your Phone

### Android

Download from the [Google Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn) or directly from [tailscale.com/download](https://tailscale.com/download).

### iOS / iPhone

Download from the [App Store](https://apps.apple.com/app/tailscale/id1470499037).

After installing on your phone:
1. Open the Tailscale app → **Sign in** with the same account used on the server
2. Enable the VPN — your phone can now reach the server's `100.x.x.x` IP

Open a browser on your phone → type `http://100.x.x.x:3001` (your server's Tailscale IP) → Stoa loads.

---

## 5. Installing an Agent from Another Machine

With Tailscale running on the target machine, run the install command shown in **Settings → Agents → Add Agent**:

```bash
# Linux / macOS
curl -fsSL http://100.x.x.x:3001/install.sh | bash

# Windows (PowerShell)
irm http://100.x.x.x:3001/install.ps1 | iex
```

The agent will register with the server and connect automatically.

---

## Notes

- Tailscale IPs are stable — they don't change unless you remove the machine from your Tailscale network.
- All traffic between Tailscale devices is end-to-end encrypted.
- Free for personal use: up to 3 users and 100 devices.
