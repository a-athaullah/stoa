# Setting Up Slack for Stoa Automation

Stoa connects to Slack via **Socket Mode** — an outbound WebSocket connection. No public URL or open port required.

You need two tokens: an **App Token** (for the WebSocket connection) and a **User Token** (to receive events from your channels).

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
3. In the dialog, give the token a name (e.g. `stoa-listener`)
4. The `connections:write` scope is added automatically — click **Generate**
5. Copy the token starting with `xapp-1-` — this is your **App Token**

---

## Step 3 — Add User Token Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll to the **User Token Scopes** section (not Bot Token Scopes)
3. Add the following scopes:
   - `channels:history` — read messages in public channels
   - `channels:read` — read channel info
   - `groups:history` — read messages in **private channels**
   - `im:history` — read direct messages

---

## Step 4 — Subscribe to User Events

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to **On**
3. Scroll to **Subscribe to events on behalf of users** (not "bot events")
4. Click **Add Workspace Event** and add:
   - `message.channels` — messages in public channels you're a member of
   - `message.groups` — messages in **private channels** you're a member of
   - `message.im` — direct messages you receive
5. Click **Save Changes**

---

## Step 5 — Install the App

1. In the left sidebar, click **Install App**
2. Click **Install to Workspace** (or **Reinstall** if already installed)
3. Approve the permissions
4. Copy the **User OAuth Token** starting with `xoxp-`

---

## Step 6 — Bot invite not required

With the User Token approach, the bot does **not** need to be invited to any channel — events come from the channels you (the user) are already a member of.

---

## Step 7 — Connect in Stoa

1. Open Stoa → **Settings → automation**
2. Click **Connect Slack**
3. Paste the **App Token** (`xapp-1-...`) and **User Token** (`xoxp-...`)
4. Click **Connect** — Stoa will verify the connection

You can now add automation rules that trigger when Slack events occur.

---

## Note: Reinstall after changing permissions

Any time you add or change User Token Scopes, Slack requires a reinstall. Click **Reinstall to Workspace** on the **Install App** page and approve. Your User Token stays the same; only the permissions are updated.
