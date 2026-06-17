# Ollama 设置指南

Stoa 支持将 **Ollama** 作为 AI 模型提供商 — 既支持托管的云服务，也支持在本机上的本地安装。本指南将介绍这两种选项及其配置方法。

---

## 什么是 Ollama？

[Ollama](https://ollama.com) 是一个用于运行大型语言模型的开源工具。它提供与 OpenAI 兼容的 HTTP API，这意味着 Stoa 无需任何特殊适配器即可与之通信 — 只需将 Stoa 指向对应的 URL 即可正常工作。

Ollama 提供了丰富的开源模型库：Llama、Qwen、Mistral、Gemma、DeepSeek 等。其中部分模型也可通过 Ollama Cloud 托管服务使用。

---

## Ollama Cloud vs 本地 Ollama

| | Ollama Cloud | 本地 Ollama |
|---|---|---|
| **URL** | `http://localhost:11434/v1`（通过本地守护进程） | `http://localhost:11434/v1` |
| **需要本地安装** | 是 — 需要 Ollama CLI | 是 |
| **需要网络连接** | 是 | 否（下载模型后） |
| **费用** | 免费额度 + 付费 | 免费（电费 + 硬件） |
| **模型规模** | 最高 480B+ 参数 | 受 RAM/VRAM 限制 |
| **隐私** | 提示词发送至 Ollama 服务器 | 数据留在本机 |
| **速度** | 取决于服务器负载 | 取决于本机硬件 |
| **最适合** | 无本地 GPU 时运行大型模型 | 敏感数据、离线使用、无 API 费用 |

### 何时使用 Ollama Cloud

- 想在没有 GPU 的情况下运行超大模型（70B、235B、480B）
- 处于实验阶段，不想管理本地基础设施
- 服务器响应速度可以接受

### 何时使用本地 Ollama

- 提示词包含敏感代码、个人数据或机密信息
- 希望零 API 费用（随意发送消息，完全免费）
- 在离线或受限网络环境中工作
- 拥有 Apple Silicon Mac 或 GPU — 推理速度很快
- 希望获得确定性、可复现的响应，不受网络波动影响

---

## 安装本地 Ollama

### macOS

**选项 1 — 桌面应用（推荐）：**

从 [ollama.com/download](https://ollama.com/download) 下载。macOS 应用将 Ollama 安装为菜单栏应用，并在登录时自动启动。

**选项 2 — Homebrew：**

```bash
brew install ollama
```

启动服务器：
```bash
ollama serve
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

安装程序会配置 `systemd` 服务。Ollama 将自动启动并监听 11434 端口。

### Windows

从 [ollama.com/download/windows](https://ollama.com/download/windows) 下载安装程序。安装后作为后台服务运行。

---

## 下载模型

安装 Ollama 后，拉取你想使用的模型。打开终端：

```bash
# 快速且强大的 7B 模型 — 良好的起点
ollama pull qwen2.5-coder:7b

# 通用型，推理能力出色
ollama pull llama3.2

# 轻量级，CPU 上速度极快
ollama pull qwen2.5:3b

# 规模更大，质量更高（需要约 8GB RAM）
ollama pull llama3.1:8b
```

在 [ollama.com/library](https://ollama.com/library) 浏览所有可用模型。

列出已下载的模型：
```bash
ollama list
```

> **重要：** Stoa 需要支持**工具调用（tool calling）**的模型。不支持工具的模型在发现时会自动排除。请在 Ollama 库页面查看模型的功能 — 寻找 "Tools" 标签。大多数较新的模型（Qwen 2.5+、Llama 3.1+、Mistral、Gemma 4）都支持工具。

---

## 将本地 Ollama 添加到 Stoa

1. 进入 **Settings > Platforms**
2. 点击 **+ add platform**
3. 填写：
   - **Name**：`Local Ollama`（或其他你喜欢的名称）
   - **Base URL**：`http://localhost:11434/v1`
   - **API Key**：留空（本地 Ollama 无需 API Key）
4. 点击 **Save**
5. 点击 **Discover Models** — Stoa 会探测每个可用模型，并检测哪些支持视觉功能（图像输入）
6. 在模型列表中，勾选你希望在房间选择器中可用的模型
7. 点击 **Save Selection**

你的本地模型现在会出现在编辑器的模型下拉菜单中，按平台名称分组显示。

---

## 将 Ollama Cloud 添加到 Stoa

Ollama Cloud 通过本地 Ollama 守护进程路由请求 — 你的机器将提示词转发至 Ollama 服务器。因此，即使访问云端模型，也**必须安装并登录 Ollama CLI**。

### 第一步 — 安装 Ollama CLI

按照上面的[安装本地 Ollama](#安装本地-ollama) 部分操作。守护进程需要处于运行状态。

### 第二步 — 登录 Ollama 账号

```bash
ollama login
```

按提示使用 Ollama 账号进行身份验证。这样守护进程才能将请求路由到你有权访问的云端模型。

### 第三步 — 在 Stoa 中添加平台

1. 在 [ollama.com](https://ollama.com) 注册账号，并从账号设置中获取 API Key
2. 进入 **Settings > Platforms > + add platform**
3. 填写：
   - **Name**：`Ollama Cloud`
   - **Base URL**：`http://localhost:11434/v1`
   - **API Key**：你的 Ollama API Key
4. 点击 **Save**，然后点击 **Discover Models**
5. 选择所需模型并点击 **Save Selection**

---

## 跨多台机器共享 Ollama（多智能体设置）

默认情况下，Ollama 仅监听 `127.0.0.1`（本地回环地址）。如果你希望运行在不同机器上的多个 Stoa 智能体都使用同一个 Ollama 实例，你需要让 Ollama 在网络上可访问。

即使从你自己的机器通过 **Tailscale IP**（例如 `http://100.x.x.x:11434/v1`）访问 Ollama 也需要此设置，因为 Tailscale 接口被视为独立的网络接口。

### 第一步 — 允许 Ollama 监听所有接口

**macOS (Ollama.app):**

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
```

然后重启 Ollama：从菜单栏退出后重新打开。

> 此设置在下次重启前持续有效。若要使其永久生效，请将其添加到你的 shell 配置中，并从终端重启 Ollama：
> ```bash
> echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.zshrc
> source ~/.zshrc
> ollama serve
> ```

**macOS (Homebrew / CLI):**

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

或将 `export OLLAMA_HOST=0.0.0.0` 添加到 `~/.zshrc`，然后从终端运行 `ollama serve`。

**Linux (systemd):**

```bash
sudo systemctl edit ollama
```

添加以下内容：
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

然后：
```bash
sudo systemctl restart ollama
```

### 第二步 — 在 Stoa 中使用正确的 URL

Ollama 监听所有接口后，使用以下任一地址：
- **LAN IP**: `http://192.168.x.x:11434/v1`
- **Tailscale IP**: `http://100.x.x.x:11434/v1`

Stoa 中的每个智能体都可以配置为使用此 URL — 同一 Tailscale 网络中任何机器上的智能体都可以共享同一个 Ollama 实例。

### 验证连接

从任何需要访问 Ollama 的机器上运行：

```bash
curl http://<ollama-machine-ip>:11434/api/tags
```

如果返回了模型列表，则连接正常，Stoa 将能够从该地址发现模型。

---

## 故障排查

**Discover 后显示"No models found"**

- 确保 Ollama 正在运行：`ollama list` 应该返回结果
- 检查 URL — 本地 Ollama 地址为 `http://localhost:11434/v1`（不是 `https://`）
- 通过 Tailscale IP 访问？请参阅上面的[多智能体设置](#跨多台机器共享-ollama多智能体设置)部分 — 需要先设置 `OLLAMA_HOST=0.0.0.0`

**Discover 后显示"N 个中 0 个可用"（模型已列出但均不可用）**

- 对于 **Ollama Cloud**：守护进程未经过身份验证。在终端中运行 `ollama login`，然后重新点击 Discover Models。
- Stoa 会通过测试请求探测每个模型，以验证其在你的订阅等级下是否可用。未经身份验证时，所有探测均会失败，模型显示为不可用。
- 登录后无需重启任何服务 — 只需重新运行 Discover Models 即可。

**发现后模型未显示（已经 pull 过）**

- 该模型可能不支持 Stoa 所需的**工具调用**。只有支持工具的模型才会显示。请尝试支持工具的模型（例如 `qwen2.5-coder:7b`、`llama3.1:8b`、`gemma4:12b`）。

**模型没有响应**

- 模型可能尚未拉取。在终端中运行 `ollama pull <model-name>`
- 检查可用内存 — 大型模型需要大量 RAM（7B 模型需要约 5GB）

**响应缓慢**

- 大型模型的 CPU 推理较慢。尝试使用较小的模型（3B–7B）或针对 CPU 优化的模型
- 在 Apple Silicon 上，Ollama 使用 Neural Engine — 性能远优于 x86 CPU
