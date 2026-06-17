# Ollamaセットアップガイド

Stoaは**Ollama**をAIモデルプロバイダーとしてサポートしています — ホスト型クラウドサービスと自分のマシンへのローカルインストールの両方に対応しています。このガイドでは両方のオプションとその設定方法を説明します。

---

## Ollamaとは？

[Ollama](https://ollama.com)は大規模言語モデルを実行するためのオープンソースツールです。OpenAI互換のHTTP APIを提供しているため、Stoaは特別なアダプターなしに接続できます — URLを指定するだけで動作します。

OllamaはLlama、Qwen、Mistral、Gemma、DeepSeekなど、多数のオープンソースモデルライブラリへのアクセスを提供します。これらの一部はOllama Cloudのホスト型サービスでも利用可能です。

---

## Ollama Cloud vs ローカルOllama

| | Ollama Cloud | ローカルOllama |
|---|---|---|
| **URL** | `http://localhost:11434/v1`（ローカルデーモン経由） | `http://localhost:11434/v1` |
| **ローカルインストール** | 必要 — Ollama CLI が必要 | 必要 |
| **インターネット接続** | 必要 | 不要（モデルダウンロード後） |
| **コスト** | 無料枠 + 有料 | 無料（電気代 + ハードウェア） |
| **モデルサイズ** | 480B+パラメーターまで | RAM/VRAMに依存 |
| **プライバシー** | プロンプトがOllamaサーバーに送信される | マシン上に留まる |
| **速度** | サーバー負荷に依存 | ハードウェアに依存 |
| **最適な用途** | ローカルGPUなしで大型モデルを使用 | 機密データ、オフライン使用、APIコスト不要 |

### Ollama Cloudを使う場合

- ローカルGPUなしで非常に大きなモデル（70B、235B、480B）を実行したい
- 実験中でローカルインフラの管理を避けたい
- サーバーからの速度が許容範囲内

### ローカルOllamaを使う場合

- プロンプトに機密コード、個人データ、または機密情報が含まれている
- APIコストをゼロにしたい（何度でもメッセージを送信できる、無料）
- オフラインまたは制限されたネットワーク環境で作業している
- Apple Silicon MacまたはGPUを持っている — 推論が高速
- ネットワーク変動のない確定的で再現可能な応答が欲しい

---

## ローカルOllamaのインストール

### macOS

**オプション1 — デスクトップアプリ（推奨）:**

[ollama.com/download](https://ollama.com/download)からダウンロードします。macOSアプリはOllamaをメニューバーアプリとしてインストールし、ログイン時に自動起動します。

**オプション2 — Homebrew:**

```bash
brew install ollama
```

サーバーを起動:
```bash
ollama serve
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

インストーラーが`systemd`サービスを設定します。Ollamaは自動的に起動し、ポート11434でリッスンします。

### Windows

[ollama.com/download/windows](https://ollama.com/download/windows)からインストーラーをダウンロードします。インストール後はバックグラウンドサービスとして実行されます。

---

## モデルの取得

Ollamaをインストールしたら、使用したいモデルを取得します。ターミナルを開きます:

```bash
# 高速で優秀な7Bモデル — 始めるのに最適
ollama pull qwen2.5-coder:7b

# 汎用、優れた推論能力
ollama pull llama3.2

# コンパクト、CPUで非常に高速
ollama pull qwen2.5:3b

# より大きく、高品質（~8GB RAMが必要）
ollama pull llama3.1:8b
```

利用可能なモデルは[ollama.com/library](https://ollama.com/library)で確認できます。

ダウンロード済みのモデル一覧を表示:
```bash
ollama list
```

> **重要:** Stoaは**ツール呼び出し（tool calling）**をサポートするモデルが必要です。ツールをサポートしないモデルはディスカバリー時に自動的に除外されます。Ollamaライブラリページでモデルの機能を確認してください — 「Tools」タグを探してください。最近のほとんどのモデル（Qwen 2.5+、Llama 3.1+、Mistral、Gemma 4）はツールをサポートしています。

---

## ローカルOllamaをStoaに追加

1. **Settings > Platforms**に移動
2. **+ add platform**をクリック
3. 入力:
   - **Name**: `Local Ollama`（または好みのラベル）
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: 空白のまま（ローカルOllamaには不要）
4. **Save**をクリック
5. **Discover Models**をクリック — Stoaが利用可能な各モデルを調べ、ビジョン（画像入力）をサポートするものを検出します
6. モデル一覧で、ルームセレクターで使用したいモデルにチェックを入れる
7. **Save Selection**をクリック

ローカルモデルがコンポーザーのモデルドロップダウンに表示され、プラットフォーム名でグループ化されます。

---

## Ollama CloudをStoaに追加

Ollama Cloudはローカルのollamaデーモンを通じてリクエストをルーティングします — あなたのマシンがOllamaのサーバーにプロンプトを転送します。つまり、クラウドモデルへのアクセスにも**Ollama CLIのインストールと認証が必要**です。

### ステップ 1 — Ollama CLIをインストール

上記の[ローカルOllamaのインストール](#ローカルollamaのインストール)セクションに従ってください。デーモンが起動している必要があります。

### ステップ 2 — Ollamaアカウントにログイン

```bash
ollama login
```

プロンプトに従ってOllamaアカウントで認証します。これにより、デーモンがアクセス可能なクラウドモデルへのリクエストをルーティングできるようになります。

### ステップ 3 — StoaにプラットフォームでOllamaを追加

1. [ollama.com](https://ollama.com)でサインアップし、アカウント設定からAPIキーを取得
2. **Settings > Platforms > + add platform**に移動
3. 入力:
   - **Name**: `Ollama Cloud`
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: OllamaのAPIキー
4. **Save**、次に**Discover Models**をクリック
5. 使用したいモデルを選択し、**Save Selection**をクリック

---

## 複数マシン間でのOllama共有（マルチエージェント設定）

デフォルトでは、Ollamaは`127.0.0.1`（localhost）のみでリッスンします。異なるマシンで動作する複数のStoaエージェントが同じOllamaインスタンスを使用するには、OllamaをネットワークからアクセスできるようにするOllamaを設定する必要があります。

これは、**Tailscale IP**（例：`http://100.x.x.x:11434/v1`）経由でOllamaにアクセスする場合にも必要です。Tailscaleインターフェースは独立したネットワークインターフェースとして扱われるため、自分のマシンからアクセスする場合でも同様です。

### ステップ 1 — Ollamaがすべてのインターフェースでリッスンできるようにする

**macOS (Ollama.app):**

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
```

次にOllamaを再起動します：メニューバーから終了し、再度開いてください。

> この設定は次回の再起動まで有効です。永続的にするには、シェル設定に追加してターミナルからOllamaを再起動してください：
> ```bash
> echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.zshrc
> source ~/.zshrc
> ollama serve
> ```

**macOS (Homebrew / CLI):**

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

または`~/.zshrc`に`export OLLAMA_HOST=0.0.0.0`を追加し、ターミナルから`ollama serve`を実行してください。

**Linux (systemd):**

```bash
sudo systemctl edit ollama
```

以下を追加：
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

次に：
```bash
sudo systemctl restart ollama
```

### ステップ 2 — StoaでOllamaに接続するURLを設定する

Ollamaがすべてのインターフェースでリッスンするようになったら、次のいずれかを使用します：
- **LAN IP**: `http://192.168.x.x:11434/v1`
- **Tailscale IP**: `http://100.x.x.x:11434/v1`

Stoa内の各エージェントはこのURLを使用するよう設定できます — 同じTailscaleネットワーク内のどのマシンのエージェントも、同じOllamaインスタンスを共有できます。

### 接続の確認

Ollamaに到達できるはずのマシンから：

```bash
curl http://<ollama-machine-ip>:11434/api/tags
```

モデルの一覧が返ってきたら、接続は成功しており、Stoaはそのアドレスからモデルを検出できます。

---

## トラブルシューティング

**Discoverの後に「No models found」と表示される**

- Ollamaが起動していることを確認してください：`ollama list`が結果を返すはずです
- URLを確認してください — ローカルのOllamaは`http://localhost:11434/v1`です（`https://`ではありません）
- Tailscale IP経由でアクセスしていますか？上記の[マルチエージェント設定](#複数マシン間でのollama共有マルチエージェント設定)セクションを参照してください — まず`OLLAMA_HOST=0.0.0.0`の設定が必要です

**Discoverの後に「N個中0個がusable」と表示される（モデルは一覧にあるが使用不可）**

- **Ollama Cloud**の場合：デーモンが認証されていません。ターミナルで`ollama login`を実行し、再度Discover Modelsをクリックしてください。
- Stoaはサブスクリプションティアで各モデルが使用可能かどうかを確認するために、テストリクエストを送信してプローブします。認証なしではすべてのプローブが失敗し、モデルが「not usable」と表示されます。
- ログイン後は何も再起動する必要はありません — Discover Modelsを再実行するだけです。

**ディスカバリー後にモデルが表示されない（pullはされている）**

- そのモデルはStoaが必要とする**ツール呼び出し**をサポートしていない可能性があります。ツールをサポートするモデルのみが表示されます。ツール対応モデルを試してください（例：`qwen2.5-coder:7b`、`llama3.1:8b`、`gemma4:12b`）。

**モデルが応答しない**

- モデルがまだpullされていない可能性があります。ターミナルで`ollama pull <model-name>`を実行してください
- 使用可能なメモリを確認してください — 大きなモデルには相当なRAMが必要です（7Bモデルには約5GBが必要）

**応答が遅い**

- 大きなモデルではCPU推論は遅くなります。小さいモデル（3B〜7B）またはCPU向けに最適化されたモデルを試してください
- Apple Siliconでは、OllamaはNeural Engineを使用します — x86 CPUよりもパフォーマンスが大幅に向上します
