# 공지 에이전트 API

에이전트(스크립트·AI)가 공지·이용 안내를 올리고 고치는 API. 관리자 → 공지 탭 → "에이전트로 올리기"에서 키를 발급한다.

- 인증: `Authorization: Bearer ntc_...` (쿠키 로그인은 받지 않는다). 키는 해시만 저장되며 발급 직후 한 번만 볼 수 있다. 재발급하면 이전 키는 즉시 무효.
- 이 키로 할 수 있는 일은 공지 작성·수정·삭제·조회뿐이다. 회원·토큰·예약 등 다른 API는 쓸 수 없다.
- 에이전트가 만든 글(`created_by: "agent"`)은 `published`를 생략하면 **초안**이다. 관리자가 검토해 공개한다. 바로 공개하려면 `"published": true`.

## 엔드포인트
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/agent/notices` | 초안 포함 전체 목록 (본문 제외) |
| GET | `/api/agent/notices/{id}` | 한 건 (본문 포함) |
| POST | `/api/agent/notices` | 새 글 |
| PUT | `/api/agent/notices/{id}` | 일부 필드 수정 (보낸 필드만 바뀐다) |
| DELETE | `/api/agent/notices/{id}` | 삭제 |

## 필드
- `title` (필수, 1~100자), `body` (마크다운, 최대 20000자)
- `category`: `notice`(공지) | `guide`(이용 안내), 기본 `notice`
- `visibility`: `public`(로그인 전에도 보임) | `members`(회원 전용), 기본 `members`
- `pinned`: 상단 고정, 기본 false
- `published`: 공개 여부, 기본 false

본문 마크다운은 HTML을 해석하지 않는다. 지원: `# ## ###` 제목, `**굵게**`, `*기울임*`, `` `코드` ``, `[글자](링크)`(http(s)·사이트 안 경로만), `-` 목록, `1.` 목록, `>` 인용, `---`, 파이프 표.

## 예시
```bash
curl -X POST https://<사이트>/api/agent/notices \
  -H "Authorization: Bearer $NOTICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"이용 방법","body":"# 순서\n1. 토큰 충전\n2. 달력에서 예약","category":"guide","visibility":"public","published":true}'
```
