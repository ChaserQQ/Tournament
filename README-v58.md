# MINI4WD TOURNAMENT MAKER v58 Commercial Stabilization

## 목적
v57까지 누적된 패치성 코드와 중복 선언을 정리한 상용화 전 안정화 버전입니다.

## 주요 정리
- 중복 `function` 선언 제거
- wrapper override 방식 제거
- `openTvView`, `renderDashboardPage` 단일 함수화
- LIVE 로비 실시간 watcher 구조 정리
- 대시보드 경기장/기간/클래스 필터 UI 정리
- 모바일 경기방식 버튼 UX 정리
- 전체 버튼/카드/필터 간격 통일
- `CROW` 표기 제거, `9강 준결 토너먼트` 유지
- `MINI4WD TOURNAMENT MAKER` 하단 크레딧 제거, 크레딧은 별도 작은 영역만 유지

## 적용 순서
1. GitHub `Tournament` 폴더에 ZIP 내용을 전부 덮어쓰기
2. Firebase Realtime Database Rules에 `firebase-rules-v58-commercial-stabilization.json` 적용
3. 브라우저 강력 새로고침
4. 관리자 계정으로 ADMIN 접속
5. LIVE 로비 / 대시보드 / 선수 DB / 경기방식을 순서대로 확인

## 운영 전 필수 확인
- 관리자 대시보드에서 전체 경기장 표시
- 경기장 계정에서 자기 경기장만 표시
- 비로그인 LIVE 로비 실시간 반영
- 모바일 LIVE 링크 복사 후 접속
- 기본 / 포인트전 / 패자부활 / 9강 준결 각각 1회 생성 테스트
