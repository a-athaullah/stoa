# 서버 포트 변경

Stoa의 기본 포트는 **3030**입니다. 변경하려면 `config.yaml`의 `port`를 설정(또는 `config.yaml`을 덮어쓰는 `.env`의 `PORT`)한 다음 게이트웨이를 재시작합니다.

> Stoa는 네이티브 백그라운드 서비스 — **게이트웨이**(macOS는 launchd, Linux는 systemd)로 실행됩니다. PM2가 필요 없습니다. `stoa gateway <start|stop|restart|status>`로 관리합니다.

> ⚠️ **연결된 에이전트가 있다면 먼저 읽어주세요.**
>
> 각 에이전트는 설치 시 서버 URL(포트 포함)을 `STOA_URL`로 서비스 유닛에 저장합니다. 서버 포트를 변경해도 에이전트는 **자동으로 업데이트되지 않습니다**.
>
> - 이전 서버가 중지되면 에이전트의 WebSocket 연결이 끊어집니다
> - 몇 초마다 재연결을 시도하지만 **이전 포트**로 시도하므로 재연결되지 않습니다
> - 업데이트하기 전까지 오프라인 상태로 유지됩니다
>
> 포트 변경 후 **각 에이전트 머신을 업데이트하세요** — 3단계 참조.

---

## 1단계: 포트 설정

데이터 디렉터리의 `config.yaml`(설치 시 `~/.stoa/server/config.yaml`, 개발 시 리포지토리 루트)을 편집합니다:

```yaml
port: 3031
```

(또는 `.env`에 `PORT=3031` 설정 — 환경 변수가 `config.yaml`을 덮어씁니다.)

---

## 2단계: 게이트웨이 재시작

```bash
stoa gateway restart
```

그러면 서버는 `http://localhost:3031`에서 접근할 수 있습니다.

---

## 3단계: 각 에이전트 머신 업데이트

각 에이전트는 서비스 유닛에 `STOA_URL`이 내장되어 있습니다. 가장 간단한 방법은 해당 에이전트의 **설치 명령을 다시 실행**(설정 → 에이전트에 표시)하여 새 URL로 재등록하는 것입니다.

직접 수정하려면 에이전트의 서비스 유닛을 편집하고 재시작합니다:

- macOS: `~/Library/LaunchAgents/com.stoa.agent.<id>.plist`
- Linux: `~/.config/systemd/user/stoa-agent-<id>.service`

`STOA_URL` 값을 새 포트로 변경한 다음 서비스를 다시 로드합니다.

---

## 4단계: 공개 URL 업데이트 (설정한 경우)

공개 URL을 설정한 경우 `config.yaml`(`public_url`) 또는 웹 UI의 **설정**에서 업데이트하세요 — 예: `http://100.x.x.x:3030` → `http://100.x.x.x:3031`.
