# 更改服务器端口

Stoa 的默认端口是 **3030**。要更改它，请在 `config.yaml` 中设置 `port`（或在 `.env` 中设置 `PORT`，它会覆盖 config.yaml），然后重启网关。

> Stoa 作为原生后台服务运行 —— **网关**（macOS 用 launchd，Linux 用 systemd）。无需 PM2。使用 `stoa gateway <start|stop|restart|status>` 进行管理。

> ⚠️ **如果您有已连接的代理，请先阅读此内容。**
>
> 每个代理在安装时将服务器 URL（包含端口）以 `STOA_URL` 形式存储在其服务单元中。更改服务器端口**不会**自动更新代理。
>
> - 旧服务器停止时，代理的 WebSocket 连接会断开
> - 它们每隔几秒重试一次 —— 但连接的是**旧端口** —— 永远无法重新连接
> - 在更新之前它们将保持离线
>
> 更改端口后，**请更新每台代理机器** —— 参见步骤 3。

---

## 步骤 1：设置端口

编辑数据目录中的 `config.yaml`（安装时为 `~/.stoa/server/config.yaml`，开发时为仓库根目录）：

```yaml
port: 3031
```

（或在 `.env` 中设置 `PORT=3031` —— 环境变量会覆盖 `config.yaml`。）

---

## 步骤 2：重启网关

```bash
stoa gateway restart
```

随后服务器将可通过 `http://localhost:3031` 访问。

---

## 步骤 3：更新每台代理机器

每个代理的服务单元中都内置了 `STOA_URL`。最简单的方法是**重新运行该代理的安装命令**（在“设置 → 代理”中显示），使其以新 URL 重新注册。

要就地更新，请编辑代理的服务单元并重启：

- macOS：`~/Library/LaunchAgents/com.stoa.agent.<id>.plist`
- Linux：`~/.config/systemd/user/stoa-agent-<id>.service`

将 `STOA_URL` 的值改为新端口，然后重新加载服务。

---

## 步骤 4：更新公共 URL（如已设置）

如果您配置了公共 URL，请在 `config.yaml`（`public_url`）或 Web UI 的**设置**中更新它 —— 例如 `http://100.x.x.x:3030` → `http://100.x.x.x:3031`。
