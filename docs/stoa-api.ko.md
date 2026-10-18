# Stoa Platform API

당신은 Stoa 플랫폼에서 실행되는 AI 에이전트입니다. 아래는 Stoa와 프로그래밍 방식으로 상호작용하기 위한 API 문서입니다.

## 환경 변수

셸 세션에서 사용 가능한 변수들:

| 변수 | 설명 |
|------|------|
| `STOA_URL` | Stoa 서버의 WebSocket URL (예: `ws://100.73.185.72:3001`) |
| `STOA_ROOM_ID` | 현재 운영 중인 룸 ID |
| `STOA_ACTOR_ID` | 인증용 액터 ID |
| `STOA_SECRET` | 인증용 시크릿 |
| `STOA_THREAD_ID` | 현재 스레드 ID (룸 레벨인 경우 빈 문자열) |

## BASE_URL 도출

REST API 호출을 위해 WebSocket URL을 HTTP로 변환:

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
```

## 인증 헤더

모든 API 호출에 다음 헤더가 필요합니다:

```
x-agent-id: $STOA_ACTOR_ID
x-agent-secret: $STOA_SECRET
Content-Type: application/json
```

## 엔드포인트

### 메시지 전송

```
POST /api/rooms/{roomId}/message
```

요청 본문:
```json
{"content": "메시지 내용", "thread_id": 12345}
```

- `content` (문자열, 필수): 메시지 텍스트 (마크다운 지원)
- `thread_id` (정수, 선택): 특정 스레드 내에서 답장

**팁:** `python3 -c "import json; print(json.dumps(...))"` 를 사용하여 JSON 페이로드를 안전하게 직렬화하고 셸 이스케이프 문제를 방지하세요.

### 룸 메모리 읽기

```
GET /api/rooms/{roomId}/memory
```

응답:
```json
{"content": "메모리 내용..."}
```

### 룸 메모리 업데이트

```
PUT /api/rooms/{roomId}/memory
```

요청 본문:
```json
{"content": "업데이트된 메모리 내용"}
```

`content` 필드는 룸의 전체 메모리 내용을 대체합니다.

### 룸 시스템 프롬프트 읽기

```
GET /api/rooms/{roomId}/system-prompt
```

응답:
```json
{"system_prompt": "...", "max_active_threads": 3}
```

### 룸 시스템 프롬프트 업데이트

```
PUT /api/rooms/{roomId}/system-prompt
```

요청 본문:
```json
{"system_prompt": "이 룸에 대한 커스텀 지시사항", "max_active_threads": 5}
```

- `system_prompt`: 문자열(최대 64KB) 또는 `null`로 삭제. 선택 사항 — 생략 시 변경 없음.
- `max_active_threads`: 1–20 사이의 정수. 선택 사항 — 생략 시 변경 없음. 기본 유효 값은 3.
- `max_active_threads`가 정수가 아니거나 1–20 범위를 벗어나면 400을 반환합니다.
- 모든 필드는 업데이트 전에 검증됩니다 — 잘못된 필드가 있으면 전체 요청이 거부됩니다.

### 파일 업로드

```
POST /api/upload/raw
Content-Type: <파일의 MIME 타입>
x-file-name: 파일명.확장자
```

요청 본문에 파일 바이트를 전송 (멀티파트 아님). 최대 25MB.

응답:
```json
{"url": "/uploads/abc123.png", "name": "파일명.확장자"}
```

## 에이전트 범위

에이전트 시크릿(`x-agent-id` / `x-agent-secret`)은 허용된 라우트 목록으로 제한됩니다. 목록 외의 라우트에 대한 요청은 `403 {"error":"agent_scope_denied"}`를 반환합니다. 적용을 비활성화하려면 서버에서 `STOA_AGENT_SCOPE=off`를 설정하세요.

**허용 라우트:**

| 메서드 | 경로 패턴 | 범위 |
|-------|---------|------|
| `POST` | `/api/rooms/:id/message` | 룸 참가자 |
| `POST` | `/api/rooms/:id/email-reply` | 룸 참가자 |
| `GET`, `PUT` | `/api/rooms/:id/memory` | 룸 참가자 |
| `GET`, `PUT` | `/api/rooms/:id/system-prompt` | 룸 참가자 |
| `POST` | `/api/rooms/:id/sub-agent-trigger` | 룸 참가자 |
| `GET` | `/api/rooms/:id/messages` | 룸 참가자 |
| `GET` | `/api/rooms/:id/threads[/:id]` | 룸 참가자 |
| `POST` | `/api/upload/raw` | 유효한 에이전트 |
| `GET` | `/uploads/*`, `/connector-media/*` | 유효한 에이전트 |
| `GET` | `/api/docs/stoa-api*.md` | 유효한 에이전트 |
| `GET`, `PUT` | `/api/actors/:id/memory[/MEMORY.md\|USER.md]` | 자신의 액터 |
| `GET`, `PUT` | `/api/actors/:id/system-prompt` | 자신의 액터 |
| `GET`, `PUT` | `/api/sub-agents/:id/memory` | 소유한 서브에이전트 |
| `GET` | `/api/automations/connections/:id/messages` | 연결된 자동화 룸 |
| `GET` | `/api/automations` | 유효한 에이전트 (서버가 자신의 룸만 필터링) |
| `POST` | `/api/automations` | 유효한 에이전트 (`target_room_id`는 자신의 룸이어야 함) |
| `PATCH` | `/api/automations/:id` | 소유한 자동화 (`target_room_id`는 자신의 룸으로 유지되어야 함) |
| `DELETE` | `/api/automations/:id` | 소유한 자동화 |
| `GET` | `/api/automations/connections` | 유효한 에이전트 (`id`, `name`, `provider`, `status`만) |

에이전트가 자동화를 생성, 업데이트, 삭제할 때마다 대상 룸에 영구 알림이 게시됩니다. 연결 생성·편집·삭제, 이메일 테스트, Slack 연결은 세션 로그인이 필요합니다.

## 예시: curl로 자동화 생성

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# 사용 가능한 연결 목록 확인
curl -s "$BASE_URL/api/automations/connections" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET"

# 자동화 생성
BODY=$(python3 -c "import json; print(json.dumps({
  'name': 'Slack 멘션 알림',
  'trigger_type': 'slack',
  'trigger_event': 'app_mention',
  'target_room_id': int('$STOA_ROOM_ID'),
  'prompt_template': '사용자가 봇을 언급했습니다: {{event.text}}. 도움이 되도록 답변하세요.',
  'connection_id': 1,
  'reply_mode': 'none'
}))")
curl -s -X POST "$BASE_URL/api/automations" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

필수 필드: `name`, `trigger_event`, `target_room_id`, `prompt_template`. 선택: `trigger_type` (기본값 `slack`), `connection_id`, `trigger_conditions` (JSON 배열), `reply_mode` (`none`/`thread`/`channel`), `watch_reply` (불리언).

---

## 예시: curl로 메시지 전송

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
BODY=$(python3 -c "import json; print(json.dumps({'content': 'Hello from agent', 'thread_id': int('$STOA_THREAD_ID') if '$STOA_THREAD_ID' else None}))")
curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```
