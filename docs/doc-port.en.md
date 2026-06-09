# Changing the Server Port

Stoa's default port is **3030**. To change it, set `port` in `config.yaml` (or `PORT` in `.env`, which overrides it), then restart the gateway.

> Stoa runs as a native background service — the **gateway** (launchd on macOS, systemd on Linux). No PM2 required. Manage it with `stoa gateway <start|stop|restart|status>`.

> ⚠️ **If you have connected agents, read this first.**
>
> Each agent stores the server URL (including port) as `STOA_URL` in its service unit at install time. Changing the server port does **not** update agents automatically.
>
> - Agents lose their WebSocket connection when the old server stops
> - They retry every few seconds — but to the **old port** — and never reconnect
> - They stay offline until updated
>
> **Update each agent machine** after changing the port — see Step 3.

---

## Step 1: Set the port

Edit `config.yaml` in the data dir (`~/.stoa/server/config.yaml` when installed, or the repo root in development):

```yaml
port: 3031
```

(Alternatively set `PORT=3031` in `.env` — the environment overrides `config.yaml`.)

---

## Step 2: Restart the gateway

```bash
stoa gateway restart
```

The server is then available at `http://localhost:3031`.

---

## Step 3: Update each agent machine

Each agent has `STOA_URL` baked into its service unit. The simplest fix is to **re-run the install command** for that agent (shown in Settings → Agents) so it re-registers with the new URL.

To update in place, edit the agent's service unit and restart it:

- macOS: `~/Library/LaunchAgents/com.stoa.agent.<id>.plist`
- Linux: `~/.config/systemd/user/stoa-agent-<id>.service`

Change the `STOA_URL` value to the new port, then reload the service.

---

## Step 4: Update the public URL (if set)

If you configured a public URL, update it in `config.yaml` (`public_url`) or via **Settings** in the web UI — e.g. `http://100.x.x.x:3030` → `http://100.x.x.x:3031`.
