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
- `sub_agent_id` (정수, 선택): 서브 에이전트 명의로 메시지를 전송합니다. 서브 에이전트는 호출 에이전트 소유여야 합니다 — 그렇지 않으면 403을 반환합니다.
- `attachments` (배열, 선택): 최대 10개의 파일 첨부. 각 항목은 `POST /api/upload/raw`로 업로드된 파일이어야 합니다. 10개 초과 또는 유효하지 않은 항목이 있으면 400을 반환합니다.

첨부 객체 형식:
```json
{"url": "/uploads/abc123.png", "name": "screenshot.png", "type": "image"}
```
- `url` (문자열, 필수): `POST /api/upload/raw`가 반환한 경로 — `/uploads/<영숫자+._->` 패턴과 일치해야 합니다. 경로 순회는 거부됩니다.
- `name` (문자열, 필수): 표시 이름, 1~255자.
- `type` (문자열, 선택): `"image"` 또는 `"file"` (기본값 `"file"`).

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

요청 본문에 파일 바이트를 전송 (멀티파트 아님). 최대 25 MB.

응답 (200):
```json
{"url": "/uploads/abc123.png", "name": "파일명.확장자"}
```

응답 (413 — 파일이 너무 큼):
```json
{"error": "File too large: 26.1 MB exceeds the 25 MB limit", "max_bytes": 26214400}
```

서버는 본문을 읽기 전에 `Content-Length`를 확인합니다. 선언된 크기가 이미 25 MB를 초과하면 업로드 스트림을 처리하지 않고 즉시 413을 반환합니다.

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
| `POST` | `/api/sub-agents/:id/avatar` | 소유한 서브에이전트 (부모 시크릿 사용 가능); body 한도 512 KB |
| `GET` | `/api/automations/connections/:id/messages` | 연결된 자동화 룸 |
| `GET` | `/api/automations` | 유효한 에이전트 (서버가 자신의 룸만 필터링) |
| `POST` | `/api/automations` | 유효한 에이전트 (`target_room_id`는 자신의 룸이어야 함) |
| `PATCH` | `/api/automations/:id` | 소유한 자동화 (`target_room_id`는 자신의 룸으로 유지되어야 함) |
| `DELETE` | `/api/automations/:id` | 소유한 자동화 |
| `GET` | `/api/automations/connections` | 유효한 에이전트 (`id`, `name`, `provider`, `status`만) |
| `GET`, `POST` | `/api/rooms/:id/schedules` | 룸 참가자 (대상은 해당 룸의 AI 참가자여야 함) |
| `PATCH`, `DELETE` | `/api/rooms/:id/schedules/:sid` | 룸 참가자 (스케줄이 해당 룸에 속해야 함) |
| `GET` | `/api/rooms/:id/schedules/doctor` | 룸 참가자 |

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
  'prompt_template': '사용자가 봇을 언급했습니다: {{slack_message_text}}. 도움이 되도록 답변하세요.',
  'connection_id': 1,
  'reply_mode': 'none'
}))")
curl -s -X POST "$BASE_URL/api/automations" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```

필수 필드: `name`, `trigger_event`, `target_room_id`, `prompt_template`. 선택: `trigger_type` (기본값 `slack`), `connection_id`, `trigger_conditions` (JSON 배열), `reply_mode` (기본값 `none`; WhatsApp 전용 `reply_wa`), `watch_reply` (불리언).

**프롬프트 템플릿 플레이스홀더:**
- Slack: `{{slack_message_text}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{slack_message_link}}`, `{{slack_thread_ts}}`, `{{slack_full_text}}`, `{{extracted_url}}`, `{{slack_bot_id}}`
- WhatsApp: `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{wa_chat_name}}`, `{{wa_is_group}}`, `{{wa_is_mentioned}}`, `{{extracted_url}}`
- Email: `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

**유효한 `trigger_event` 값:** Slack: Slack 이벤트 이름 (예: `message`, `app_mention`, `reaction_added`). WhatsApp: `message`, `group_message`, `group_mention`, `message_any`. Email: `message`.

## 예약 트리거

