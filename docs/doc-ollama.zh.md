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
| **URL** | `https://ollama.com/v1` | `http://localhost:11434/v1` |
| **需要本地安装** | 否 | 是 |
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

1. 在 [ollama.com](https://ollama.com) 注册账号，并从账号设置中获取 API Key
2. 进入 **Settings > Platforms > + add platform**
3. 填写：
   - **Name**：`Ollama Cloud`
   - **Base URL**：`https://ollama.com/v1`
   - **API Key**：你的 Ollama API Key
4. 点击 **Save**，然后点击 **Discover Models**
5. 选择所需模型并点击 **Save Selection**

---

## 故障排查

**Discover 后显示"No models found"**

- 确认 Ollama 正在运行：`ollama list` 应该返回结果
- 检查 URL — 本地 Ollama 使用 `http://localhost:11434/v1`（不是 `https://`）
- 如果 Stoa 运行在远程机器上，请使用该机器的 IP 替换 `localhost`：`http://192.168.x.x:11434/v1`

**模型无响应**

- 该模型可能尚未下载。在终端运行 `ollama pull <model-name>`
- 检查可用内存 — 大型模型需要大量 RAM（7B 模型需要约 5GB）

**响应速度慢**

- CPU 推理对大型模型来说较慢。尝试更小的模型（3B–7B）或针对 CPU 优化的模型
- 在 Apple Silicon 上，Ollama 使用 Neural Engine — 性能远优于 x86 CPU

**远程 Agent 无法访问本地 Ollama**

如果 Stoa Agent 运行在与 Ollama 不同的机器上，Agent 需要能够访问 Ollama 的路由。可选方案：
- 在与 Agent 相同的机器上运行 Ollama
- 使用 `OLLAMA_HOST=0.0.0.0 ollama serve` 将 Ollama 暴露在所有网络接口上，然后使用该机器的 IP
- 使用 Tailscale — 将两台机器加入同一个 Tailscale 网络，然后使用 Tailscale IP
