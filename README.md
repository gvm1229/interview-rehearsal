# interview-rehearsal

면접 질문, 답안, 지원 서류를 한곳에 모아 준비하고 복습하는 로컬 웹 앱입니다. 브라우저의 **Prep** 화면에서 자료를 작성하고 검색할 수 있습니다. 말하기 연습이 필요하면 **Chat** 화면에서 Codex와 연결해 질문을 하나씩 받고, 답변과 교정 내용을 다시 볼 수 있습니다.

## 시작하기

Windows에서 Node.js 24와 pnpm 10을 사용해 확인했습니다. 프로젝트를 내려받고 앱을 시작합니다.

```powershell
git clone https://github.com/gvm1229/interview-rehearsal.git
cd interview-rehearsal
pnpm install --frozen-lockfile
pnpm build
.\Start-Interview.ps1
```

Whale 등 브라우저에서 앱을 엽니다. Prep에서 자료를 만들고 편집하는 데는 Codex나 별도 계정이 필요 없습니다. [앱 열기](http://127.0.0.1:4173/)

## 면접 자료 준비하기

1. **새 자료 만들기**에서 면접 이름과 질문·설명 언어를 정합니다. 기존 `.interviewpack` 파일이 있다면 가져온 뒤 목록에서 엽니다.
2. **Prep → 자료 편집**에서 분류, 문서, 질문과 답안을 작성하고 지원 서류를 첨부합니다. Prep에서 문서를 읽거나 검색해 필요한 답안을 찾을 수 있습니다.
3. 다른 면접으로 바꿀 때는 **자료 교체**를 선택합니다. 진행 중인 연습은 일시 정지 상태로 저장됩니다. 앱을 다시 시작한 뒤에는 **마지막 면접 열기**로 이어갈 수 있습니다.

## Codex로 연습하기 (선택)

1. 앱을 켠 상태에서 Codex CLI로 `interactive-interview`를 등록합니다. MCP는 Codex가 실행 중인 로컬 앱의 도구를 사용하는 연결 방식입니다.

   ```powershell
   codex mcp add interactive-interview --url http://127.0.0.1:4173/mcp
   ```

2. 연습할 면접을 열고 **Prep → Codex 시작 문구 복사**를 선택합니다. 복사한 문구를 빈 새 Codex 대화에 붙여 넣고 안내를 따릅니다. 다른 면접을 연습할 때도 빈 새 대화에서 시작합니다.
3. 말로 연습하려면 Codex에서 Voice를 켜고 앱의 **Chat → Voice 시작 문구**를 사용합니다. **Chat → 답변 기록**에서 답변과 교정을 확인하거나 JSON·CSV로 저장할 수 있습니다.

## 자료 보관과 내보내기

자료, 첨부 파일, 연습 기록은 프로젝트 안의 `data/private/`에 면접별로 저장됩니다. Git은 이 폴더 전체를 추적에서 제외합니다. Codex를 연결하면 연결한 대화에서 해당 면접의 자료를 사용할 수 있습니다.

| 형식 | 용도 |
| --- | --- |
| Prep HTML | 앱을 실행하지 않고 브라우저에서 자료 읽기 |
| `.interviewpack` | 첨부 원본과 함께 백업하거나 다른 곳에서 다시 가져오기. 연습 기록은 내보낼 때 선택 |
| JSON·CSV | **Chat → 답변 기록**에서 연습 내역 보관 |

기존에 Documents의 `InterviewRehearsalData`를 사용했다면 서버를 종료하고 폴더 전체를 `data/private/`로 옮긴 뒤 다시 시작합니다. 대상 폴더에 자료가 있다면 두 폴더를 먼저 확인합니다.

## 개발

- `pnpm dev`로 개발 서버를 실행합니다. 앱 서버의 4173번 포트를 함께 사용하므로 `Start-Interview.ps1`로 켜 둔 서버는 먼저 종료합니다.
- `pnpm test`로 자동 시험을 실행하고 `pnpm build`로 배포용 화면을 빌드합니다.

## 라이선스

앱의 소스 코드는 [MIT 라이선스](LICENSE)로 제공됩니다. 함께 제공되는 [Pretendard 글꼴](src/fonts/LICENSE.txt)은 SIL Open Font License 1.1, [web-artifacts-builder](tools/web-artifacts-builder/LICENSE.txt)는 Apache License 2.0을 따릅니다.
