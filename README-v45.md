# MINI4WD TOURNAMENT MAKER v45 FINAL CANDIDATE

기준: v44 ops stability

## 포함 기능
- Firebase LIVE / TV LIVE / 모바일 LIVE
- 비로그인 LIVE 로비
- 승인 경기장 기준 20개 슬롯
- 3시간 미갱신 LIVE 자동 대기 처리
- 최근 경기 히스토리
- 로그인 / 관리자 / 경기장 계정 권한
- 운영 권한 / 대시보드 권한 / 관리자 권한 부여·해제
- 선수 DB: 실명+연락처 기준, 닉네임=표시 선수명
- 공개 데이터 / 비공개 데이터 분리
- TV 16조 표시
- 포인트전 누적 및 TOP 표시
- 운영 잠금 / 조작 로그 / 백업 / 복구
- 클래스: 오픈 / 스톡 / 어드&비맥스 / 기타 클래스

## 적용 방법
1. 이 ZIP 안의 파일 전체를 GitHub `Tournament` 폴더에 덮어쓰기
2. Firebase Realtime Database Rules에 `firebase-rules-v45-final-candidate.json` 내용 적용
3. 관리자 계정으로 접속 후 ADMIN 화면을 1회 열어 경기장 슬롯 동기화 확인
4. 테스트 체크리스트 순서대로 점검

## 주의
- 기존 과거 데이터는 자동 삭제하지 않음
- 공개 LIVE/히스토리에는 닉네임 중심 데이터만 사용하도록 구성
- 실명/연락처는 선수 DB 및 비공개 결과 영역 기준