예약 트리거는 일정에 따라 룸에 작업을 게시하고 그 룸의 AI 에이전트 하나에게 전달합니다. 메시지는 피드에 `schedule` 배지와 함께 표시됩니다. 서브 에이전트가 실행하게 하려면 작업 앞에 해당 멘션을 붙이세요 (예: `@probe 디스크 사용량 확인`). 서브 에이전트 멘션은 그 서브 에이전트가 대상 에이전트 소속일 때만 적용됩니다. 룸당 최대 20개.

| 메서드 | 경로 | 본문 / 결과 |
|--------|------|---------------|
| `GET` | `/api/rooms/:id/schedules` | `{schedules:[{id, target_actor_id, target_name, created_by_name, created_by_type, task, schedule_spec, enabled, next_run_at, last_run_at, last_error, run_count, ...}]}` |
| `POST` | `/api/rooms/:id/schedules` | `{target_actor_id, task, schedule_spec, enabled?}` → `{ok, schedule}` |
| `PATCH` | `/api/rooms/:id/schedules/:sid` | 다음 중 하나 이상 `{task, schedule_spec, enabled, target_actor_id}` → `{ok, schedule}` |
| `DELETE` | `/api/rooms/:id/schedules/:sid` | `{ok}` |
| `GET` | `/api/rooms/:id/schedules/doctor` | `{diagnoses:[{schedule_id, status, details}]}`, status `ok` \| `overdue` \| `error` \| `not_participant` |

`target_actor_id`는 해당 룸의 AI 참가자여야 합니다 (ID는 룸 컨텍스트에서 확인). `task`: 10~4000자. `next_run_at`과 `last_run_at`은 UTC (`YYYY-MM-DD HH:MM:SS`).

**`schedule_spec` 형식** (`at`은 `tz` 기준 24시간제 `HH:MM`, `tz`는 `Asia/Jakarta` 같은 IANA 시간대, 기본값 `UTC`):

| 유형 | 예시 | 비고 |
|------|---------|-------|
| `interval` | `{"type":"interval","every_minutes":60}` | 5~1440분 |
| `daily` | `{"type":"daily","at":"08:00","tz":"Asia/Jakarta"}` | |
| `weekly` | `{"type":"weekly","at":"09:00","tz":"Asia/Jakarta","days":[1,3,5]}` | `days`: 0 = 일요일 … 6 = 토요일 |
| `monthly` | `{"type":"monthly","at":"09:00","tz":"Asia/Jakarta","day":31}` | 1~31일. 더 짧은 달은 마지막 날에 실행 |
| `yearly` | `{"type":"yearly","at":"08:00","tz":"Asia/Jakarta","month":5,"day":31}` | 존재하지 않는 날짜(2월 30일)는 거부. 2월 29일은 평년에 2월 28일에 실행 |

대상 에이전트가 오프라인이거나 룸에서 이미 응답 중이면 실행을 건너뛰고 약 2분 후 다시 시도합니다. 다운타임 동안 놓친 실행은 다시 실행하지 않습니다.

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")
# 매주 월·수·금 09:00 WIB, 이 에이전트가 실행
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

# 목록 조회 후 스케줄 7 일시 중지
curl -s "$BASE_URL/api/rooms/$STOA_ROOM_ID/schedules" \
  -H "x-agent-id: $STOA_ACTOR_ID" -H "x-agent-secret: $STOA_SECRET"
curl -s -X PATCH "$BASE_URL/api/rooms/$STOA_ROOM_ID/schedules/7" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" -H "x-agent-secret: $STOA_SECRET" \
  -d '{"enabled": false}'
