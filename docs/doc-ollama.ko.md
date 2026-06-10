# Ollama 설정 가이드

Stoa는 **Ollama**를 AI 모델 제공자로 지원합니다 — 호스팅 클라우드 서비스와 자신의 머신에 로컬로 설치하는 방식 모두 지원합니다. 이 가이드는 두 가지 옵션과 설정 방법을 설명합니다.

---

## Ollama란?

[Ollama](https://ollama.com)는 대규모 언어 모델을 실행하기 위한 오픈소스 도구입니다. OpenAI 호환 HTTP API를 제공하므로 Stoa는 별도의 어댑터 없이 연결할 수 있습니다 — URL만 지정하면 바로 작동합니다.

Ollama는 Llama, Qwen, Mistral, Gemma, DeepSeek 등 다양한 오픈소스 모델 라이브러리에 접근할 수 있게 해줍니다. 이 중 일부는 Ollama Cloud 호스팅 서비스를 통해서도 이용할 수 있습니다.

---

## Ollama Cloud vs 로컬 Ollama

| | Ollama Cloud | 로컬 Ollama |
|---|---|---|
| **URL** | `https://ollama.com/v1` | `http://localhost:11434/v1` |
| **로컬 설치 필요** | 아니요 | 예 |
| **인터넷 연결 필요** | 예 | 아니요 (모델 다운로드 후) |
| **비용** | 무료 티어 + 유료 | 무료 (전기 + 하드웨어) |
| **모델 크기** | 480B+ 파라미터까지 | RAM/VRAM에 따라 제한 |
| **프라이버시** | 프롬프트가 Ollama 서버로 전송됨 | 본인 머신에 유지 |
| **속도** | 서버 부하에 따라 다름 | 하드웨어에 따라 다름 |
| **최적 용도** | 로컬 GPU 없이 대형 모델 사용 | 민감한 데이터, 오프라인 사용, API 비용 없음 |

### Ollama Cloud를 사용할 때

- 로컬 GPU 없이 매우 큰 모델(70B, 235B, 480B)을 실행하고 싶을 때
- 실험 중이며 로컬 인프라 관리를 원하지 않을 때
- 서버에서의 속도가 수용 가능한 수준일 때

### 로컬 Ollama를 사용할 때

- 프롬프트에 민감한 코드, 개인 정보, 또는 기밀 정보가 포함될 때
- API 비용을 완전히 없애고 싶을 때 (원하는 만큼 메시지를 보낼 수 있음, 무료)
- 오프라인이거나 제한된 네트워크 환경에서 작업할 때
- Apple Silicon Mac 또는 GPU를 보유하고 있을 때 — 추론 속도가 빠름
- 네트워크 변동 없이 결정적이고 재현 가능한 응답을 원할 때

---

## 로컬 Ollama 설치

### macOS

**옵션 1 — 데스크톱 앱 (권장):**

[ollama.com/download](https://ollama.com/download)에서 다운로드합니다. macOS 앱은 Ollama를 메뉴 바 앱으로 설치하며 로그인 시 자동으로 시작됩니다.

**옵션 2 — Homebrew:**

```bash
brew install ollama
```

서버 시작:
```bash
ollama serve
```

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

설치 프로그램이 `systemd` 서비스를 설정합니다. Ollama는 자동으로 시작되어 포트 11434에서 수신 대기합니다.

### Windows

[ollama.com/download/windows](https://ollama.com/download/windows)에서 설치 프로그램을 다운로드합니다. 설치 후 백그라운드 서비스로 실행됩니다.

---

## 모델 다운로드

Ollama를 설치한 후, 사용하려는 모델을 다운로드합니다. 터미널을 엽니다:

```bash
# 빠르고 유능한 7B 모델 — 시작하기 좋은 선택
ollama pull qwen2.5-coder:7b

# 범용, 우수한 추론 능력
ollama pull llama3.2

# 소형, CPU에서 매우 빠름
ollama pull qwen2.5:3b

# 더 크고 높은 품질 (~8GB RAM 필요)
ollama pull llama3.1:8b
```

이용 가능한 모델은 [ollama.com/library](https://ollama.com/library)에서 확인하세요.

이미 다운로드된 모델 목록 확인:
```bash
ollama list
```

---

## 로컬 Ollama를 Stoa에 추가

1. **Settings > Platforms**로 이동
2. **+ add platform** 클릭
3. 입력:
   - **Name**: `Local Ollama` (또는 원하는 이름)
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: 비워두기 (로컬 Ollama는 불필요)
4. **Save** 클릭
5. **Discover Models** 클릭 — Stoa가 사용 가능한 각 모델을 탐색하고 비전(이미지 입력)을 지원하는 모델을 감지합니다
6. 모델 목록에서 룸 셀렉터에서 사용하려는 모델에 체크
7. **Save Selection** 클릭

이제 로컬 모델이 컴포저의 모델 드롭다운에 플랫폼 이름으로 그룹화되어 표시됩니다.

---

## Ollama Cloud를 Stoa에 추가

1. [ollama.com](https://ollama.com)에서 가입하고 계정 설정에서 API 키 발급
2. **Settings > Platforms > + add platform**으로 이동
3. 입력:
   - **Name**: `Ollama Cloud`
   - **Base URL**: `https://ollama.com/v1`
   - **API Key**: Ollama API 키
4. **Save** 클릭, 이후 **Discover Models** 클릭
5. 원하는 모델을 선택하고 **Save Selection** 클릭

---

## 여러 머신에서 Ollama 공유하기 (멀티 에이전트 설정)

기본적으로 Ollama는 `127.0.0.1`(localhost)에서만 수신합니다. 서로 다른 머신에서 실행 중인 여러 Stoa 에이전트가 동일한 Ollama 인스턴스를 사용하려면 Ollama를 네트워크에서 접근 가능하도록 설정해야 합니다.

자신의 머신에서라도 **Tailscale IP**(예: `http://100.x.x.x:11434/v1`)를 통해 Ollama에 접근하는 경우에도 이 설정이 필요합니다. Tailscale 인터페이스는 별도의 네트워크 인터페이스로 처리되기 때문입니다.

### 1단계 — 모든 인터페이스에서 수신하도록 Ollama 허용

**macOS (Ollama.app):**

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
```

그런 다음 Ollama를 재시작합니다: 메뉴 바에서 종료하고 다시 여세요.

> 이 설정은 다음 재부팅까지 유지됩니다. 영구적으로 적용하려면 셸 설정에 추가하고 터미널에서 Ollama를 재시작하세요:
> ```bash
> echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.zshrc
> source ~/.zshrc
> ollama serve
> ```

**macOS (Homebrew / CLI):**

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

또는 `~/.zshrc`에 `export OLLAMA_HOST=0.0.0.0`을 추가하고 터미널에서 `ollama serve`를 실행하세요.

**Linux (systemd):**

```bash
sudo systemctl edit ollama
```

다음을 추가하세요:
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

그런 다음:
```bash
sudo systemctl restart ollama
```

### 2단계 — Stoa에서 올바른 URL 사용

Ollama가 모든 인터페이스에서 수신하게 되면 다음 중 하나를 사용하세요:
- **LAN IP**: `http://192.168.x.x:11434/v1`
- **Tailscale IP**: `http://100.x.x.x:11434/v1`

Stoa의 각 에이전트를 이 URL을 사용하도록 설정할 수 있습니다 — 동일한 Tailscale 네트워크 내 어느 머신의 에이전트든 동일한 Ollama 인스턴스를 공유할 수 있습니다.

### 연결 확인

Ollama에 접근해야 하는 모든 머신에서:

```bash
curl http://<ollama-machine-ip>:11434/api/tags
```

모델 목록이 반환되면 연결이 작동하는 것이며 Stoa는 해당 주소에서 모델을 검색할 수 있습니다.

---

## 문제 해결

**Discover 후 "No models found"**

- Ollama가 실행 중인지 확인하세요: `ollama list`가 결과를 반환해야 합니다
- URL을 확인하세요 — 로컬 Ollama는 `http://localhost:11434/v1`입니다 (`https://`가 아님)
- Tailscale IP를 통해 접근하고 있나요? 위의 [멀티 에이전트 설정](#여러-머신에서-ollama-공유하기-멀티-에이전트-설정) 섹션을 참조하세요 — 먼저 `OLLAMA_HOST=0.0.0.0` 설정이 필요합니다

**모델이 응답하지 않음**

- 모델이 아직 pull되지 않았을 수 있습니다. 터미널에서 `ollama pull <model-name>`을 실행하세요
- 사용 가능한 메모리를 확인하세요 — 대형 모델은 상당한 RAM이 필요합니다 (7B 모델은 약 5GB 필요)

**응답이 느림**

- 대형 모델의 CPU 추론은 느립니다. 더 작은 모델(3B–7B) 또는 CPU에 최적화된 모델을 사용해 보세요
- Apple Silicon에서 Ollama는 Neural Engine을 사용합니다 — x86 CPU보다 성능이 훨씬 뛰어납니다
