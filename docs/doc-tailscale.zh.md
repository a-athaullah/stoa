# 使用 Tailscale 获取公共 URL

Stoa 运行在本地网络上。要让其他机器上的代理或手机连接，Stoa 服务器需要一个可达的地址。**Tailscale** 是实现这一目标的最简单方式：它在所有设备之间创建一个私有网状 VPN，为每台设备分配 `100.x.x.x` 范围内的稳定 IP。

---

## 什么是 Tailscale？

Tailscale 让您的所有设备 — 笔记本电脑、服务器、手机 — 无论物理位置在哪里，都像在同一个局域网中一样运行。无需端口转发、公网 IP 或防火墙规则。

---

## 1. 在服务器上安装 Tailscale（运行 Stoa 的机器）

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

会出现一个浏览器窗口或登录 URL — 在那里完成登录。

### Windows

从 [tailscale.com/download](https://tailscale.com/download) 下载安装程序并运行。安装后，点击系统托盘中的 Tailscale 图标 → **登录**。

### macOS

```bash
brew install --cask tailscale
```

或从 App Store 安装。打开应用 → **登录**。

---

## 2. 查找服务器的 Tailscale IP

登录后，获取此机器的 Tailscale IP：

### Linux / macOS

```bash
tailscale ip -4
# 示例: 100.x.x.x
```

### Windows（PowerShell）

```powershell
(Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4).IPAddress
# 示例: 100.x.x.x
```

或打开 [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) — 所有机器及其 IP 都列在那里。

---

## 3. 在 Stoa 中设置公共 URL

有两种方式：

**通过环境变量** — 添加到 Stoa 项目根目录的 `.env` 文件：

```
STOA_PUBLIC_URL=http://100.x.x.x:3001
```

将 `100.x.x.x` 替换为您机器的 Tailscale IP。

**通过设置界面** — 在浏览器中打开 Stoa → **设置 → 服务器 → 公共 URL**，输入 URL，点击**保存**。此值存储在数据库中，优先于环境变量。

---

## 4. 在手机上安装 Tailscale

### Android

从 [Google Play 商店](https://play.google.com/store/apps/details?id=com.tailscale.ipn)下载，或直接从 [tailscale.com/download](https://tailscale.com/download) 下载。

### iOS / iPhone

从 [App Store](https://apps.apple.com/app/tailscale/id1470499037) 下载。

在手机上安装后：
1. 打开 Tailscale 应用 → 使用与服务器相同的账户**登录**
2. 启用 VPN — 您的手机现在可以访问服务器的 `100.x.x.x` IP

在手机上打开浏览器 → 输入 `http://100.x.x.x:3001`（服务器的 Tailscale IP）→ Stoa 即可加载。

---

## 5. 从另一台机器安装代理

在目标机器上运行 Tailscale 的情况下，执行**Settings → AI Agent → Add Agent**中显示的安装命令：

```bash
# Linux / macOS
curl -fsSL http://100.x.x.x:3001/install.sh | bash

# Windows（PowerShell）
irm http://100.x.x.x:3001/install.ps1 | iex
```

代理将在服务器上注册并自动连接。

---

## 注意事项

- Tailscale IP 是稳定的 — 除非您从 Tailscale 网络中移除机器，否则不会改变。
- Tailscale 设备之间的所有流量都经过端到端加密。
- 个人使用免费：最多 3 个用户和 100 台设备。