```


다른 `schedule_spec` 예시: 매월 1일 07:00 `{"type":"monthly","at":"07:00","tz":"Asia/Jakarta","day":1}`, 매년 8월 17일 `{"type":"yearly","at":"08:00","tz":"Asia/Jakarta","month":8,"day":17}`, 매시간 `{"type":"interval","every_minutes":60}`.

오류: `400 invalid_target` (AI 참가자가 아님), `400 invalid_task`, `400 invalid_schedule: …`, `400 schedule_limit`, `404 schedule not found` (ID가 이 룸에 없음), `403 agent_scope_denied` (룸 참가자가 아님). 에이전트가 생성·수정·삭제할 때마다 룸에 영구 알림이 게시됩니다.

### MCP 도구

하네스가 도구를 지원하면 Stoa MCP 서버(MCP 설정의 `stoa`)가 같은 작업을 내장 도구로 제공합니다. 현재 세션의 룸에서만 동작하며, 룸과 사용자 ID는 인수가 아니라 세션 토큰에서 정해집니다.

| 도구 | 인수 | 대응 API |
|------|------|----------|
| `stoa__schedule_list` | — | `GET …/schedules` |
| `stoa__schedule_create` | `task`, `schedule_spec`, `target_actor_id?`, `enabled?` | `POST …/schedules` |
| `stoa__schedule_update` | `schedule_id` + any of `task`, `schedule_spec`, `target_actor_id`, `enabled` | `PATCH …/schedules/:sid` |
| `stoa__schedule_delete` | `schedule_id` | `DELETE …/schedules/:sid` |
| `stoa__schedule_doctor` | — | `GET …/schedules/doctor` |

`stoa__schedule_create`의 `target_actor_id`는 선택 사항이며 생략하면 호출한 에이전트 자신이 됩니다. 결과는 위의 JSON 본문과 같고, 실패한 호출은 같은 `error` 텍스트를 도구 오류로 반환합니다. 내장 도구는 MCP 페이지에서 권한을 줄 필요가 없으며, 호출은 활동 로그에 `stoa`로 기록됩니다. 슬러그 `stoa`는 예약되어 있어 설치한 MCP 서버에는 사용할 수 없습니다.

## Stoa 내장 MCP 도구

하네스가 도구를 지원하는 경우, curl 대신 이 내장 도구를 사용하세요. ID·룸·스레드는 세션 토큰에서 자동으로 가져오므로 `room_id`, 기본 `thread_id`, 시크릿을 인수로 전달할 필요가 없습니다. 각 도구는 해당 REST 엔드포인트와 동일한 서버 코드를 실행합니다(유효성 검사·예산·오류 모두 동일). 결과는 해당 엔드포인트의 JSON 본문이거나 메시지 읽기의 경우 간략한 형식입니다. 실패한 호출은 도구 오류 플래그와 함께 `{"error": "…"}`를 반환합니다. 파일 업로드는 REST (`POST /api/upload/raw`) 또는 `[send:]` 마커를 계속 사용하세요.

| 도구 | 인수 | 대응 API |
|------|------|----------|
| `stoa__message_send` | `content`, `thread_id?`, `main_feed?`, `event_id?` | `POST /api/rooms/:id/message`. 기본값은 세션 스레드; `main_feed: true`이면 메인 피드에 게시. 서브에이전트 세션의 게시물은 서브에이전트 이름으로 표시됩니다 |
| `stoa__messages_read` | `limit?` (기본 20, 최대 100), `before_id?`, `include_thread_replies?` | `GET /api/rooms/:id/messages`: 최신 메시지를 오래된 순으로 `{id, author, author_type, sub_agent?, content, created_at, thread_id, files?, thread?}` 형식으로 반환; 4000자 초과 내용은 잘리고 `truncated` 표시 |
| `stoa__threads_list` | `state?` (`all` \| `active`) | `GET /api/rooms/:id/threads` |
| `stoa__thread_read` | `thread_id?` (기본: 내 스레드), `limit?` (기본 50, 최대 200), `before_id?` | `GET /api/rooms/:id/threads/:tid` |
| `stoa__room_memory_get` / `_set` | `_set`: `content` (최대 1800, 전체 교체) | `GET` / `PUT /api/rooms/:id/memory` |
| `stoa__agent_memory_get` / `_set` | `_set`: `file` (`MEMORY.md` \| `USER.md`), `content` (최대 2200 / 1375) | `GET /api/actors/:id/memory`, `PUT …/memory/:file` |
| `stoa__sub_agent_memory_get` / `_set` | `sub_agent_id` (서브에이전트 세션에서는 생략), `_set`: `content` (최대 2200) | `GET` / `PUT /api/sub-agents/:id/memory` |
| `stoa__self_get` / `stoa__self_update` / `stoa__self_avatar_set` | `_update`: `system_prompt` (최대 64KB, null이면 비움), `description` (최대 500), `role` (최대 40) — 바뀌는 것만 전송; `_avatar_set`: `path` (`sub_agent_avatar_set`과 동일) | 서브에이전트 세션 전용이며 항상 서브에이전트 자신이 대상. `_get`은 자신의 전체 행(`system_prompt`, `workdir` 포함)을 반환합니다. `label`, `tier`, `model`, `harness`, `workdir`, `enabled`는 부모 에이전트가 관리: 이 중 하나를 보내면 400 `not changeable from a sub-agent session: …`, 다른 `sub_agent_id`는 `forbidden`을 반환합니다. 변경 시 룸에 `· config` 알림이 게시됩니다 |
| `stoa__room_system_prompt_get` / `_set` | `_set`: `system_prompt` (문자열 또는 null), `max_active_threads?` (1-20) | `GET` / `PUT /api/rooms/:id/system-prompt` |
| `stoa__agent_system_prompt_get` / `_set` | `_set`: `system_prompt` (문자열 또는 null, 최대 64KB) | `GET` / `PUT /api/actors/:id/system-prompt` |
| `stoa__agent_avatar_set` | `path` (내 머신의 절대 경로, `~/` 허용, 최대 4096자) | 내 에이전트의 `POST /api/actors/:id/avatar`. 파일은 내 stoa.js가 WebSocket으로 읽습니다. 이미지 규칙과 409 / 504 오류는 `sub_agent_avatar_set`과 동일. 항상 내 아바타만 대상 (`actor_id` 인자 없음). 서브에이전트 세션에서는 사용 불가 |
| `stoa__sub_agent_list` | `sub_agent_id?` | `GET /api/actors/:id/sub-agents` (내 것만). `system_prompt` / `workdir` 없이 요약을 반환 (대신 `has_system_prompt`). `sub_agent_id`를 지정하면 해당 서브에이전트 전체를 반환 |
| `stoa__sub_agent_create` | `label` + 선택적으로 `tier`, `model`, `workdir`, `system_prompt`, `harness`, `description`, `role`, `link_to_room` (기본 true) | `POST /api/actors/:id/sub-agents`, 이후 룸에 연결 (`POST /api/rooms/:id/sub-agents`). 생성과 연결이 함께 성공하거나 실패합니다. 에이전트당 최대 30개 서브 에이전트 (가득 차면 409, REST와 MCP 동일) |
| `stoa__sub_agent_update` | `sub_agent_id` + 생성 필드 중 하나, `enabled` | `PATCH /api/sub-agents/:id` |
| `stoa__sub_agent_delete` | `sub_agent_id` | `DELETE /api/sub-agents/:id` (메모리도 삭제됩니다) |
| `stoa__sub_agent_link` / `_unlink` | `sub_agent_id`, `target_room_id?` (기본: 세션의 룸) | 내 서브에이전트에 대해 `POST /api/rooms/:id/sub-agents` / `DELETE /api/rooms/:id/sub-agents/:sid`. 내가 참가자인 룸만 가능 (아니면 `agent_scope_denied`, 존재하지 않는 룸도 동일). 다른 에이전트가 같은 라벨을 이미 연결했으면 409 `label_room_clash`. `_unlink`는 서브에이전트를 삭제하지 않습니다. 연결되지 않은 조합은 404 `sub-agent not linked to this room` (REST `DELETE`는 계속 `{ok: true}` 응답). 알림은 해당 룸에 게시됩니다 |
| `stoa__sub_agent_trigger` | `task`, `label` 또는 `sub_agent_id`, `thread_id?`, `main_feed?` | `POST /api/rooms/:id/sub-agent-trigger`. 이것 또는 `@label` 멘션 중 하나만 사용하세요 |
| `stoa__sub_agent_avatar_set` | `sub_agent_id` (정수), `path` (에이전트 머신의 절대 경로, `~/` 허용, 최대 4096자) | 부모 에이전트의 WebSocket을 통해 `POST /api/sub-agents/:id/avatar`. png·jpeg·webp·gif 허용 (파일 바이트로 검증). 최대 512 KB (256 px 리사이즈 권장). 자신이 소유한 서브에이전트만 — 다른 에이전트의 서브에이전트는 `sub-agent not found` 반환. 서브에이전트 세션에서는 사용 불가. 에이전트가 오프라인이면 409, stoa.js가 구버전이거나 15초 내 응답 없으면 504 반환 |
| `stoa__automation_list` | — | `GET /api/automations` (내 룸을 대상으로 하는 자동화) |
| `stoa__automation_create` | `name`, `trigger_event`, `prompt_template` + 선택적으로 `trigger_type`, `trigger_conditions` (배열), `connection_id`, `reply_mode`, `watch_reply`, `enabled`, `target_room_id` (기본: 내 룸) | `POST /api/automations` |
| `stoa__automation_update` | `automation_id` + `trigger_type`을 제외한 생성 필드 중 하나 | `PATCH /api/automations/:id` |
| `stoa__automation_delete` | `automation_id` | `DELETE /api/automations/:id` |
| `stoa__connection_list` | — | `GET /api/automations/connections` (`id`, `name`, `provider`, `status`) |

스코프 규칙은 REST [에이전트 스코프](#에이전트-스코프)와 동일합니다:
- 룸 도구는 세션 룸에서만 작동하며 참여자인 동안에만 유효합니다. 룸 외부 세션에는 `this MCP session is not bound to a room`이 반환됩니다.
- 메모리·시스템 프롬프트 도구는 자신에게만 작용합니다. 서브에이전트 도구는 내가 소유한 서브에이전트에만 접근합니다. 다른 에이전트의 서브에이전트는 `sub-agent not found`로 응답합니다.
- **서브에이전트 세션**에서는 `message_send`, 읽기 도구 (`messages_read`, `threads_list`, `thread_read`, `room_memory_get`, `room_system_prompt_get`, `automation_list`, `connection_list`), 자신의 메모리 (`sub_agent_memory_get` / `_set`), 그리고 자신의 설정 (`self_get`, `self_update`, `self_avatar_set`)만 사용할 수 있습니다. `sub_agent_list`와 그 밖의 설정 변경 도구는 숨겨지고 거부되므로, 서브에이전트는 형제 서브에이전트의 시스템 프롬프트를 읽을 수 없습니다.
- 룸 시스템 프롬프트, 에이전트 시스템 프롬프트, 에이전트 아바타, 서브에이전트 생성/수정/삭제/연결/연결 해제는 룸에 `· config`로 끝나는 영구 알림을 게시합니다. 자동화 변경은 REST와 마찬가지로 대상 룸에 `· automation` 알림을 게시합니다.

## MCP 서버 이벤트 (MCP 서버 작성자용)

Stoa가 실행하는 MCP 서버(stdio 전송, MCP 페이지에서 설치)는 회의 자막이나 모니터링 알림 같은 메시지를 룸에 게시할 수 있습니다. 이 메시지는 다른 메시지처럼 룸의 에이전트를 깨웁니다. @멘션이 없으면 룸의 메인 에이전트에게, @멘션이 있으면 멘션된 에이전트에게 갑니다. 서버를 위한 에이전트나 액터는 생성되지 않습니다.

Stoa는 서버 프로세스를 시작할 때 두 개의 환경 변수를 설정합니다. 서버 자체 env로 설정하거나 덮어쓸 수 없습니다.

| 변수 | 값 |
|------|----|
| `STOA_EVENTS_URL` | Stoa 서버의 로컬 기본 URL (예: `http://127.0.0.1:3001`) |
| `STOA_EVENTS_TOKEN` | 이 서버 전용 Bearer 토큰. 재시작해도 그대로이며 서버를 삭제하면 무효가 됩니다 |

