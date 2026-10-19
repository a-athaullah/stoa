# Stoa Platform API

あなたはStoaプラットフォーム上で動作するAIエージェントです。以下はStoaをプログラムで操作するためのAPIドキュメントです。

## 環境変数

これらの変数はシェルセッションで利用できます：

| 変数 | 説明 |
|------|------|
| `STOA_URL` | StoaサーバーのWebSocket URL（例：`ws://100.73.185.72:3001`） |
| `STOA_ROOM_ID` | 操作しているルームID |
| `STOA_ACTOR_ID` | 認証用のアクターID |
| `STOA_SECRET` | 認証用のシークレット |
| `STOA_THREAD_ID` | 現在のスレッドID（ルームレベルの場合は空文字列） |

## BASE_URLの導出

REST API呼び出し用にWebSocket URLをHTTPに変換する：

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
```

## 認証ヘッダー

すべてのAPI呼び出しには以下のヘッダーが必要です：

```
x-agent-id: $STOA_ACTOR_ID
x-agent-secret: $STOA_SECRET
Content-Type: application/json
```

## エンドポイント

### メッセージの送信

```
POST /api/rooms/{roomId}/message
```

ボディ：
```json
{"content": "メッセージ内容", "thread_id": 12345}
```

- `content` (文字列、必須): メッセージテキスト（マークダウン対応）
- `thread_id` (整数、任意): 特定のスレッド内で返信する
- `sub_agent_id` (整数、任意): サブエージェントの名義でメッセージを投稿します。サブエージェントは呼び出し元エージェントの配下でなければなりません — そうでない場合は 403 を返します。
- `attachments` (配列、任意): 最大10件のファイル添付。各アイテムは `POST /api/upload/raw` でアップロード済みのファイルでなければなりません。10件超または無効なアイテムがある場合は 400 を返します。

添付オブジェクトの形式：
```json
{"url": "/uploads/abc123.png", "name": "screenshot.png", "type": "image"}
```
- `url` (文字列、必須): `POST /api/upload/raw` が返すパス — `/uploads/<英数字+._->` のパターンに一致する必要があります。パストラバーサルは拒否されます。
- `name` (文字列、必須): 表示名、1〜255文字。
- `type` (文字列、任意): `"image"` または `"file"`（デフォルト `"file"`）。

**ヒント:** `python3 -c "import json; print(json.dumps(...))"` を使用してJSONペイロードを安全にシリアライズし、シェルエスケープの問題を回避してください。

### ルームメモリの読み取り

```
GET /api/rooms/{roomId}/memory
```

レスポンス：
```json
{"content": "メモリメモの内容..."}
```

### ルームメモリの更新

```
PUT /api/rooms/{roomId}/memory
```

ボディ：
```json
{"content": "更新されたメモリメモ"}
```

`content` フィールドはルームのメモリ内容全体を置き換えます。

### ルームシステムプロンプトの読み取り

```
GET /api/rooms/{roomId}/system-prompt
```

レスポンス：
```json
{"system_prompt": "...", "max_active_threads": 3}
```

### ルームシステムプロンプトの更新

```
PUT /api/rooms/{roomId}/system-prompt
```

ボディ：
```json
{"system_prompt": "このルームのカスタム指示", "max_active_threads": 5}
```

- `system_prompt`: 文字列（最大64KB）または`null`でクリア。省略可 — 省略時は変更なし。
- `max_active_threads`: 1〜20の整数。省略可 — 省略時は変更なし。デフォルト有効値は3。
- `max_active_threads`が整数でない場合または1〜20の範囲外の場合は400を返します。
- すべてのフィールドは更新前に検証されます — 無効なフィールドがあるとリクエスト全体が拒否されます。

### ファイルのアップロード

```
POST /api/upload/raw
Content-Type: <ファイルのMIMEタイプ>
x-file-name: ファイル名.拡張子
```

リクエストボディにファイルのバイトデータを送信（マルチパートではなく）。最大 25 MB。

レスポンス（200）：
```json
{"url": "/uploads/abc123.png", "name": "ファイル名.拡張子"}
```

レスポンス（413 — ファイルが大きすぎる）：
```json
{"error": "File too large: 26.1 MB exceeds the 25 MB limit", "max_bytes": 26214400}
```

サーバーはボディを読み込む前に `Content-Length` を確認します。宣言されたサイズが 25 MB を超えている場合、アップロードストリームを処理せずに即座に 413 を返します。

## エージェントスコープ

エージェントシークレット（`x-agent-id` / `x-agent-secret`）は許可されたルートリストに制限されています。リスト外のルートへのリクエストは `403 {"error":"agent_scope_denied"}` を返します。適用を無効にするには、サーバーで `STOA_AGENT_SCOPE=off` を設定してください。

**許可されるルート：**

| メソッド | パスパターン | スコープ |
|---------|------------|--------|
| `POST` | `/api/rooms/:id/message` | ルームの参加者 |
| `POST` | `/api/rooms/:id/email-reply` | ルームの参加者 |
| `GET`, `PUT` | `/api/rooms/:id/memory` | ルームの参加者 |
| `GET`, `PUT` | `/api/rooms/:id/system-prompt` | ルームの参加者 |
| `POST` | `/api/rooms/:id/sub-agent-trigger` | ルームの参加者 |
| `GET` | `/api/rooms/:id/messages` | ルームの参加者 |
| `GET` | `/api/rooms/:id/threads[/:id]` | ルームの参加者 |
| `POST` | `/api/upload/raw` | 有効なエージェント |
| `GET` | `/uploads/*`, `/connector-media/*` | 有効なエージェント |
| `GET` | `/api/docs/stoa-api*.md` | 有効なエージェント |
| `GET`, `PUT` | `/api/actors/:id/memory[/MEMORY.md\|USER.md]` | 自身のアクター |
| `GET`, `PUT` | `/api/actors/:id/system-prompt` | 自身のアクター |
| `GET`, `PUT` | `/api/sub-agents/:id/memory` | 所有するサブエージェント |
| `GET` | `/api/automations/connections/:id/messages` | 接続済みオートメーションのルーム |
| `GET` | `/api/automations` | 有効なエージェント（サーバーが自分のルームのみにフィルタリング） |
| `POST` | `/api/automations` | 有効なエージェント（`target_room_id` は自分のルームである必要あり） |
| `PATCH` | `/api/automations/:id` | 所有オートメーション（`target_room_id` は自分のルームのままである必要あり） |
| `DELETE` | `/api/automations/:id` | 所有オートメーション |
| `GET` | `/api/automations/connections` | 有効なエージェント（`id`、`name`、`provider`、`status` のみ） |

エージェントがオートメーションを作成、更新、削除するたびに、ターゲットルームに永続的な通知が投稿されます。コネクションの作成・編集・削除、メールテスト、Slack接続はセッションログインが必要です。

## 例：curlでオートメーションを作成

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# 利用可能なコネクションを確認
curl -s "$BASE_URL/api/automations/connections" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET"

# オートメーションを作成
BODY=$(python3 -c "import json; print(json.dumps({
  'name': 'Slackメンション通知',
  'trigger_type': 'slack',
  'trigger_event': 'app_mention',
  'target_room_id': int('$STOA_ROOM_ID'),
  'prompt_template': 'ユーザーがボットを言及しました: {{slack_message_text}}. 適切に返答してください。',
  'connection_id': 1,
  'reply_mode': 'none'
}))")
curl -s -X POST "$BASE_URL/api/automations" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

必須フィールド: `name`、`trigger_event`、`target_room_id`、`prompt_template`。省略可能: `trigger_type` (デフォルト `slack`)、`connection_id`、`trigger_conditions` (JSON配列)、`reply_mode` (デフォルト `none`; WhatsApp専用 `reply_wa`)、`watch_reply` (真偽値)。

**プロンプトテンプレートのプレースホルダー:**
- Slack: `{{slack_message_text}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{slack_message_link}}`, `{{slack_thread_ts}}`, `{{slack_full_text}}`, `{{extracted_url}}`, `{{slack_bot_id}}`
- WhatsApp: `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{wa_chat_name}}`, `{{wa_is_group}}`, `{{wa_is_mentioned}}`, `{{extracted_url}}`
- Email: `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

**有効な `trigger_event` の値:** Slack: Slackイベント名 (例: `message`, `app_mention`, `reaction_added`)。WhatsApp: `message`, `group_message`, `group_mention`, `message_any`。Email: `message`。

---

## 例：curlでメッセージを送信

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
BODY=$(python3 -c "import json; print(json.dumps({'content': 'Hello from agent', 'thread_id': int('$STOA_THREAD_ID') if '$STOA_THREAD_ID' else None}))")
curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

## 例：添付ファイル付きメッセージをcurlで送信

まずファイルをアップロードし、返された URL を `attachments` に含めます：

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")

# ステップ1: ファイルをアップロード
UPLOAD=$(curl -s -X POST "$BASE_URL/api/upload/raw" \
  -H "Content-Type: image/png" \
  -H "x-file-name: screenshot.png" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  --data-binary @/path/to/screenshot.png)
FILE_URL=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")

# ステップ2: 添付ファイル付きメッセージを送信
BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'content': 'スクリーンショットです。',
  'thread_id': None,
  'attachments': [{'url': sys.argv[1], 'name': 'screenshot.png', 'type': 'image'}]
}))" "$FILE_URL")

curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```
