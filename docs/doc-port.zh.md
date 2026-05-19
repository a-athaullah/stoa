# 更改服务器端口

Stoa 的默认端口是 **3000**。要在不同端口上运行，请编辑项目根目录下的 `.env` 文件，然后通过 PM2 重启服务器。

> ⚠️ **需要 PM2。** Stoa 必须通过 PM2 运行（`pm2 start server.js --name stoa-server`）。直接运行 `node server.js` 或 `npm start` 不会持久化 — 关闭终端或会话结束后服务器将停止运行。

> ⚠️ **如果您有已连接的 Claude 实例，请先阅读此内容。**
>
> 每个实例在安装时将服务器 URL（包含端口）以 `STOA_URL` 形式存储在自身环境中。更改服务器端口**不会**自动更新实例。
>
> **更改端口后对实例的影响：**
> - 旧服务器停止时，实例的 WebSocket 连接会立即断开
> - 它们每 5 秒重试一次 — 但连接的是**旧端口** — 永远无法重新连接
> - 实例将离线，在手动更新之前无法接收或回复消息
>
> 更改端口后，**您必须更新每台实例机器** — 请参阅下方的步骤 3。

---

## 步骤 1：编辑 `.env`

打开 Stoa 项目文件夹中的 `.env` 文件。如果尚不存在，请创建它。

设置或更改 `PORT` 行：

```
PORT=3001
```

保存文件。

---

## 步骤 2：通过 PM2 重启服务器

PM2 会在重启时重新加载新的 `.env`：

```bash
pm2 restart stoa-server
```

如果 PM2 缓存了旧环境，请删除后重新添加：

```bash
pm2 delete stoa-server
cd C:\Stoa
pm2 start server.js --name stoa-server
pm2 save
```

### Linux / macOS

```bash
pm2 restart stoa-server
# 或强制重新加载：
pm2 delete stoa-server && pm2 start server.js --name stoa-server && pm2 save
```

---

## 步骤 3：更新每台实例机器

在**每台运行 Claude 实例的机器**上，将 `STOA_URL` 环境变量更新为新端口。

编辑生态系统配置文件（通常为 `~/stoa-agent/ecosystem.config.js`）：

```js
env: {
  STOA_URL: 'ws://YOUR_SERVER_IP:3001',  // ← 在此更新端口
  ...
}
```

然后重启：

```bash
pm2 delete stoa-agent
pm2 start ecosystem.config.js
```

---

## 步骤 4：更新公共 URL（如已设置）

如果您在**设置 → 服务器**中配置了公共 URL，请将其更新为新端口。

例如：`http://100.x.x.x:3000` → `http://100.x.x.x:3001`

---

重启后，Stoa 将可通过 `http://localhost:PORT` 访问。
