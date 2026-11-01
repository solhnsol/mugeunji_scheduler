# 작업실 (mugeunji_scheduler)

FastAPI 백엔드(`main.py`, `src/`) + React 19 / Vite / Tailwind v4 프론트엔드(`frontend/`).

## 토큰 아끼기
- **ponytail**이 기본으로 켜져 있다: 가장 작은 완결 변경만 한다.
- 구조 질문은 먼저 **graphify** 결과(`graphify-out/GRAPH_REPORT.md`)를 본다. 없거나 오래됐으면 `/graphify . --update`.
  `graphify-out/`은 커밋하지 않는다(로컬 캐시).

## 디자인 / UI·UX
- 기존 화면 수정은 먼저 `docs/ui-principles.md`의 원칙(레이아웃 안정성, 숨기지 말고 비활성, 고정 하단 액션 바, 앱 셸)을 지킨다.
- 새 화면·랜딩: `frontend-design` 또는 `/hallmark`로 방향을 잡는다. hallmark는 이름을 부를 때만 기존 화면에 쓴다.
- 색·폰트·토큰·접근성 점검: `ui-ux-pro-max`.
- 끝나면 `/ponytail-review`로 군더더기를 걷어낸다.
