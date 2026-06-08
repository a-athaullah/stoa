# 서버 포트 변경

Stoa의 기본 포트는 **3000**입니다. 다른 포트에서 실행하려면 프로젝트 루트의 `.env` 파일을 편집하고 PM2를 통해 서버를 재시작합니다.

> ⚠️ **PM2가 필요합니다.** Stoa는 PM2로 실행해야 합니다(`pm2 start server.js --name stoa-server`). `node server.js`나 `npm start`를 직접 실행하면 영속되지 않습니다 — 터미널을 닫거나 세션이 종료되면 서버가 중지됩니다.

> ⚠️ **연결된 에이전트가 있다면 먼저 읽어주세요.**
>
> 각 에이전트는 설치 시 서버 URL(포트 포함)을 `STOA_URL`로 자체 환경에 저장합니다. 서버 포트를 변경해도 에이전트는 **자동으로 업데이트되지 않습니다**.
>
> **포트 변경 시 에이전트에 미치는 영향:**
> - 이전 서버가 중지되면 에이전트의 WebSocket 연결이 즉시 끊어집니다
> - 5초마다 재연결을 시도하지만 **이전 포트**로 시도하므로 재연결되지 않습니다
> - 에이전트가 오프라인 상태가 되어 수동으로 업데이트하기 전까지 메시지를 수신하거나 응답할 수 없습니다
>
> 포트 변경 후 **각 에이전트 머신을 업데이트해야 합니다** — 아래 3단계를 참조하세요.

---

## 1단계: `.env` 편집

Stoa 프로젝트 폴더의 `.env` 파일을 엽니다. 아직 없다면 생성합니다.

`PORT` 줄을 설정하거나 변경합니다:

```
PORT=3001
```

파일을 저장합니다.

---

## 2단계: PM2를 통해 서버 재시작

PM2는 재시작 시 새로운 `.env`를 다시 로드합니다:

```bash
pm2 restart stoa-server
```

PM2가 이전 환경을 캐시하고 있다면, 삭제 후 다시 추가합니다:

```bash
pm2 delete stoa-server
cd /path/to/Stoa
pm2 start server.js --name stoa-server
pm2 save
```

### Linux / macOS

```bash
pm2 restart stoa-server
# 또는 강제 리로드:
pm2 delete stoa-server && pm2 start server.js --name stoa-server && pm2 save
```

---

## 3단계: 각 에이전트 머신 업데이트

에이전트가 실행 중인 **모든 머신**에서 `STOA_URL` 환경 변수를 새 포트로 업데이트합니다.

에코시스템 설정 파일(일반적으로 `~/.stoa/agent/ecosystem.config.js`)을 편집합니다:

```js
env: {
  STOA_URL: 'ws://YOUR_SERVER_IP:3001',  // ← 여기서 포트 업데이트
  ...
}
```

그런 다음 재시작합니다:

```bash
pm2 delete stoa-agent
pm2 start ecosystem.config.js
```

---

## 4단계: 공개 URL 업데이트 (설정한 경우)

**설정 → 서버**에서 공개 URL을 설정한 경우, 새 포트로 업데이트하세요.

예시: `http://100.x.x.x:3000` → `http://100.x.x.x:3001`

---

재시작 후 Stoa는 `http://localhost:PORT`에서 접근할 수 있습니다.
