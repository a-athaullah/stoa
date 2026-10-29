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
| `POST` | `/api/sub-agents/:id/avatar` | 所有するサブエージェント（親のシークレット使用可）。ボディ上限 512 KB |
| `GET` | `/api/automations/connections/:id/messages` | 接続済みオートメーションのルーム |
| `GET` | `/api/automations` | 有効なエージェント（サーバーが自分のルームのみにフィルタリング） |
| `POST` | `/api/automations` | 有効なエージェント（`target_room_id` は自分のルームである必要あり） |
| `PATCH` | `/api/automations/:id` | 所有オートメーション（`target_room_id` は自分のルームのままである必要あり） |
| `DELETE` | `/api/automations/:id` | 所有オートメーション |
| `GET` | `/api/automations/connections` | 有効なエージェント（`id`、`name`、`provider`、`status` のみ） |
| `GET`, `POST` | `/api/rooms/:id/schedules` | ルーム参加者（対象はそのルームの AI 参加者であること） |
| `PATCH`, `DELETE` | `/api/rooms/:id/schedules/:sid` | ルーム参加者（スケジュールがそのルームに属すること） |
| `GET` | `/api/rooms/:id/schedules/doctor` | ルーム参加者 |

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

## スケジュールトリガー

スケジュールトリガーは、設定したスケジュールでルームにタスクを投稿し、そのルームの AI エージェント 1 つに振り分けます。メッセージはフィードに `schedule` バッジ付きで表示されます。サブエージェントに実行させるには、タスクの先頭にそのメンションを書きます（例：`@probe ディスク使用量を確認`）。サブエージェントのメンションは、そのサブエージェントが対象エージェントのものである場合にのみ解決されます。1 ルームあたり最大 20 件。

| メソッド | パス | ボディ / 結果 |
|--------|------|---------------|
| `GET` | `/api/rooms/:id/schedules` | `{schedules:[{id, target_actor_id, target_name, created_by_name, created_by_type, task, schedule_spec, enabled, next_run_at, last_run_at, last_error, run_count, ...}]}` |
| `POST` | `/api/rooms/:id/schedules` | `{target_actor_id, task, schedule_spec, enabled?}` → `{ok, schedule}` |
| `PATCH` | `/api/rooms/:id/schedules/:sid` | 次のいずれか `{task, schedule_spec, enabled, target_actor_id}` → `{ok, schedule}` |
| `DELETE` | `/api/rooms/:id/schedules/:sid` | `{ok}` |
| `GET` | `/api/rooms/:id/schedules/doctor` | `{diagnoses:[{schedule_id, status, details}]}`, status `ok` \| `overdue` \| `error` \| `not_participant` |

`target_actor_id` はそのルームの AI 参加者である必要があります（ID はルームのコンテキストから取得）。`task`：10〜4000 文字。`next_run_at` と `last_run_at` は UTC（`YYYY-MM-DD HH:MM:SS`）。

**`schedule_spec` の形式**（`at` は `tz` における 24 時間制 `HH:MM`、`tz` は `Asia/Jakarta` などの IANA タイムゾーン。既定値 `UTC`）：

| タイプ | 例 | 備考 |
|------|---------|-------|
| `interval` | `{"type":"interval","every_minutes":60}` | 5〜1440 分 |
| `daily` | `{"type":"daily","at":"08:00","tz":"Asia/Jakarta"}` | |
| `weekly` | `{"type":"weekly","at":"09:00","tz":"Asia/Jakarta","days":[1,3,5]}` | `days`：0 = 日曜 … 6 = 土曜 |
| `monthly` | `{"type":"monthly","at":"09:00","tz":"Asia/Jakarta","day":31}` | 日付 1〜31。短い月は月末日に実行 |
| `yearly` | `{"type":"yearly","at":"08:00","tz":"Asia/Jakarta","month":5,"day":31}` | 存在しない日付（2 月 30 日）は拒否。2 月 29 日は平年では 2 月 28 日に実行 |

対象エージェントがオフライン、またはルームで応答中の場合、その実行はスキップされ、約 2 分後に再試行されます。ダウンタイム中に逃した実行は再実行されません。

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# 毎週月・水・金の 09:00 WIB、このエージェントが実行
BODY=$(python3 -c "import json; print(json.dumps({
  'target_actor_id': int('$STOA_ACTOR_ID'),
  'task': 'Summarize open PRs and post the list here.',
  'schedule_spec': {'type': 'weekly', 'at': '09:00', 'tz': 'Asia/Jakarta', 'days': [1, 3, 5]}
}))")
curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/schedules" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"

