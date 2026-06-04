# Stoa AutomationのためのSlack設定

StoaはSocket Modeを使ってSlackに接続します — アウトバウンドWebSocket接続です。公開URLやポートの開放は不要です。

2つのトークンが必要です：**App Token**（WebSocket接続用）と**User Token**（チャンネルのイベント受信用）。

---

## ステップ1 — Slack Appを作成する

1. [https://api.slack.com/apps](https://api.slack.com/apps) を開き、**Create New App** をクリック
2. **From scratch** を選択
3. App名（例：`Stoa`）を入力し、ワークスペースを選択
4. **Create App** をクリック

---

## ステップ2 — Socket Modeを有効にする

1. 左サイドバーで **Socket Mode** をクリック
2. **Enable Socket Mode** を **On** に切り替え
3. ダイアログでトークン名（例：`stoa-listener`）を入力
4. `connections:write` スコープは自動追加されます — **Generate** をクリック
5. `xapp-1-` で始まるトークンをコピー — これが **App Token** です

---

## ステップ3 — User Token Scopeを追加する

1. 左サイドバーで **OAuth & Permissions** をクリック
2. **User Token Scopes** セクションまでスクロール（Bot Token Scopesではありません）
3. 以下のスコープを追加：
   - `channels:history` — パブリックチャンネルのメッセージを読む
   - `channels:read` — チャンネル情報を読む
   - `groups:history` — **プライベートチャンネル**のメッセージを読む
   - `im:history` — ダイレクトメッセージを読む

---

## ステップ4 — ユーザーイベントを購読する

1. 左サイドバーで **Event Subscriptions** をクリック
2. **Enable Events** を **On** に切り替え
3. **Subscribe to events on behalf of users** までスクロール（"bot events"ではありません）
4. **Add Workspace Event** をクリックして以下を追加：
   - `message.channels` — 参加中のパブリックチャンネルのメッセージ
   - `message.groups` — 参加中の**プライベートチャンネル**のメッセージ
   - `message.im` — 受信したダイレクトメッセージ
5. **Save Changes** をクリック

---

## ステップ5 — Appをインストールする

1. 左サイドバーで **Install App** をクリック
2. **Install to Workspace**（既にインストール済みの場合は **Reinstall**）をクリック
3. 権限を承認
4. `xoxp-` で始まる **User OAuth Token** をコピー

---

## ステップ6 — Botのチャンネル招待は不要

User Tokenを使う場合、Botをチャンネルに招待する必要はありません — あなた（ユーザー）がすでに参加しているチャンネルから直接イベントが届きます。

---

## ステップ7 — Stoaで接続する

1. Stoa → **Settings → automation** を開く
2. **Connect Slack** をクリック
3. **App Token**（`xapp-1-...`）と **User Token**（`xoxp-...`）を貼り付け
4. **Connect** をクリック — Stoaが接続を確認します

接続後、Slackイベントをトリガーとするオートメーションルールを追加できます。

---

## 注意：権限変更後は再インストールが必要

User Token Scopeを追加・変更するたびに、Slackは再インストールを要求します。**Install App** ページで **Reinstall to Workspace** をクリックして承認してください。User Tokenは変わりません；権限のみが更新されます。
