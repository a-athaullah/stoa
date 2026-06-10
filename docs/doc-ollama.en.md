# Ollama Setup Guide

Stoa supports **Ollama** as an AI model provider — both the hosted cloud service and a local installation on your own machine. This guide explains both options and how to set them up.

---

## What is Ollama?

[Ollama](https://ollama.com) is an open-source tool for running large language models. It serves an OpenAI-compatible HTTP API, which means Stoa can talk to it without any special adapter — you just point Stoa at the URL and it works.

Ollama gives you access to a large library of open-source models: Llama, Qwen, Mistral, Gemma, DeepSeek, and more. Some of these are also available via the Ollama Cloud hosted service.

---

## Ollama Cloud vs Local Ollama

| | Ollama Cloud | Local Ollama |
|---|---|---|
| **URL** | `https://ollama.com/v1` | `http://localhost:11434/v1` |
| **Requires local install** | No | Yes |
| **Requires internet** | Yes | No (after model download) |
| **Cost** | Free tier + paid | Free (electricity + hardware) |
| **Model size** | Up to 480B+ parameters | Limited by your RAM/VRAM |
| **Privacy** | Prompts go to Ollama servers | Stays on your machine |
| **Speed** | Depends on server load | Depends on your hardware |
| **Best for** | Large models without local GPU | Sensitive data, offline use, no API costs |

### When to use Ollama Cloud

- You want to run very large models (70B, 235B, 480B) without owning a GPU
- You're experimenting and don't want to manage local infrastructure
- Speed is acceptable from their servers

### When to use Local Ollama

- Your prompts contain sensitive code, personal data, or confidential information
- You want zero API cost (run as many messages as you want, free)
- You work offline or on a restricted network
- You have an Apple Silicon Mac or a GPU — inference is fast
- You want deterministic, reproducible responses without network variability

---

## Installing Local Ollama

### macOS

**Option 1 — Desktop app (recommended):**

Download from [ollama.com/download](https://ollama.com/download). The macOS app installs Ollama as a menu bar app and starts automatically on login.

**Option 2 — Homebrew:**

```bash
brew install ollama
```

Start the server:
```bash
ollama serve
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

The installer sets up a `systemd` service. Ollama starts automatically and listens on port 11434.

### Windows

Download the installer from [ollama.com/download/windows](https://ollama.com/download/windows). It runs as a background service after installation.

---

## Pulling Models

After Ollama is installed, pull the models you want to use. Open a terminal:

```bash
# A fast, capable 7B model — good starting point
ollama pull qwen2.5-coder:7b

# General purpose, good reasoning
ollama pull llama3.2

# Compact, very fast on CPU
ollama pull qwen2.5:3b

# Larger, higher quality (needs ~8GB RAM)
ollama pull llama3.1:8b
```

Browse available models at [ollama.com/library](https://ollama.com/library).

To list models already downloaded:
```bash
ollama list
```

---

## Adding Local Ollama to Stoa

1. Go to **Settings > Platforms**
2. Click **+ add platform**
3. Fill in:
   - **Name**: `Local Ollama` (or any label you prefer)
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: leave empty (local Ollama doesn't require one)
4. Click **Save**
5. Click **Discover Models** — Stoa probes each available model and detects which ones support vision (image input)
6. In the model list, check the models you want available in the room selector
7. Click **Save Selection**

Your local models now appear in the model dropdown in the composer, grouped under your platform name.

---

## Adding Ollama Cloud to Stoa

1. Sign up at [ollama.com](https://ollama.com) and get an API key from your account settings
2. Go to **Settings > Platforms > + add platform**
3. Fill in:
   - **Name**: `Ollama Cloud`
   - **Base URL**: `https://ollama.com/v1`
   - **API Key**: your Ollama API key
4. Click **Save**, then **Discover Models**
5. Select the models you want and click **Save Selection**

---

## Sharing Ollama Across Multiple Machines (Multi-Agent Setup)

By default, Ollama only listens on `127.0.0.1` (localhost). If you want multiple Stoa agents — running on different machines — to all use the same Ollama instance, you need to make Ollama accessible on the network.

This is also needed if you access Ollama via a **Tailscale IP** (e.g. `http://100.x.x.x:11434/v1`) even from your own machine, because the Tailscale interface is treated as a separate network interface.

### Step 1 — Allow Ollama to listen on all interfaces

**macOS (Ollama.app):**

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
```

Then restart Ollama: quit from the menu bar and reopen it.

> This setting persists until the next reboot. To make it permanent, add it to your shell config and restart Ollama from the terminal:
> ```bash
> echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.zshrc
> source ~/.zshrc
> ollama serve
> ```

**macOS (Homebrew / CLI):**

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

Or add `export OLLAMA_HOST=0.0.0.0` to `~/.zshrc` and run `ollama serve` from the terminal.

**Linux (systemd):**

```bash
sudo systemctl edit ollama
```

Add:
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

Then:
```bash
sudo systemctl restart ollama
```

### Step 2 — Use the correct URL in Stoa

Once Ollama listens on all interfaces, use either:
- **LAN IP**: `http://192.168.x.x:11434/v1`
- **Tailscale IP**: `http://100.x.x.x:11434/v1`

Each agent in Stoa can be configured to use this URL — agents on any machine in the same Tailscale network can then share the same Ollama instance.

### Verify the connection

From any machine that should reach Ollama:

```bash
curl http://<ollama-machine-ip>:11434/api/tags
```

If it returns a list of models, the connection works and Stoa will be able to discover models from that address.

---

## Troubleshooting

**"No models found" after Discover**

- Make sure Ollama is running: `ollama list` should return results
- Check the URL — local Ollama is `http://localhost:11434/v1` (not `https://`)
- Accessing via Tailscale IP? See the [Multi-Agent Setup](#sharing-ollama-across-multiple-machines-multi-agent-setup) section above — Ollama needs `OLLAMA_HOST=0.0.0.0` first

**Model doesn't respond**

- The model might not be pulled yet. Run `ollama pull <model-name>` in the terminal
- Check available memory — large models need significant RAM (a 7B model needs ~5GB)

**Slow responses**

- CPU inference is slow for large models. Try smaller models (3B–7B) or models optimized for CPU
- On Apple Silicon, Ollama uses the Neural Engine — performance is much better than x86 CPU
