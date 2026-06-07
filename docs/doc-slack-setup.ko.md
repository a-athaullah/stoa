# Stoa 자동화를 위한 Slack 설정

Stoa는 **Socket Mode**를 통해 Slack에 연결합니다 — 아웃바운드 WebSocket 연결입니다. 공개 URL이나 포트 개방이 필요하지 않습니다.

두 가지 토큰이 필요합니다: **App Token**(WebSocket 연결용)과 **User Token**(채널 이벤트 수신용).

---

## 1단계 — Slack App 만들기

1. [https://api.slack.com/apps](https://api.slack.com/apps)를 열고 **Create New App** 클릭
2. **From scratch** 선택
3. App 이름(예: `Stoa`)을 입력하고 워크스페이스 선택
4. **Create App** 클릭

---

## 2단계 — Socket Mode 활성화

1. 왼쪽 사이드바에서 **Socket Mode** 클릭
2. **Enable Socket Mode**를 **On**으로 전환
3. 대화상자에서 토큰 이름(예: `stoa-listener`) 입력
4. `connections:write` 스코프는 자동으로 추가됩니다 — **Generate** 클릭
5. `xapp-1-`로 시작하는 토큰 복사 — 이것이 **App Token**입니다

---

## 3단계 — User Token Scope 추가

1. 왼쪽 사이드바에서 **OAuth & Permissions** 클릭
2. **User Token Scopes** 섹션으로 스크롤(Bot Token Scopes가 아님)
3. 다음 스코프 추가:
   - `channels:history` — 공개 채널 메시지 읽기
   - `channels:read` — 채널 정보 읽기
   - `groups:history` — **비공개 채널** 메시지 읽기
   - `im:history` — 다이렉트 메시지 읽기

---

## 4단계 — 사용자 이벤트 구독

1. 왼쪽 사이드바에서 **Event Subscriptions** 클릭
2. **Enable Events**를 **On**으로 전환
3. **Subscribe to events on behalf of users**로 스크롤("bot events"가 아님)
4. **Add Workspace Event**를 클릭하고 추가:
   - `message.channels` — 참여 중인 공개 채널의 메시지
   - `message.groups` — 참여 중인 **비공개 채널**의 메시지
   - `message.im` — 받은 다이렉트 메시지
5. **Save Changes** 클릭

---

## 5단계 — App 설치

1. 왼쪽 사이드바에서 **Install App** 클릭
2. **Install to Workspace** 클릭(이미 설치된 경우 **Reinstall**)
3. 권한 승인
4. `xoxp-`로 시작하는 **User OAuth Token** 복사

---

## 6단계 — Bot 채널 초대 불필요

User Token 방식에서는 Bot을 채널에 초대할 필요가 없습니다 — 이벤트는 당신(사용자)이 이미 참여 중인 채널에서 직접 전달됩니다.

---

## 7단계 — Stoa에서 연결

1. Stoa → **Settings → Automation → Connections** 열기
2. **Add Connection** 클릭
3. 이름 입력, 공급자 **Slack**, 토큰 유형 **User** 선택
4. **App Token**(`xapp-1-...`)과 **User Token**(`xoxp-...`) 붙여넣기
5. **Save** 클릭 — Stoa가 연결을 시작합니다

연결 후, Slack 이벤트로 트리거되는 자동화 규칙을 추가할 수 있습니다.

---

## 참고: 권한 변경 후 재설치 필요

User Token Scope를 추가하거나 변경할 때마다 Slack은 재설치를 요구합니다. **Install App** 페이지에서 **Reinstall to Workspace**를 클릭하고 승인하세요. User Token은 그대로 유지되며 권한만 업데이트됩니다.