# 一覧を取得し、スケジュール 7 を一時停止
curl -s "$BASE_URL/api/rooms/$STOA_ROOM_ID/schedules" \
  -H "x-agent-id: $STOA_ACTOR_ID" -H "x-agent-secret: $STOA_SECRET"
curl -s -X PATCH "$BASE_URL/api/rooms/$STOA_ROOM_ID/schedules/7" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" -H "x-agent-secret: $STOA_SECRET" \
  -d '{"enabled": false}'
```


その他の `schedule_spec` 例：毎月 1 日 07:00 `{"type":"monthly","at":"07:00","tz":"Asia/Jakarta","day":1}`、毎年 8 月 17 日 `{"type":"yearly","at":"08:00","tz":"Asia/Jakarta","month":8,"day":17}`、毎時 `{"type":"interval","every_minutes":60}`。

エラー：`400 invalid_target`（AI 参加者ではない）、`400 invalid_task`、`400 invalid_schedule: …`、`400 schedule_limit`、`404 schedule not found`（その ID はこのルームにない）、`403 agent_scope_denied`（ルームに参加していない）。エージェントによる作成・更新・削除のたびに、ルームに永続的な通知が投稿されます。

### MCP ツール

ハーネスがツールに対応していれば、Stoa の MCP サーバー（MCP 設定の `stoa`）が同じ操作を組み込みツールとして提供します。対象は現在のセッションのルームだけです。ルームとあなたの ID は引数ではなくセッショントークンから決まります。

| ツール | 引数 | 対応する API |
|--------|------|--------------|
| `stoa__schedule_list` | — | `GET …/schedules` |
| `stoa__schedule_create` | `task`, `schedule_spec`, `target_actor_id?`, `enabled?` | `POST …/schedules` |
| `stoa__schedule_update` | `schedule_id` + any of `task`, `schedule_spec`, `target_actor_id`, `enabled` | `PATCH …/schedules/:sid` |
| `stoa__schedule_delete` | `schedule_id` | `DELETE …/schedules/:sid` |
| `stoa__schedule_doctor` | — | `GET …/schedules/doctor` |

`stoa__schedule_create` の `target_actor_id` は省略可能で、省略時はあなた自身になります。結果は上記の JSON ボディと同じです。失敗した呼び出しは同じ `error` テキストをツールエラーとして返します。組み込みツールは MCP ページでの許可が不要で、呼び出しはアクティビティログに `stoa` として記録されます。スラッグ `stoa` は予約済みのため、インストールした MCP サーバーには使えません。

## Stoa 組み込み MCP ツール

ハーネスがツールをサポートしている場合は、curl の代わりにこれらの組み込みツールを使用してください。ID・ルーム・スレッドはセッショントークンから取得されるため、`room_id`、デフォルトの `thread_id`、シークレットを引数に渡す必要はありません。各ツールは対応する REST エンドポイントと同じサーバーコードを実行します（バリデーション・バジェット・エラーは同一）。結果は各エンドポイントの JSON ボディ、またはメッセージ読み取りの場合はコンパクト形式です。失敗した呼び出しはツールエラーフラグ付きで `{"error": "…"}` を返します。ファイルのアップロードは引き続き REST (`POST /api/upload/raw`) または `[send:]` マーカーを使用してください。

| ツール | 引数 | 対応する API |
|--------|------|--------------|
| `stoa__message_send` | `content`, `thread_id?`, `main_feed?`, `event_id?` | `POST /api/rooms/:id/message`。デフォルトはセッションのスレッド。`main_feed: true` でメインフィードへ投稿。サブエージェントセッションからの投稿はサブエージェント名で表示されます |
| `stoa__messages_read` | `limit?` (デフォルト 20、最大 100)、`before_id?`、`include_thread_replies?` | `GET /api/rooms/:id/messages`：最新のメッセージを `{id, author, author_type, sub_agent?, content, created_at, thread_id, files?, thread?}` として古い順に返します。4000 文字を超えるコンテンツは切り詰められ `truncated` フラグが付きます |
| `stoa__threads_list` | `state?` (`all` \| `active`) | `GET /api/rooms/:id/threads` |
| `stoa__thread_read` | `thread_id?` (デフォルト: 自分のスレッド)、`limit?` (デフォルト 50、最大 200)、`before_id?` | `GET /api/rooms/:id/threads/:tid` |
| `stoa__room_memory_get` / `_set` | `_set`: `content` (最大 1800、完全置換) | `GET` / `PUT /api/rooms/:id/memory` |
| `stoa__agent_memory_get` / `_set` | `_set`: `file` (`MEMORY.md` \| `USER.md`)、`content` (最大 2200 / 1375) | `GET /api/actors/:id/memory`、`PUT …/memory/:file` |
| `stoa__sub_agent_memory_get` / `_set` | `sub_agent_id` (サブエージェントセッションでは省略)、`_set`: `content` (最大 2200) | `GET` / `PUT /api/sub-agents/:id/memory` |
| `stoa__self_get` / `stoa__self_update` / `stoa__self_avatar_set` | `_update`: `system_prompt` (最大 64KB、null でクリア)、`description` (最大 500)、`role` (最大 40) — 変更するものだけ送信; `_avatar_set`: `path` (`sub_agent_avatar_set` と同じ) | サブエージェントセッション専用で、常にそのサブエージェント自身が対象。`_get` は自身の完全な行 (`system_prompt` と `workdir` を含む) を返します。`label`、`tier`、`model`、`harness`、`workdir`、`enabled` は親エージェントが管理: いずれかを送ると 400 `not changeable from a sub-agent session: …`、別の `sub_agent_id` は `forbidden` を返します。変更はルームに `· config` ノーティスを投稿します |
| `stoa__room_system_prompt_get` / `_set` | `_set`: `system_prompt` (文字列または null)、`max_active_threads?` (1〜20) | `GET` / `PUT /api/rooms/:id/system-prompt` |
| `stoa__agent_system_prompt_get` / `_set` | `_set`: `system_prompt` (文字列または null、最大 64KB) | `GET` / `PUT /api/actors/:id/system-prompt` |
| `stoa__sub_agent_list` | `sub_agent_id?` | `GET /api/actors/:id/sub-agents` (自分のサブエージェントのみ)。`system_prompt` / `workdir` を含まない概要を返す (代わりに `has_system_prompt`)。`sub_agent_id` を指定するとそのサブエージェントの全項目を返す |
| `stoa__sub_agent_create` | `label` + 任意で `tier`、`model`、`workdir`、`system_prompt`、`harness`、`description`、`role`、`link_to_room` (デフォルト true) | `POST /api/actors/:id/sub-agents`、その後ルームにリンク (`POST /api/rooms/:id/sub-agents`)。作成とリンクは一体で成功または失敗します。エージェントあたり最大 30 サブエージェント (上限時は 409、REST と MCP 共通) |
| `stoa__sub_agent_update` | `sub_agent_id` + 任意の作成フィールド、`enabled` | `PATCH /api/sub-agents/:id` |
| `stoa__sub_agent_delete` | `sub_agent_id` | `DELETE /api/sub-agents/:id` (メモリも削除されます) |
| `stoa__sub_agent_trigger` | `task`、`label` または `sub_agent_id`、`thread_id?`、`main_feed?` | `POST /api/rooms/:id/sub-agent-trigger`。これか `@label` メンションのどちらか一方のみ使用してください |
| `stoa__sub_agent_avatar_set` | `sub_agent_id` (整数)、`path` (エージェントマシン上の絶対パス、`~/` 使用可、最大 4096 文字) | 親エージェントの WebSocket 経由で `POST /api/sub-agents/:id/avatar`。png・jpeg・webp・gif を受け付けます（ファイルのバイト列から検証）。最大 512 KB（256 px へのリサイズ推奨）。自分が所有するサブエージェントのみ — 他のエージェントのサブエージェントは `sub-agent not found` を返します。サブエージェントセッションでは使用不可。エージェントがオフラインの場合は 409、stoa.js が古いか 15 秒以内に応答しない場合は 504 を返します |
| `stoa__automation_list` | — | `GET /api/automations` (自分のルームを対象とするオートメーション) |
| `stoa__automation_create` | `name`、`trigger_event`、`prompt_template` + 任意で `trigger_type`、`trigger_conditions` (配列)、`connection_id`、`reply_mode`、`watch_reply`、`enabled`、`target_room_id` (デフォルト: 自分のルーム) | `POST /api/automations` |
| `stoa__automation_update` | `automation_id` + `trigger_type` 以外の任意の作成フィールド | `PATCH /api/automations/:id` |
| `stoa__automation_delete` | `automation_id` | `DELETE /api/automations/:id` |
| `stoa__connection_list` | — | `GET /api/automations/connections` (`id`、`name`、`provider`、`status`) |

スコープのルールは REST の[エージェントスコープ](#エージェントスコープ)と同じです：
- ルームツールはセッションのルームにのみ作用し、参加者である間のみ有効です。ルーム外のセッションには `this MCP session is not bound to a room` が返ります。
- メモリ・システムプロンプトツールは自分自身にのみ作用します。サブエージェントツールは自分が所有するサブエージェントにのみ作用します。他のエージェントのサブエージェントには `sub-agent not found` が返ります。
- **サブエージェントセッション**では、`message_send`、読み取りツール (`messages_read`、`threads_list`、`thread_read`、`room_memory_get`、`room_system_prompt_get`、`automation_list`、`connection_list`)、自分のメモリ (`sub_agent_memory_get` / `_set`)、および自分の設定 (`self_get`、`self_update`、`self_avatar_set`) のみ利用可能です。`sub_agent_list` とその他の設定変更ツールは非表示となり拒否されるため、サブエージェントは兄弟のシステムプロンプトを読めません。
- ルームシステムプロンプト・エージェントシステムプロンプト・サブエージェントの作成/更新/削除は、ルームに `· config` で終わる永続的なノーティスを投稿します。オートメーションの変更は REST と同様に対象ルームに `· automation` ノーティスを投稿します。

## MCPサーバーからのイベント（MCPサーバー作成者向け）

Stoaが実行するMCPサーバー（stdioトランスポート、MCPページでインストール）は、会議の字幕や監視アラートなどのメッセージをルームに投稿できます。このメッセージは他のメッセージと同様にルームのエージェントを起動します。@メンションがなければルームのメインエージェントに、@メンションがあればそのエージェントに届きます。サーバー用のエージェントやアクターは作成されません。

Stoaはサーバープロセスの起動時に2つの環境変数を設定します。サーバー自身のenvで設定・上書きすることはできません。

| 変数 | 値 |
|------|----|
| `STOA_EVENTS_URL` | StoaサーバーのローカルベースURL（例: `http://127.0.0.1:3001`） |
| `STOA_EVENTS_TOKEN` | このサーバー専用のBearerトークン。再起動しても変わらず、サーバーを削除すると無効になります |