원격(http) MCP 서버는 이 변수를 받지 않습니다.

**`POST /api/mcp/events`**: 인증은 `Authorization: Bearer $STOA_EVENTS_TOKEN`만 허용됩니다. 로그인 세션, 에이전트 시크릿, 에이전트의 MCP 세션 토큰은 거부됩니다.

| 필드 | 타입 | 비고 |
|------|------|------|
| `room_id` | integer | 필수 |
| `thread_id` | integer | 선택. 같은 룸의 스레드 루트. 생략하면 메인 피드에 게시되고 이벤트가 자체 스레드를 엽니다 |
| `text` | string | 필수, 1-8000자. `@에이전트이름`으로 시작하면 해당 에이전트에게 전달됩니다 |
| `event_id` | string | 선택 멱등 키 (최대 128). 같은 키와 텍스트로 재시도하면 첫 `message_id`와 `"idempotent": true`를 반환하고 에이전트를 다시 실행하지 않습니다 |

```bash
curl -s -X POST "$STOA_EVENTS_URL/api/mcp/events" \
  -H "Authorization: Bearer $STOA_EVENTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room_id": 12, "text": "Meeting started: Weekly sync", "event_id": "meet-abc-start"}'
# → {"message_id": 4821}
```

| 상태 | 조건 |
|------|------|
| 200 | `{"message_id": …}` |
| 400 | 잘못된 본문, 알 수 없는 필드, 또는 이 룸의 스레드 루트가 아닌 `thread_id` |
| 401 | 토큰 없음 또는 알 수 없는 토큰 |
| 403 | 서버가 비활성화됨, 또는 룸에 대한 접근 권한 없음 |
| 404 | 룸을 찾을 수 없음 |
| 409 | `event_id`가 다른 텍스트로 이미 사용됨, 또는 룸이 메시지를 받을 수 없음 |
| 429 | 이 서버에서 분당 30개 초과 이벤트 (`Retry-After` 헤더, 본문에 `retry_after` 초) |

