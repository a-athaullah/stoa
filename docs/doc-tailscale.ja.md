# Tailscale でパブリック URL を取得する

Stoa はローカルネットワーク上で動作します。他のマシン上のエージェントや、スマートフォンから接続するには、Stoa サーバーに到達可能なアドレスが必要です。**Tailscale** はこれを実現する最も簡単な方法です。すべてのデバイスにわたるプライベートメッシュ VPN を作成し、各デバイスに `100.x.x.x` 範囲の安定した IP を付与します。

---

## Tailscale とは？

Tailscale は、ノートパソコン、サーバー、スマートフォンなど、すべてのデバイスを物理的な場所に関係なく同じローカルネットワーク上にあるかのように動作させます。ポートフォワーディング、パブリック IP、ファイアウォールルールは不要です。

---

## 1. サーバーに Tailscale をインストール（Stoa が動作しているマシン）

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

ブラウザウィンドウまたはログイン URL が表示されます — そこでサインインを完了してください。

### Windows

[tailscale.com/download](https://tailscale.com/download) からインストーラーをダウンロードして実行します。インストール後、システムトレイの Tailscale アイコン → **ログイン**をクリックします。

### macOS

```bash
brew install --cask tailscale
```

または App Store からインストール。アプリを開いて → **ログイン**。

---

## 2. サーバーの Tailscale IP を確認

サインイン後、このマシンの Tailscale IP を取得します：

### Linux / macOS

```bash
tailscale ip -4
# 例: 100.x.x.x
```

### Windows（PowerShell）

```powershell
(Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4).IPAddress
# 例: 100.x.x.x
```

または [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) を開くと、すべてのマシンとその IP が一覧表示されます。

---

## 3. Stoa でパブリック URL を設定

2つの方法があります：

**環境変数で設定** — Stoa プロジェクトルートの `.env` ファイルに追加：

```
STOA_PUBLIC_URL=http://100.x.x.x:3001
```

`100.x.x.x` をお使いのマシンの Tailscale IP に置き換えてください。

**設定 UI で設定** — ブラウザで Stoa を開き → **設定 → サーバー → パブリック URL** に URL を入力して **保存**をクリック。この値はデータベースに保存され、環境変数よりも優先されます。

---

## 4. スマートフォンに Tailscale をインストール

### Android

[Google Play ストア](https://play.google.com/store/apps/details?id=com.tailscale.ipn)からダウンロードするか、[tailscale.com/download](https://tailscale.com/download) から直接ダウンロードします。

### iOS / iPhone

[App Store](https://apps.apple.com/app/tailscale/id1470499037) からダウンロードします。

スマートフォンにインストール後：
1. Tailscale アプリを開き → サーバーと同じアカウントで**サインイン**
2. VPN を有効にする — スマートフォンからサーバーの `100.x.x.x` IP にアクセスできるようになります

スマートフォンのブラウザを開き → `http://100.x.x.x:3001`（サーバーの Tailscale IP）を入力 → Stoa が読み込まれます。

---

## 5. 別のマシンからエージェントをインストール

対象マシンで Tailscale を実行した状態で、**Settings → AI Agent → Add Agent**に表示されるインストールコマンドを実行します：

```bash
# Linux / macOS
curl -fsSL http://100.x.x.x:3001/install.sh | bash

# Windows（PowerShell）
irm http://100.x.x.x:3001/install.ps1 | iex
```

エージェントはサーバーに登録され、自動的に接続されます。

---

## 補足

- Tailscale IP は安定しています — Tailscale ネットワークからマシンを削除しない限り変更されません。
- Tailscale デバイス間のすべてのトラフィックはエンドツーエンドで暗号化されます。
- 個人利用は無料：最大3ユーザー、100デバイスまで。
