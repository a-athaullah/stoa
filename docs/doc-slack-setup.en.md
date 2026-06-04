# Setting Up Slack for Stoa Automation

Stoa connects to Slack via **Socket Mode** — an outbound WebSocket connection. No public URL or open port required.

You need two tokens: an **App Token** (for the WebSocket connection) and a **Bot Token** (for reading messages).

---

## Step 1 — Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**
3. Enter an app name (e.g. `Stoa`) and select your workspace
4. Click **Create App**

---

## Step 2 — Enable Socket Mode

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to **On**

---

## Step 3 — Get the App Token

1. Go to **Settings → Basic Information**
2. Scroll down to **App-Level Tokens**
3. Click **Generate Token and Scopes**
4. Give it a name (e.g. `stoa-socket`)
5. Add scope: `connections:write`
6. Click **Generate** — copy the token starting with `xapp-1-`

---

## Step 4 — Add Bot Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `app_mentions:read` — read mentions of the bot
   - `channels:history` — read messages in channels
   - `users:read` — look up user display names

---

## Step 5 — Subscribe to Events

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to **On**
3. Under **Subscribe to bot events**, add:
   - `app_mention` — when the bot is mentioned
   - `message.channels` — messages in public channels

---

## Step 6 — Install the App

1. In the left sidebar, click **OAuth & Permissions**
2. Click **Install to Workspace** (or **Reinstall** if already installed)
3. Approve the permissions
4. Copy the **Bot User OAuth Token** starting with `xoxb-`

---

## Step 7 — Connect in Stoa

1. Open Stoa → **Settings → automation**
2. Click **Connect Slack**
3. Paste the App Token (`xapp-1-...`) and Bot Token (`xoxb-...`)
4. Click **Connect** — Stoa will verify the connection and show your workspace name

You can now add automation rules that trigger when Slack events occur.
