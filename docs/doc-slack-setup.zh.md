# 为 Stoa 自动化配置 Slack

Stoa 通过 **Socket Mode** 连接 Slack — 这是一个出站 WebSocket 连接，无需公开 URL 或开放端口。

你需要两个令牌：**App Token**（用于 WebSocket 连接）和 **User Token**（用于接收频道事件）。

---

## 第1步 — 创建 Slack App

1. 打开 [https://api.slack.com/apps](https://api.slack.com/apps)，点击 **Create New App**
2. 选择 **From scratch**
3. 输入 App 名称（例如 `Stoa`）并选择你的工作区
4. 点击 **Create App**

---

## 第2步 — 启用 Socket Mode

1. 在左侧边栏点击 **Socket Mode**
2. 将 **Enable Socket Mode** 切换为 **On**
3. 在弹出对话框中输入令牌名称（例如 `stoa-listener`）
4. `connections:write` 权限会自动添加 — 点击 **Generate**
5. 复制以 `xapp-1-` 开头的令牌 — 这就是你的 **App Token**

---

## 第3步 — 添加 User Token Scopes

1. 在左侧边栏点击 **OAuth & Permissions**
2. 滚动到 **User Token Scopes** 部分（不是 Bot Token Scopes）
3. 添加以下权限：
   - `channels:history` — 读取公开频道的消息
   - `channels:read` — 读取频道信息
   - `groups:history` — 读取**私有频道**的消息
   - `im:history` — 读取私信消息

---

## 第4步 — 订阅用户事件

1. 在左侧边栏点击 **Event Subscriptions**
2. 将 **Enable Events** 切换为 **On**
3. 滚动到 **Subscribe to events on behalf of users**（不是 "bot events"）
4. 点击 **Add Workspace Event** 并添加：
   - `message.channels` — 你加入的公开频道中的消息
   - `message.groups` — 你加入的**私有频道**中的消息
   - `message.im` — 你收到的私信
5. 点击 **Save Changes**

---

## 第5步 — 安装 App

1. 在左侧边栏点击 **Install App**
2. 点击 **Install to Workspace**（如已安装则点击 **Reinstall**）
3. 批准权限
4. 复制以 `xoxp-` 开头的 **User OAuth Token**

---

## 第6步 — 无需邀请 Bot 进入频道

使用 User Token 方式，Bot **不需要**被邀请到任何频道 — 事件直接来自你（用户）已经加入的频道。

---

## 第7步 — 在 Stoa 中连接

1. 打开 Stoa → **Settings → Automation → Connections**
2. 点击 **Add Connection**
3. 输入名称，选择 **Slack** 作为提供商，选择 **User** 作为令牌类型
4. 粘贴 **App Token**（`xapp-1-...`）和 **User Token**（`xoxp-...`）
5. 点击 **Save** — Stoa 将建立连接

连接成功后，你可以添加由 Slack 事件触发的自动化规则。

---

## 注意：更改权限后需重新安装

每次添加或修改 User Token Scopes 后，Slack 都需要重新安装。在 **Install App** 页面点击 **Reinstall to Workspace** 并批准。你的 User Token 保持不变，只有权限会更新。
