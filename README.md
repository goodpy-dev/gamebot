# 🎮 겜잘알봇

게임 4개씩 순위를 매기는 **취향 테스트**로 나를 분석하고, 그 취향을 이입한 **봇**이 게임 고민("스킬창 UI 가 별로야")에 실제 게임 레퍼런스를 캡처와 함께 계속 내밀어 주는 도구.

- **취향 테스트**: 1부 게임성(표지 4장 순위 × 8판) · 2부 아트(이름 가린 스크린샷 4장 순위 × 4판)
- **결과지**: "당신의 게이머 타입은 ○○" 카드, 취향 레이더, 찰떡·상극 게임, 눈이 가는 그림, 편식 탈출 퀘스트 — PNG·글로 공유
- **질문하기**: 지금 구조와 닮은 게임 짚기 + 닮은 쪽·반대 쪽·엉뚱한 쪽 레퍼런스 카드(Steam 캡처) + 되묻기
- **봇**: 내 취향으로 봇 만들기, 봇 카드 파일(`○○.gamebot.json`)로 친구와 주고받기

## Claude Code 에서 /gamebot 으로 쓰기

Claude Code 채팅에 이걸 붙여넣으면 설치부터 봇 만들기 화면까지 알아서 떠요:

```
겜잘알봇 설치해 줘. https://github.com/goodpy-dev/gamebot 을 ~/gamebot 에 git clone(있으면 git pull) 하고, node ~/gamebot/setup.js --no-open 실행 뒤 http://localhost:9251 을 내장 브라우저로 열어 줘(없으면 --no-open 빼고 실행). 그다음 ~/.claude/skills/gamebot/SKILL.md 를 읽고 0단계대로 내 봇 만드는 걸 도와줘.
```

직접 하려면: 이 폴더를 받아 `node setup.js` (스킬 설치 + 서버 + 브라우저). 그 뒤 아무 프로젝트에서 `/gamebot <고민>`, 봇을 다시 만들거나 고칠 땐 `/gamebot 봇 만들기`·`/gamebot 봇 튜닝 …`, 절차가 맘에 안 들면 `~/.claude/skills/gamebot/SKILL.md` 를 직접 고쳐도 돼요.

전부 내 PC 안에서만 돌아요(내 봇·기록은 `data/`, 아무 데도 안 보냄). API 키 필요 없어요 — 생각은 Claude Code 구독으로. 키가 있으면 취향 테스트 결과지만 AI 로 더 풍성해져요(아래).

## 실행 (취향 테스트·보드 화면)

[Node.js](https://nodejs.org) 18 이상이 필요해요.

- 맥: `start-mac.command` 더블클릭 (처음 한 번 "열 수 없음"이 뜨면 우클릭 → 열기)
- 윈도우: `start-windows.bat` 더블클릭
- 직접: `npm install` 후 `node server.js` → 브라우저 http://localhost:9251

## AI 키 (선택)


- **키 없이**: 무료 규칙 모드로 전부 돌아가요(분석·질문 답이 단순한 규칙 버전).
- **키 있으면**: Anthropic API 키를 이 폴더의 `key.txt` 한 줄에 넣거나 환경변수 `ANTHROPIC_API_KEY` 로. 분석 1번 = AI 호출 2회, 질문 1번 = 2회(웹 검색 포함).
- `key.txt` 는 남에게 폴더를 넘길 때 꼭 지우세요.

## 내 정보는 어디에

`data/` — 취향 프로필, 봇, 질문 보드, 👍/👎 기록. 이 폴더는 공유·git 에서 빠져요.
게임을 만들고 있다면 `context-examples/` 의 두 파일을 `data/` 로 복사해 채우면 봇이 내 게임 구조까지 보고 답해요.

## 문서

기획·규칙·진행 기록: [docs/spec.md](docs/spec.md)
