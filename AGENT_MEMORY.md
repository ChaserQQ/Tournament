# Agent Memory

이 문서는 압축된 프로젝트 인수인계 정보다. 작업 규칙은 AGENTS.md를 따르고, 변동 가능한 사실은 현재 Git, 빌드 메타데이터, GitHub Pages, 필요한 경우의 Firebase에서 다시 확인한다.

## Project identity

- Verified 2026-08-26 KST: workspace는 C:\Users\rlaal\Desktop\mtm이다.
- 저장소는 ChaserQQ/Tournament이며 기본 배포 브랜치는 main이다.
- 공개 URL은 https://chaserqq.github.io/Tournament/ 이다.
- 정적 프론트엔드와 Firebase RTDB로 구성되며 주 런타임은 src/app.js이다.

## Standing user instructions

- 사용자에게는 한국어로 설명한다.
- 사용자가 수정, 작업, 적용, 구현을 요청하기 전에는 코드를 바꾸지 않는다.
- 승인된 공개 앱 수정은 범위 내 구현, QA, 커밋, main 반영, Pages와 공개 자산 확인까지 마친다.
- Firebase 규칙과 운영 데이터 쓰기는 별도 요청이 있을 때만 수행하며 활성 대회를 보호한다.
- 다른 작업의 리팩터링은 실제 diff와 현재 main의 호환성을 확인한 뒤 통합한다.
- 관련 없는 변경과 추적되지 않은 사용자 파일을 보존한다.
- 중단된 데일리 체크는 명시적으로 재개하라는 요청 전까지 유지한다.

## Current verified state

- Verified 2026-08-29 KST: 현재 릴리스 소스는 v283, BUILD v283 LIVE LOBBY USABILITY이다.
- build, app, 두 CSS 자산 버전은 283이고 config는 156이다.
- RTDB write protocol은 279이며 v283에서는 Firebase 규칙과 운영 데이터를 변경하지 않았다.
- 라이브 로비는 승인 경기장 카드만 전체 카드로 표시하고 나머지 빈 슬롯은 접힌 목록으로 축약한다. 20슬롯 계약은 data-v283-total-slots로 유지한다.
- npm.cmd run qa:all이 v283에서 통과했고 실데이터 PC, 390px, 320px 라이브 로비를 별도로 확인했다.
- 현재 소스 기준 파일은 src/app.js, src/core/build.js, src/styles/app.css, src/styles/operator-mobile.css, tools/verify-static.js와 tools 아래 QA 스크립트다.
- 보존할 추적되지 않은 항목은 .codex-remote-attachments/, DESIGN_OUTPUT.md, FIREBASE_REPORT.md, QA_REPORT.md이다.

## Validation checklist

- 문서만 바뀌면 문서 참조, git diff --check, 빌드 메타데이터 비변경을 확인한다.
- 앱 변경은 npm.cmd run verify와 npm.cmd run qa:audit을 기본으로 한다.
- 대진, 점수, 진출, 결승 변경은 qa:result, qa:match, qa:operator를 실행한다.
- 운영권, 복구, LIVE 변경은 qa:operator와 qa:surface를 실행한다.
- 관리자와 선수 DB 변경은 qa:admin을 실행한다.
- Firebase 규칙 변경은 qa:rules와 qa:all을 실행한다.
- 공개 릴리스는 최종 npm.cmd run qa:all, 변경 JS/CJS의 node --check, git diff --check를 통과해야 한다.
- 배포 후 정확한 HEAD의 Pages 성공과 캐시 우회 공개 index 및 버전 자산을 확인한다.

## Firebase and data safety

- 일상 QA는 Firebase stub과 emulator를 사용한다.
- 실제 장애 진단에 필요한 읽기 전용 점검은 최소 경로만 조회하고 결과를 요약·비식별화한다.
- 라이브 쓰기 전에는 활성 pointer, pending claim, 유효 lease를 확인하고 대상 노드를 백업한다.
- 삭제와 복구는 정확한 대회 ID, 경기장 ID, generation, fence를 기준으로 한다.
- 비밀값, 토큰, 인증 코드, 원시 내보내기, 개인 계정 정보를 메모와 보고서에 남기지 않는다.
- 공개 LIVE payload는 허용 목록 DTO이며 전체 비공개 state를 포함할 수 없다.

## Recent durable changes