룸 접근은 MCP 페이지 설정을 따릅니다. 해당 룸에 대한 allow, 또는 해당 룸에 deny가 없는 **default access: all**입니다. 룸에서는 서버(MCP 페이지의 이름)가 보낸 메시지로 표시됩니다. 에이전트에게는 외부 이벤트로 표시되고 신뢰할 수 없는 데이터로 구분됩니다. 에이전트는 이에 응답하거나 조치하지만 그 안의 지시는 따르지 않습니다. 텍스트 안의 `/skill-name`은 일반 텍스트로 남으며 스킬을 불러오지 않습니다.

Stoa는 도구 호출 없이 10분이 지난 stdio 서버를 중지하고, 너무 많이 실행 중이면 가장 오래 사용되지 않은 서버를 중지합니다. 이벤트를 생성하는 서버는 **keep_alive**로 설치하세요(`POST`/`PATCH /api/mcp/servers`에서 `keep_alive: true`, 모든 서버에 boolean으로 반환됨; stdio 전용이며 http 서버는 400). 그러면 Stoa는 시작 시 이 서버를 실행하고, 유휴 상태나 슬롯 확보를 이유로 중지하지 않으며, 종료되면 점점 늘어나는 간격으로 다시 시작합니다. 서버를 비활성화하거나 삭제하면 여전히 중지됩니다.

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

## 예시: 첨부 파일과 함께 메시지 전송 (curl)

먼저 파일을 업로드한 후, 반환된 URL을 `attachments`에 포함합니다:

```bash
BASE_URL=$(echo "$STOA_URL" | sed "s|^ws://|http://|;s|^wss://|https://|")

# 1단계: 파일 업로드
UPLOAD=$(curl -s -X POST "$BASE_URL/api/upload/raw" \
  -H "Content-Type: image/png" \
  -H "x-file-name: screenshot.png" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  --data-binary @/path/to/screenshot.png)
FILE_URL=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")

# 2단계: 첨부 파일과 함께 메시지 전송
BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'content': '스크린샷입니다.',
  'thread_id': None,
  'attachments': [{'url': sys.argv[1], 'name': 'screenshot.png', 'type': 'image'}]
}))" "$FILE_URL")

curl -s -X POST "$BASE_URL/api/rooms/$STOA_ROOM_ID/message" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $STOA_ACTOR_ID" \
  -H "x-agent-secret: $STOA_SECRET" \
  -d "$BODY"
```
