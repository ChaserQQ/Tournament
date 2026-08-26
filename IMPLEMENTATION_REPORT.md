# Implementation Overview

이 문서는 현재 구현의 구조와 주요 안전장치를 설명한다. 최신 빌드 번호와 배포 상태는 src/core/build.js, Git, GitHub Pages와 AGENT_MEMORY.md에서 확인한다.

## Product shape

- 별도 서버 렌더링 없이 동작하는 정적 토너먼트 운영 앱이다.
- Firebase Authentication과 RTDB를 계정, 대회 상태, LIVE, 결과 기록에 사용한다.
- 운영자, 선수 DB, 관리자, 대시보드, LIVE 로비, 모바일 LIVE, TV LIVE, 출력 화면을 제공한다.
- 지원 경기 방식은 basic, points3, points5Tree, revival, crow이다.

## Source ownership

- src/app.js: 대회 상태, 경기 진행, Firebase 동기화, 화면 렌더링
- src/core/build.js: 릴리스와 공개 자산 버전의 기준
- src/styles/app.css: 공통·데스크톱·화면별 스타일
- src/styles/operator-mobile.css: app.css 뒤에 적용되는 모바일 운영자 스타일
- database.rules.json: RTDB 쓰기와 공개 읽기 규칙
- tools/: 정적 검증, 결과·대진·관리자·운영자·화면·규칙 QA

## Tournament safeguards

- 대회 시작부터 첫 저장까지 venue, tournament ID, registry generation과 lease fence를 확인한다.
- 진행 중 의미 있는 변경은 로컬 mutation 기록을 남겨 새로고침 후 안전하게 재생하거나 충돌로 종료한다.
- 종료, 자동 종료, 복구, 되돌리기와 snapshot은 같은 대회 인스턴스인지 다시 확인한다.
- 그룹과 포인트 단계는 모든 활성 조의 결과가 완결되어야 다음 단계로 진행한다.
- 동점 컷은 수렴하는 순위 결정 단계로 이어지고 no-finalist 결과도 정상 처리한다.

## Operation and LIVE safeguards

- 인증된 운영자의 쓰기 권한은 Firebase 서버 lease 하나가 결정한다.
- 레거시 로컬 operationLock은 서버 lease 소유자를 차단하지 않는다.
- LIVE 공개 상태는 명시적 허용 목록으로 만들며 비공개 참가자 정보와 전체 state를 내보내지 않는다.
- private state, public LIVE, active registry는 동일 generation과 fence를 기준으로 수렴한다.
- 모바일과 TV viewer는 읽기 전용이며 오래된 쓰기로 현재 라운드나 결승이 되돌아가지 않도록 한다.

## Interface structure

- 운영 화면은 현재 상태, 라운드 선택, 현재 경기, 다음 행동 순서로 구성한다.
- 설정과 기타는 정적 보조 영역이며 중복 현재 경기·큐·LIVE 상태 패널을 만들지 않는다.
- 모바일 운영 도크는 동일한 네 열을 사용한다.
- 선수 DB와 관리자는 데스크톱과 모바일에서 같은 데이터를 한 번만 렌더링한다.
- 세부 규칙은 UI_REDESIGN_BRIEF.md에 둔다.

## Release and verification

- 공개 빌드와 자산 버전은 src/core/build.js와 index.html이 일치해야 한다.
- 표적 QA로 수정 중 빠르게 검증하고 공개 릴리스 전 npm.cmd run qa:all을 실행한다.
- Firebase 규칙 변경은 emulator 규칙 QA를 먼저 통과한 뒤 앱과의 호환 배포 순서를 정한다.
- 배포 후 정확한 main HEAD의 Pages 성공과 공개 버전 자산을 확인한다.
