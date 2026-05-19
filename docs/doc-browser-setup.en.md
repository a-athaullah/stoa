# Browser Setup Guide

Stoa uses browser features that require special permissions — especially when accessing via HTTP (non-HTTPS) over a local network or Tailscale. This guide covers how to enable **Voice Input**, **Push Notifications**, and **Add to Home Screen (PWA)** on desktop and mobile.

---

## Voice Input (Speech-to-Text)

Stoa has a built-in microphone button in the chat composer. Click it to start speaking — your speech is transcribed in real-time into the text field. Click send when ready.

### Requirements

- **Browser**: Chrome or Edge (full support). Safari has partial support. Firefox has limited support.
- **Internet connection**: Chrome uses Google's cloud speech recognition behind the scenes.
- **Microphone permission**: The browser must allow microphone access for Stoa's origin.

### Allowing Microphone on HTTP (Desktop)

Chrome blocks microphone access on non-HTTPS origins by default. If you access Stoa via a LAN IP or Tailscale IP (e.g., `http://100.90.197.4:3001`), you need to whitelist it:

1. Open a new tab and go to: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. In the text field, enter your Stoa URL: `http://YOUR_IP:PORT`
3. Set the dropdown to **Enabled**
4. Click **Relaunch** to restart Chrome

After relaunch, Chrome treats that origin as secure and allows microphone access.

**Tip**: If you access Stoa from the same machine the server runs on, use `localhost:PORT` instead — Chrome automatically treats localhost as a secure origin, no flags needed.

### Allowing Microphone on Android (Chrome)

1. Open Chrome and go to: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enter your Stoa URL (e.g., `http://100.90.197.4:3001`)
3. Set to **Enabled** and tap **Relaunch**
4. Navigate to Stoa, tap the mic button — Chrome will prompt for microphone permission, tap **Allow**

### Allowing Microphone on iOS (Safari)

iOS Safari supports speech recognition on secure origins. For HTTP access:

1. Open **Settings > Safari > Advanced > Experimental Features**
2. Ensure **MediaDevices** and **SpeechRecognition** are enabled
3. When Stoa asks for microphone access, tap **Allow**

Note: iOS Safari may have limited Web Speech API support. For the best experience, use a desktop browser or Android Chrome.

### Voice Commands

While the microphone is active, you can use voice commands instead of tapping buttons:

| Language | Send | Stop | Clear |
|----------|------|------|-------|
| EN | "send now" | "stop listening" | "clear all" |
| ID | "kirimkan sekarang" | "matikan mic" | "hapus semua" |
| JA | "送信して" | "マイク止め" | "全部消して" |
| KO | "지금 보내" | "마이크 끄" | "전부 지우" |
| ZH | "现在发送" | "关闭麦克风" | "全部清除" |

Cycle through languages with the **EN/ID/JA/KO/ZH** button next to the mic button (EN → ID → JA → KO → ZH). Your choice is saved.

### Behavior Differences: Desktop vs Android

Voice input works on both desktop and Android, but with different behavior due to Chrome Android limitations:

| Behavior | Desktop (Chrome/Edge) | Android (Chrome) |
|----------|----------------------|-------------------|
| **Continuous listening** | Yes — mic stays on indefinitely | Limited — mic stops after brief silence (~3-7s) |
| **After silence** | Mic auto-restarts seamlessly | Mic turns off — tap mic to resume |
| **Text between sessions** | Preserved across restarts | Preserved in text field — tap mic to continue |
| **Voice commands** | Work anytime while mic is on | Work while mic is active (before timeout) |
| **Mic during AI response** | Muted (no text written) | Same — muted during processing |

**Why the difference?** Android Chrome's Web Speech API does not properly support continuous listening mode. Auto-restarting the mic on Android causes an audible "ding" sound every restart and may produce duplicate text. To avoid these issues, Stoa lets the mic stop naturally on Android.

**Tip for Android**: Speak your full message in one go, then say the send command (e.g., "send now" in EN) before pausing. This avoids the timeout and sends in one flow.

### Language Support

Voice input defaults to **English (en-US)**. Five languages are supported: English, Indonesian, Japanese, Korean, and Chinese. Use the language toggle button next to the mic to switch.

---

## Push Notifications

Stoa sends browser push notifications when agents respond, even when the tab is in the background.

### Enabling on Desktop (Chrome/Edge)

1. Click the **bell icon** in the Stoa sidebar footer
2. When the browser prompts "Allow notifications?", click **Allow**
3. If you accidentally blocked it, click the **lock/info icon** in the address bar > **Site settings** > set Notifications to **Allow**

### Enabling on Android (Chrome)

1. Open Stoa in Chrome
2. Tap the **bell icon** in the sidebar footer
3. When prompted, tap **Allow**
4. If blocked: tap the **lock icon** in the address bar > **Permissions** > **Notifications** > **Allow**

Alternatively: **Chrome Settings > Site Settings > Notifications** > find your Stoa URL and set to **Allow**.

### Enabling on iOS (Safari 16.4+)

Push notifications on iOS require Stoa to be installed as a PWA first:

1. **Add Stoa to Home Screen** (see next section)
2. Open Stoa from the Home Screen icon
3. Tap the bell icon to enable notifications
4. When prompted, tap **Allow**

Note: iOS push notifications only work from the PWA (Home Screen app), not from Safari tabs.

---

## Add to Home Screen (PWA)

Install Stoa as a Progressive Web App for a native app experience — full screen, no browser chrome, and faster access.

### Android (Chrome)

1. Open Stoa in Chrome
2. Tap the **three-dot menu** (top right)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Confirm the name and tap **Add**
5. Stoa appears on your home screen as an app icon

### iOS (Safari)

1. Open Stoa in Safari
2. Tap the **Share button** (square with arrow, bottom center)
3. Scroll down and tap **"Add to Home Screen"**
4. Confirm the name and tap **Add**
5. Stoa appears on your home screen as an app icon

### Desktop (Chrome/Edge)

1. Open Stoa in Chrome or Edge
2. Click the **install icon** in the address bar (or three-dot menu > "Install Stoa")
3. Click **Install**
4. Stoa opens as a standalone window

### Why Install as PWA?

- **Full screen**: No address bar or browser tabs taking up space
- **Quick access**: Launch from home screen like a native app
- **Push notifications on iOS**: Required for iOS push notification support
- **Offline indicator**: Shows connection status clearly

---

## Quick Reference

| Feature | Desktop Chrome | Android Chrome | iOS Safari |
|---------|---------------|----------------|------------|
| Voice Input | Chrome flag | Chrome flag | Limited support |
| Push Notifications | Allow prompt | Allow prompt | PWA required (iOS 16.4+) |
| Add to Home Screen | Install icon | Menu > Add to Home | Share > Add to Home |
| HTTP workaround | chrome://flags | chrome://flags | Settings > Safari |
