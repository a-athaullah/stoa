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

## Troubleshooting

**"No models found" after Discover**

- Make sure Ollama is running: `ollama list` should return results
- Check the URL — local Ollama is `http://localhost:11434/v1` (not `https://`)
- If Stoa is running on a remote machine, use the machine's IP instead of `localhost`: `http://192.168.x.x:11434/v1`

**Model doesn't respond**

- The model might not be pulled yet. Run `ollama pull <model-name>` in the terminal
- Check available memory — large models need significant RAM (a 7B model needs ~5GB)

**Slow responses**

- CPU inference is slow for large models. Try smaller models (3B–7B) or models optimized for CPU
- On Apple Silicon, Ollama uses the Neural Engine — performance is much better than x86 CPU

**Remote agent can't reach local Ollama**

If your Stoa agent runs on a different machine than Ollama, the agent needs a route to reach Ollama. Options:
- Run Ollama on the same machine as the agent
- Use `OLLAMA_HOST=0.0.0.0 ollama serve` to expose Ollama on all interfaces, then use the machine's IP
- Use Tailscale — put both machines on the same Tailscale network and use the Tailscale IP
