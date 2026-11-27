# 테스트 서버(스테이징)와 정식 전환

## 정식 토큰제 자동 전환
- 기본 전환 시각은 **2026-11-30 13:00 (KST)**. 서버가 30초마다 확인하고, 재시작해도 시작할 때 한 번 더 확인한다.
- 시각이 지나면 한 번만: 월 신청이 점유한 남은 시간을 비용 0 토큰 예약(`created_by='monthly-switch'`)으로 옮기고,
  0원 충전 상품(베타 무료 충전)을 닫고, 예약 방식을 `token`으로 바꾼다. 끝나면 전환 시각을 비운다.
- 관리자 → 토큰 → 예약 방식에서 시각을 바꾸거나 "예약 없애기"로 취소할 수 있다.
- 환경 변수 `TOKEN_SWITCH_AT`(ISO, 비우면 예약 없음)은 **처음 DB를 만들 때** 기본값으로만 쓰인다.
- 한계: 월 신청 보호는 베타 모드에서만 동작한다. 월 신청 대상 달의 남은 날짜 전체가 옮겨진다.

## 테스트 서버 만들기 (Render)
실서비스와 DB가 겹치지 않는 별도 서비스를 하나 더 만든다.
1. Render → New → Web Service → 같은 저장소, Docker. 이름 예: `mugeunji-staging`. Auto-Deploy는 끄고, 필요하면 수동 배포.
2. Disk 추가(예: 1GB, 마운트 `/app/data`)해 실서비스와 따로 둔다.
3. 환경 변수: `ADMIN_PASSWORD`, `SECRET_KEY`(실서비스와 다른 값), `TOKEN_SWITCH_AT=` (빈 값).
4. 처음 한 번 Shell에서 `python scripts/seed_dummy.py data/reservation.db --reset` 로 테스트 계정·상품을 채운다.
   (관리자 비밀번호는 서비스의 `ADMIN_PASSWORD`, 나머지 테스트 계정 비밀번호는 123456)
5. 전환 리허설: 관리자 → 토큰 → 예약 방식을 "베타"로 두고 전환 시각을 몇 분 뒤로 저장 → 시각 이후 회원 화면과 충전 상품을 확인.
실서비스 DB 백업은 `scripts/backup_db.py`, 개인정보를 가린 사본이 필요하면 `scripts/anonymize_db.py`.