- 2026-08-29 v283: LIVE 로비의 20슬롯 데이터 계약은 유지하되 승인 경기장이 없는 슬롯은 접힌 축약 목록으로 옮겼다. 뒤로가기·홈·기록·새로고침 이동을 추가하고 모바일 상단 이동, 경기 카드, 운영 화면의 핵심 터치 영역을 44px로 맞췄다. 320px 요약 문구와 12px 카드 메타 가독성을 QA로 고정했다.
- 2026-08-28 v282: 승인된 venue 계정은 초안 운영 화면 진입 시 비어 있는 서버 lease를 자동 획득한다. 서버 상태를 운영권 보유·획득 중·없음으로 정확히 표시하고 비동기 획득 뒤 가져오기·해제 버튼을 즉시 동기화한다. 관리자 계정, 대회 종료, 명시적 해제 뒤에는 자동 재획득하지 않는다.
- 2026-08-28 verified live Firebase cleanup: `activeTournaments/아테네월드`가 없고 pending claim과 유효 lease가 없음을 확인한 뒤, 2026-08-21에 만료된 레거시 `operationLocks/leases/아테네월드`만 저장소 밖에 원본 백업하고 제거했다. 아테네월드 계정 프로필과 공개 경기장 디렉터리는 변경하지 않았고 앱·규칙 버전도 그대로다.
- 2026-08-26 instruction refresh: AGENTS.md를 영구 규칙의 기준으로 신설하고, 프로젝트 메모·작업 큐·구현 개요·UI 계약에서 버전 중복과 과거 역할 지침을 제거했다. 배포 실행 번호를 기록하기 위한 사후 커밋도 중단한다.
- 2026-08-26 v281: 인증 운영자는 Firebase 서버 lease만 쓰기 권한으로 사용한다. 복원된 레거시 operationLock은 자동 폐기되며 서버 lease 소유자를 차단하지 않는다. 중복 운영권 UI를 한 패널로 합쳤다.
- 2026-08-26 v280: 실제 그룹 수에 맞는 단계 계획, 모든 조의 진출자 선택, 포인트 점수 완결성, 동점 플레이오프 수렴, 크로우 준결승 조별 1명 진출을 보장했다. 3/5레인 174개 계획 조합을 QA한다.
- 2026-08-22 v279: RTDB write protocol 279와 규칙이 venue, generation, fence, sequence, lease, active registry, 공개·비공개 기록 연결을 강제한다. 서버 시간 기준 lease와 21개 규칙 허용·거부 계약을 검증했다.
- 2026-08-22 v278: 대회 시작, 진행 중 mutation WAL, 종료·자동 종료, 되돌리기, snapshot, 원격 복구가 정확한 대회 인스턴스와 fence를 사용한다. 공개 LIVE는 명시적 DTO로 비식별화된다.
- 2026-07 v274-v276: 새로고침 시 참가자 순서를 보존하고, 진출자가 없는 라운드를 정상 종료로 허용하며, 수동 조 편성은 실제 첫 생성 단계에만 적용한다.
- v236-v266: 운영 화면 중복 구조를 줄이고 설정·기타를 정적 영역으로 정리했으며 모바일 도크를 네 열로 통일하고 한 단계 되돌리기를 추가했다.

## Known traps

- 커밋 SHA, Pages 실행, 공개 자산, Firebase 활성 상태는 변동 정보다. 문서 값보다 현재 상태를 우선한다.
- src/app.js의 높은 버전 접미 함수도 활성 호환 코드일 수 있으므로 이름만 보고 제거하지 않는다.
- src/styles/operator-mobile.css는 src/styles/app.css 뒤에 로드된다.
- LIVE 로비의 20슬롯 계약과 렌더링된 전체 카드 수는 같지 않다. 승인 경기장 카드는 전체 카드, 빈 슬롯은 접힌 data-v283-empty-slot 목록으로 검사한다.
- 인증 운영자의 권한은 서버 lease 하나다. 레거시 operationLock을 다시 쓰기 차단 조건으로 사용하면 안 된다.
- 운영권 판정과 LIVE 쓰기는 정확한 venue, tournament, generation, fence와 sequence를 함께 확인해야 한다.
- 수동 조 수는 첫 생성 단계 제약이며 단계 이름이 예선인지로 판단하면 안 된다.
- no-finalist는 유효한 결과이므로 최소 한 명의 진출자를 전역 조건으로 강제하면 안 된다.
- 새로고침 복구는 안정화된 참가자 텍스트와 순서를 유지해야 한다.
- 지연된 LIVE 쓰기는 최신 진행 상태를 되돌릴 수 없으며 viewer route는 운영자 상태를 게시할 수 없다.
- 같은 경기장의 승인 운영자 신뢰 범위는 RTDB만으로 완전히 좁히기 어렵다. 서버 측 writer 또는 신뢰 가능한 content hash가 후속 보강 대상이다.
- 레거시 승인 경기장 프로필은 명시적 venueId를 유지해야 한다.
- GitHub 레거시 Pages가 main 푸시 실행을 만들지 않으면 상태 확인 후 수동 build 요청이 한 번 필요할 수 있다.

## Next cleanup targets

- terminal 결과 게시를 서버 측 writer 또는 신뢰 가능한 content hash로 강화한다.
- 새로 발견되는 레거시 승인 프로필의 venueId를 지속 검증한다.
- 남은 모든 쓰기 경로의 정확한 lease fence 검증과 route/auth listener 정리를 이어간다.
- src/app.js는 책임 경계가 안정된 영역부터 단계적으로 분리하며 광범위 재작성은 피한다.
- 버전별 CSS 누적층을 화면 단위로 소유 규칙에 통합한다.
- inline onclick과 onchange를 중앙 이벤트 바인딩으로 점진적으로 교체한다.
