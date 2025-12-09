# Kafka GUI Tool

Kafka 콘솔 컨슈머/프로듀서 기능을 제공하는 Electron 기반 데스크톱 GUI 애플리케이션입니다.

## Features

### Consumer

- Kafka 토픽의 실시간 메시지 수신 및 표시
- 키워드 필터링 (key/value 검색)
- Value JSONPath 필터링 (특정 필드 값으로 필터링)
- 메시지 Export (JSON/TXT 형식)
- 최대 메시지 보관 수 설정 가능

### Producer

- Kafka 토픽으로 메시지 전송
- Key/Value 입력 지원
- 반복 전송 기능 (간격, 횟수 설정)

### Multi-Tab

- 여러 토픽을 동시에 모니터링
- 탭별 독립적인 설정 및 메시지 버퍼

## Installation

```bash
git clone https://github.com/terria1020/kafka-gui-tool.git
cd kafka-gui-tool
npm install
```

## Run

```bash
npm start
```

## Build

```bash
# Build for current platform
npm run build

# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

## macOS 실행 문제 해결

GitHub Release에서 다운로드한 앱이 실행되지 않는 경우, 터미널에서 아래 명령어를 실행하세요:

```bash
xattr -cr "/Applications/Kafka GUI Tool.app"
```

> 이 문제는 Apple Developer 인증서 없이 빌드된 앱에 macOS Gatekeeper가 격리 속성을 부여하기 때문에 발생합니다. 관련 이슈: [#1](https://github.com/terria1020/kafka-gui-tool/issues/1)

## Usage

### Consumer 모드

1. **연결 설정**
   - Broker: Kafka 브로커 주소 입력 (예: `localhost:9092`)
   - Topic: 구독할 토픽 이름 입력 (예: `event-result`)
   - Group ID: Consumer Group ID (선택, 미입력 시 자동 생성)

2. **Consumer 시작**
   - "Consumer" 라디오 버튼 선택
   - "Start" 버튼 클릭
   - 상태 표시줄에서 연결 상태 확인 (Connected/Disconnected)

3. **메시지 필터링**
   - 키워드 검색: key 또는 value에 포함된 텍스트로 필터링
   - JSONPath 필터: value가 JSON일 때 특정 경로의 값으로 필터링
     - 예: `$.data.name` 입력 시 해당 필드 값이 표시됨

4. **메시지 상세 보기**
   - 메시지 행 클릭 시 상세 정보 모달 표시
   - JSON 형식의 value는 포맷팅되어 표시

5. **메시지 Export**
   - "Export" 버튼 클릭 후 형식 선택 (JSON/TXT)
   - 파일 저장 위치 선택

### Producer 모드

1. **연결 설정**
   - Broker: Kafka 브로커 주소 입력
   - Topic: 메시지를 전송할 토픽 이름 입력

2. **메시지 전송**
   - "Producer" 라디오 버튼 선택
   - Key: 메시지 키 입력 (선택사항)
   - Value: 전송할 메시지 내용 입력 (JSON 등)
   - "Send Message" 버튼 클릭

3. **반복 전송**
   - "반복 전송" 체크박스 선택
   - 간격(ms): 전송 간격 설정 (기본값: 1000ms)
   - 횟수: 반복 횟수 설정 (기본값: 10회)
   - "Send Message" 버튼 클릭 시 설정된 간격으로 반복 전송

### 멀티 탭 사용

- 상단 "+" 버튼 클릭하여 새 탭 추가
- 각 탭은 독립적인 브로커/토픽 연결 가능
- 탭의 "×" 버튼 클릭하여 탭 닫기

### 설정

- 상단 톱니바퀴 버튼 클릭
- Maximum Messages: 탭당 메모리에 보관할 최대 메시지 수 (10 - 100,000)

## UI Overview

```
┌─────────────────────────────────────────┐
│  Kafka GUI Tool                 [⚙] [+] │
├─────────────────────────────────────────┤
│  [Tab 1] [Tab 2] ...                    │
├─────────────────────────────────────────┤
│  Broker: [localhost:9092_________]      │
│  Topic:  [event-result___________]      │
│  Group:  [kafka-gui-group________]      │
│  Mode:   (●) Consumer  ( ) Producer     │
├─────────────────────────────────────────┤
│  Filter: [keyword____] [$.path] [🔍]    │
│  [Start] [Stop] [Clear] [Export ▾]      │
│  ● Connected | Messages: 150            │
├─────────────────────────────────────────┤
│  Timestamp | Part | Offset | Key | Value│
│  ───────────────────────────────────────│
│  17:30:45  |  0   |  1234  | k1  | {...}│
│  17:30:46  |  0   |  1235  | k2  | {...}│
└─────────────────────────────────────────┘
```

## Tech Stack

- Electron
- Node.js
- KafkaJS

## License

MIT
