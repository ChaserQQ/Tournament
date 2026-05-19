# MINI4WD TOURNAMENT MAKER

GitHub Pages용 단일 HTML 버전입니다.

## 필수 파일
- index.html
- geeks-logo.webp

## 주요 기능
- 3레인 / 5레인 대회
- 레인 수에 따라 3차 또는 5차 라운드 자동 구성
- 각 라운드: 예선 → 본선 → 준결승 → 라운드 결승
- 참가자 수에 따라 준준결승 또는 추가 예선 단계 자동 추가
- 차수별 라운드 탭 구성
- 최종 결승 영역 상단 고정
- TV 라이브 화면: 현재 송출 단계만 표시
- 운영자 화면 변경 시 같은 PC의 TV 화면 자동 갱신
- 크롬캐스트 송출용 전체화면 지원
- 모바일 공유 링크는 스냅샷 방식
- 팀킬 방지 단계 선택
- 같은 레인 방지 기능
- 선수 DB / 오늘 참가자 선택 기능
- 선수 명부 CSV / JSON 백업

## 페이지
- 기본: 대진 운영 페이지
- #view=db : 선수 DB 페이지
- #view=tv-live : TV 라이브 페이지

## 배포
1. GitHub 저장소 루트에 index.html, geeks-logo.webp를 업로드합니다.
2. Settings > Pages > Deploy from a branch
3. Branch: main / Folder: root 선택

## v6 visual refined
- 폰트 체계 및 크기 단계 정리
- 제작자 표기 위치를 MINI 4WD TOURNAMENT MAKER 옆으로 이동
- 운영/DB/TV 화면 카드와 패널 디자인 정리

## v7 pro mobile
- 전체 UI 톤 정리
- 모바일에서 운영/DB/TV 화면 반응형 개선
- 선수 DB 테이블 모바일 카드형 전환
- 툴바/탭/카드/버튼 컴포넌트 정리

## v8 numeric mobile compact
- 조 표기: A조/B조/C조 → 1조/2조/3조
- 모바일 횡스크롤 방지
- 모바일 종스크롤 압축
- 모바일 카드/슬롯/툴바 크기 재조정

## v9 current stage + TV readability
- 현재 진행 단계가 항상 최상단에 표시
- 과거 단계는 아래 "과거 경기 기록" 접힘 영역으로 이동
- 다음 단계 생성 시 현재 단계 위치로 자동 이동
- TV 화면 레인 번호와 선수명 사이 여백/구분선 강화

## KakaoTalk preview
- og-image.png 파일을 포함했습니다.
- 카카오톡 링크 미리보기용 Open Graph 태그가 index.html에 추가되었습니다.
- GitHub Pages에 index.html, geeks-logo.webp, og-image.png를 함께 업로드하세요.
- 미리보기가 바로 바뀌지 않으면 카카오 OG 캐시 초기화가 필요할 수 있습니다.