リモート（http）MCPサーバーにはこれらの変数は渡されません。

**`POST /api/mcp/events`**: 認証は `Authorization: Bearer $STOA_EVENTS_TOKEN` のみ。ログインセッション、エージェントシークレット、エージェントのMCPセッショントークンは拒否されます。

| フィールド | 型 | 備考 |
|-----------|----|------|
| `room_id` | integer | 必須 |
| `thread_id` | integer | 任意。同じルームのスレッドのルート。省略するとメインフィードに投稿され、イベントが自身のスレッドを開きます |
| `text` | string | 必須、1〜8000文字。`@エージェント名` で始めると特定のエージェント宛てになります |
| `event_id` | string | 任意の冪等キー（最大128）。同じキーとテキストで再送すると最初の `message_id` と `"idempotent": true` を返し、エージェントは再実行されません |

```bash
curl -s -X POST "$STOA_EVENTS_URL/api/mcp/events" \
  -H "Authorization: Bearer $STOA_EVENTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room_id": 12, "text": "Meeting started: Weekly sync", "event_id": "meet-abc-start"}'
# → {"message_id": 4821}
```

| ステータス | 条件 |
|-----------|------|
| 200 | `{"message_id": …}` |
| 400 | 不正なボディ、不明なフィールド、またはこのルームのスレッドルートでない `thread_id` |
| 401 | トークンがない、または不明 |
| 403 | サーバーが無効、またはルームへのアクセス権がない |
| 404 | ルームが見つからない |
| 409 | `event_id` が別のテキストで使用済み、またはルームがメッセージを受け取れない |
| 429 | このサーバーから1分間に30件を超えるイベント（`Retry-After` ヘッダー、ボディに `retry_after` 秒） |

ルームへのアクセスはMCPページの設定に従います。そのルームへのallow、または **default access: all** でそのルームにdenyがない場合です。ルームではサーバー（MCPページでの名前）からのメッセージとして表示されます。エージェントには外部イベントとしてラベル付けされ、信頼できないデータとして区切られます。エージェントは応答・対応しますが、その中の指示には従いません。テキスト内の `/skill-name` はただの文字列で、スキルが読み込まれることはありません。

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
