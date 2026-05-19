# Tailscale로 공개 URL 얻기

Stoa는 로컬 네트워크에서 실행됩니다. 다른 머신의 에이전트나 휴대폰에서 연결하려면 Stoa 서버에 접근 가능한 주소가 필요합니다. **Tailscale**이 이를 위한 가장 쉬운 방법입니다. 모든 디바이스에 걸쳐 프라이빗 메시 VPN을 생성하여 각 디바이스에 `100.x.x.x` 범위의 안정적인 IP를 부여합니다.

---

## Tailscale이란?

Tailscale은 노트북, 서버, 휴대폰 등 모든 디바이스를 물리적 위치에 관계없이 같은 로컬 네트워크에 있는 것처럼 동작하게 합니다. 포트 포워딩, 공인 IP, 방화벽 규칙이 필요 없습니다.

---

## 1. 서버에 Tailscale 설치 (Stoa가 실행 중인 머신)

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

브라우저 창이나 로그인 URL이 나타납니다 — 거기서 로그인을 완료하세요.

### Windows

[tailscale.com/download](https://tailscale.com/download)에서 설치 프로그램을 다운로드하여 실행합니다. 설치 후 시스템 트레이의 Tailscale 아이콘 → **로그인**을 클릭합니다.

### macOS

```bash
brew install --cask tailscale
```

또는 App Store에서 설치. 앱을 열고 → **로그인**.

---

## 2. 서버의 Tailscale IP 확인

로그인 후 이 머신의 Tailscale IP를 확인합니다:

### Linux / macOS

```bash
tailscale ip -4
# 예시: 100.x.x.x
```

### Windows (PowerShell)

```powershell
(Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4).IPAddress
# 예시: 100.x.x.x
```

또는 [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines)를 열면 모든 머신과 IP가 나열됩니다.

---

## 3. Stoa에서 공개 URL 설정

두 가지 방법이 있습니다:

**환경 변수로 설정** — Stoa 프로젝트 루트의 `.env` 파일에 추가:

```
STOA_PUBLIC_URL=http://100.x.x.x:3001
```

`100.x.x.x`를 해당 머신의 Tailscale IP로 교체하세요.

**설정 UI로 설정** — 브라우저에서 Stoa를 열고 → **설정 → 서버 → 공개 URL**에 URL을 입력하고 **저장**을 클릭합니다. 이 값은 데이터베이스에 저장되며 환경 변수보다 우선합니다.

---

## 4. 휴대폰에 Tailscale 설치

### Android

[Google Play 스토어](https://play.google.com/store/apps/details?id=com.tailscale.ipn)에서 다운로드하거나 [tailscale.com/download](https://tailscale.com/download)에서 직접 다운로드합니다.

### iOS / iPhone

[App Store](https://apps.apple.com/app/tailscale/id1470499037)에서 다운로드합니다.

휴대폰에 설치 후:
1. Tailscale 앱을 열고 → 서버에서 사용한 동일한 계정으로 **로그인**
2. VPN을 활성화 — 휴대폰에서 서버의 `100.x.x.x` IP에 접근할 수 있게 됩니다

휴대폰의 브라우저를 열고 → `http://100.x.x.x:3001` (서버의 Tailscale IP)을 입력 → Stoa가 로드됩니다.

---

## 5. 다른 머신에서 에이전트 설치

대상 머신에서 Tailscale이 실행 중인 상태에서 **설정 → 에이전트 → 에이전트 추가**에 표시된 설치 명령어를 실행합니다:

```bash
# Linux / macOS
curl -fsSL http://100.x.x.x:3001/install.sh | bash

# Windows (PowerShell)
irm http://100.x.x.x:3001/install.ps1 | iex
```

에이전트가 서버에 등록되고 자동으로 연결됩니다.

---

## 참고 사항

- Tailscale IP는 안정적입니다 — Tailscale 네트워크에서 머신을 제거하지 않는 한 변경되지 않습니다.
- Tailscale 디바이스 간의 모든 트래픽은 종단 간 암호화됩니다.
- 개인 사용은 무료: 최대 3명의 사용자와 100대의 디바이스.
