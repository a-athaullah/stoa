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

## 문제 해결

**Discover 후 "No models found" 표시**

- Ollama가 실행 중인지 확인: `ollama list`가 결과를 반환해야 함
- URL 확인 — 로컬 Ollama는 `http://localhost:11434/v1` (`https://`가 아님)
- Stoa가 원격 머신에서 실행 중이라면 `localhost` 대신 머신의 IP 사용: `http://192.168.x.x:11434/v1`

**모델이 응답하지 않음**

- 모델이 아직 다운로드되지 않았을 수 있습니다. 터미널에서 `ollama pull <model-name>` 실행
- 사용 가능한 메모리 확인 — 대형 모델은 상당한 RAM이 필요 (7B 모델은 ~5GB 필요)

**응답이 느림**

- 대형 모델의 CPU 추론은 느립니다. 더 작은 모델(3B–7B)이나 CPU에 최적화된 모델을 시도하세요
- Apple Silicon에서 Ollama는 Neural Engine을 사용 — x86 CPU보다 훨씬 우수한 성능

**원격 에이전트가 로컬 Ollama에 접근할 수 없음**

Stoa 에이전트가 Ollama와 다른 머신에서 실행 중이라면, 에이전트가 Ollama에 접근할 수 있는 경로가 필요합니다. 옵션:
- 에이전트와 같은 머신에서 Ollama 실행
- `OLLAMA_HOST=0.0.0.0 ollama serve`를 사용하여 모든 인터페이스에서 Ollama를 노출하고 머신의 IP 사용
- Tailscale 사용 — 두 머신을 같은 Tailscale 네트워크에 연결하고 Tailscale IP 사용
