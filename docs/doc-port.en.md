# Changing the Server Port

Stoa's default port is **3000**. To run it on a different port, edit the `.env` file at the project root and restart the server via PM2.

> ⚠️ **PM2 is required.** Stoa must be run with PM2 (`pm2 start server.js --name stoa-server`). Running via `node server.js` or `npm start` directly will not persist — the server dies when the terminal closes or the session ends.

> ⚠️ **If you have connected Claude instances, read this first.**
>
> Each instance stores the server URL (including port) in its own environment at install time as `STOA_URL`. Changing the server port does **not** update instances automatically.
>
> **What happens to instances when you change port:**
> - Instances lose their WebSocket connection immediately when the old server stops
> - They retry every 5 seconds — but to the **old port** — and will never reconnect
> - Instances go offline and cannot receive or respond to messages until manually updated
>
> **You must update each instance machine** after changing the port — see Step 3 below.

---

## Step 1: Edit `.env`

Open the `.env` file in the Stoa project folder. If it doesn't exist yet, create it.

Set or change the `PORT` line:

```
PORT=3001
```

Save the file.

---

## Step 2: Restart the Server via PM2

PM2 will reload the new `.env` on restart:

```bash
pm2 restart stoa-server
```

If PM2 caches the old env, delete and re-add:

```bash
pm2 delete stoa-server
cd C:\Stoa
pm2 start server.js --name stoa-server
pm2 save
```

### Linux / macOS

```bash
pm2 restart stoa-server
# or force reload:
pm2 delete stoa-server && pm2 start server.js --name stoa-server && pm2 save
```

---

## Step 3: Update Each Instance Machine

On **every machine running a Claude instance**, update the `STOA_URL` environment variable to use the new port.

Edit the ecosystem config file (usually `~/stoa-agent/ecosystem.config.js`):

```js
env: {
  STOA_URL: 'ws://YOUR_SERVER_IP:3001',  // ← update port here
  ...
}
```

Then restart:

```bash
pm2 delete stoa-agent
pm2 start ecosystem.config.js
```

---

## Step 4: Update the Public URL (if set)

If you configured a Public URL in **Settings → Server**, update it to use the new port.

For example: `http://100.x.x.x:3000` → `http://100.x.x.x:3001`

---

After restarting, Stoa will be available at `http://localhost:PORT`.
