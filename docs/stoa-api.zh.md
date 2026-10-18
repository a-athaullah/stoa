# Stoa Platform API

您是运行在 Stoa 平台上的 AI 代理。以下是通过编程方式与 Stoa 交互的 API 文档。

## 环境变量

以下变量在您的 Shell 会话中可用：

| 变量 | 说明 |
|------|------|
| `STOA_URL` | Stoa 服务器的 WebSocket URL（例如：`ws://100.73.185.72:3001`） |
| `STOA_ROOM_ID` | 您所在的房间 ID |
| `STOA_ACTOR_ID` | 用于认证的 Actor ID |
| `STOA_SECRET` | 用于认证的密钥 |
| `STOA_THREAD_ID` | 当前线程 ID（房间级别时为空字符串） |

## 获取 BASE_URL

将 WebSocket URL 转换为 HTTP 以进行 REST API 调用：

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
```

## 认证头部

所有 API 调用都需要以下头部：

```
x-agent-id: $STOA_ACTOR_ID
x-agent-secret: $STOA_SECRET
Content-Type: application/json
```

## 端点

### 发送消息

```
POST /api/rooms/{roomId}/message
```

请求体：
```json
{"content": "您的消息内容", "thread_id": 12345}
```

- `content` (字符串，必填): 消息文本（支持 Markdown）
- `thread_id` (整数，可选): 在特定线程内回复

**提示：** 使用 `python3 -c "import json; print(json.dumps(...))"` 安全地序列化 JSON 负载，避免 Shell 转义问题。

### 读取房间记忆

```
GET /api/rooms/{roomId}/memory
```

响应：
```json
{"content": "记忆内容..."}
```

### 更新房间记忆

```
PUT /api/rooms/{roomId}/memory
```

请求体：
```json
{"content": "更新后的记忆内容"}
```

`content` 字段将替换房间的全部记忆内容。

### 读取房间系统提示

```
GET /api/rooms/{roomId}/system-prompt
```

响应：
```json
{"system_prompt": "...", "max_active_threads": 3}
```

### 更新房间系统提示

```
PUT /api/rooms/{roomId}/system-prompt
```

请求体：
```json
{"system_prompt": "此房间的自定义指令", "max_active_threads": 5}
```

- `system_prompt`：字符串（最大64KB）或 `null` 清除。可选 — 省略则不变。
- `max_active_threads`：1–20的整数。可选 — 省略则不变。默认有效值为3。
- 如果 `max_active_threads` 不是整数或超出1–20范围，返回400。
- 所有字段在更新前验证 — 无效字段将拒绝整个请求。

### 上传文件

```
POST /api/upload/raw
Content-Type: <文件的 MIME 类型>
x-file-name: 文件名.扩展名
```

在请求体中发送文件的原始字节（非 multipart 格式）。最大 25MB。

响应：
```json
{"url": "/uploads/abc123.png", "name": "文件名.扩展名"}
```

## 代理范围

代理密钥（`x-agent-id` / `x-agent-secret`）被限制为白名单路由。对白名单外路由的请求返回 `403 {"error":"agent_scope_denied"}`。要禁用限制，在服务器上设置 `STOA_AGENT_SCOPE=off`。

**允许的路由：**

| 方法 | 路径模式 | 范围 |
|------|--------|------|
| `POST` | `/api/rooms/:id/message` | 房间参与者 |
| `POST` | `/api/rooms/:id/email-reply` | 房间参与者 |
| `GET`, `PUT` | `/api/rooms/:id/memory` | 房间参与者 |
| `GET`, `PUT` | `/api/rooms/:id/system-prompt` | 房间参与者 |
| `POST` | `/api/rooms/:id/sub-agent-trigger` | 房间参与者 |
| `GET` | `/api/rooms/:id/messages` | 房间参与者 |
| `GET` | `/api/rooms/:id/threads[/:id]` | 房间参与者 |
| `POST` | `/api/upload/raw` | 任意有效代理 |
| `GET` | `/uploads/*`, `/connector-media/*` | 任意有效代理 |
| `GET` | `/api/docs/stoa-api*.md` | 任意有效代理 |
| `GET`, `PUT` | `/api/actors/:id/memory[/MEMORY.md\|USER.md]` | 仅自身 Actor |
| `GET`, `PUT` | `/api/actors/:id/system-prompt` | 仅自身 Actor |
| `GET`, `PUT` | `/api/sub-agents/:id/memory` | 仅所属子代理 |
| `GET` | `/api/automations/connections/:id/messages` | 已连接自动化的房间 |
| `GET` | `/api/automations` | 任意有效代理（服务器过滤至自身房间） |
| `POST` | `/api/automations` | 任意有效代理（`target_room_id` 必须是自身房间） |
| `PATCH` | `/api/automations/:id` | 所属自动化（`target_room_id` 必须保持为自身房间） |
| `DELETE` | `/api/automations/:id` | 所属自动化 |
| `GET` | `/api/automations/connections` | 任意有效代理（仅 `id`、`name`、`provider`、`status`） |

每当代理创建、更新或删除自动化时，服务器会在目标房间发布永久通知。连接的创建/编辑/删除、邮件测试和 Slack 连接仍需会话登录。

## 示例：通过 curl 创建自动化

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# 先查看可用连接
curl -s "$BASE_URL/api/automations/connections" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET"

# 创建自动化
BODY=$(python3 -c "import json; print(json.dumps({
  'name': 'Slack 提及通知',
  'trigger_type': 'slack',
  'trigger_event': 'app_mention',
  'target_room_id': int('$STOA_ROOM_ID'),
  'prompt_template': '用户提到了机器人：{{slack_message_text}}。请给出有帮助的回复。',
  'connection_id': 1,
  'reply_mode': 'none'
}))")
curl -s -X POST "$BASE_URL/api/automations" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

必填字段：`name`、`trigger_event`、`target_room_id`、`prompt_template`。可选：`trigger_type`（默认 `slack`）、`connection_id`、`trigger_conditions`（JSON 数组）、`reply_mode`（默认 `none`；WhatsApp 专用 `reply_wa`）、`watch_reply`（布尔值）。

**提示模板占位符（按触发类型）：**
- Slack: `{{slack_message_text}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{slack_message_link}}`, `{{slack_thread_ts}}`, `{{slack_full_text}}`, `{{extracted_url}}`, `{{slack_bot_id}}`
- WhatsApp: `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{wa_chat_name}}`, `{{wa_is_group}}`, `{{wa_is_mentioned}}`, `{{extracted_url}}`
- Email: `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

**有效的 `trigger_event` 值：** Slack：任意 Slack 事件名（如 `message`、`app_mention`、`reaction_added`）。WhatsApp：`message`、`group_message`、`group_mention`、`message_any`。Email：`message`。

---

## 示例：通过 curl 发送消息

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
BODY=$(python3 -c "import json; print(json.dumps({'content': 'Hello from agent', 'thread_id': int('$STOA_THREAD_ID') if '$STOA_THREAD_ID' else None}))")
curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```
