# v58 Commercial Stabilization Audit

## 정적 점검 결과

- JavaScript syntax check: PASS
- Firebase Rules JSON parse: PASS
- Duplicate function declarations: 0
- Wrapper function assignment overrides: 0
- Inline onclick unresolved functions: 0
- Legacy `CROW` visible label: 0
- Legacy `made by GEEKS 마이`: 0
- Credit text `made by GEEKS M.Y`: 1

## 정리한 핵심 리스크

1. 누적 패치로 동일 함수가 여러 번 선언되던 문제 제거
2. wrapper override 방식으로 동작하던 대시보드/TV 함수 단일화
3. 모바일 경기방식 버튼 UX 통일
4. LIVE 로비 실시간 반영 구조 정리
5. 대시보드 관리자 기본 전체 경기장 기준 유지
6. 공개 데이터/비공개 데이터 Rules 구조 유지

## 실제 운영 테스트 권장 순서

1. 비로그인 `#view=live-list` 접속
2. 관리자 로그인
3. 경기장 계정 승인
4. 선수 DB 등록
5. 기본 토너먼트 생성
6. 포인트전 생성
7. 패자부활 생성
8. 9강 준결 토너먼트 생성
9. 모바일 LIVE 링크 복사
10. TV LIVE 송출
11. 대시보드 전체 경기장 확인
12. 경기장 계정으로 자기 경기장만 보이는지 확인
13. 대회 종료 후 공개 히스토리/대시보드 반영 확인
