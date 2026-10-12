"""공지·이용 안내.

- 관리자가 화면에서 쓰거나, 에이전트가 API 키로 올린다. 본문은 간단한 마크다운(HTML 불가)이다.
- 공개 범위: public(로그인 전에도 보임) / members(로그인한 회원만).
- 에이전트가 올린 글은 기본이 비공개(초안)이고, 관리자가 검토해 공개하거나 에이전트가 published=true로 올린다.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import aiosqlite

KST = timezone(timedelta(hours=9))

CATEGORIES = {"notice": "공지", "guide": "이용 안내"}
VISIBILITIES = ("public", "members")
MAX_TITLE = 100
MAX_BODY = 20000
MAX_NOTICES = 500
KEY_SETTING = "notice_api_key_hash"


def _now() -> str:
    return datetime.now(KST).isoformat()


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class NoticeError(Exception):
    """사용자에게 그대로 보여줄 수 있는 오류."""


def _row(row, with_body: bool) -> Dict:
    data = {
        "id": row["id"],
        "title": row["title"],
        "category": row["category"],
        "category_label": CATEGORIES.get(row["category"], row["category"]),
        "visibility": row["visibility"],
        "pinned": bool(row["pinned"]),
        "published": bool(row["published"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
        "created_by": row["created_by"],
    }
    if with_body:
        data["body"] = row["body"]
    return data


def _validate(title: str, body: str, category: str, visibility: str) -> Tuple[str, str]:
    title = (title or "").strip()
    body = (body or "").strip()
    if not title or len(title) > MAX_TITLE:
        raise NoticeError(f"제목은 1~{MAX_TITLE}자로 입력해주세요.")
    if len(body) > MAX_BODY:
        raise NoticeError(f"본문은 {MAX_BODY}자 이하로 입력해주세요.")
    if category not in CATEGORIES:
        raise NoticeError("분류는 notice(공지) 또는 guide(이용 안내)여야 합니다.")
    if visibility not in VISIBILITIES:
        raise NoticeError("공개 범위는 public 또는 members여야 합니다.")
    return title, body


class NoticeManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def list(
        self, *, include_drafts: bool = False, members: bool = False, category: Optional[str] = None, limit: int = 200
    ) -> List[Dict]:
        query = "SELECT * FROM notices WHERE 1=1"
        params: List = []
        if not include_drafts:
            query += " AND published = 1"
        if not members:
            query += " AND visibility = 'public'"
        if category:
            query += " AND category = ?"
            params.append(category)
        query += " ORDER BY published DESC, pinned DESC, COALESCE(published_at, created_at) DESC, id DESC LIMIT ?"
        params.append(limit)
        async with self.conn.execute(query, params) as cursor:
            return [_row(r, with_body=False) for r in await cursor.fetchall()]

    async def get(self, notice_id: int, *, include_drafts: bool = False, members: bool = False) -> Optional[Dict]:
        async with self.conn.execute("SELECT * FROM notices WHERE id = ?", (notice_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return None
        if not include_drafts and not row["published"]:
            return None
        if not members and row["visibility"] != "public":
            return None
        return _row(row, with_body=True)

    async def create(
        self,
        *,
        title: str,
        body: str,
        category: str = "notice",
        visibility: str = "members",
        pinned: bool = False,
        published: bool = False,
        created_by: str,
    ) -> Dict:
        title, body = _validate(title, body, category, visibility)
        async with self.conn.execute("SELECT COUNT(*) FROM notices") as cursor:
            if (await cursor.fetchone())[0] >= MAX_NOTICES:
                raise NoticeError(f"공지는 최대 {MAX_NOTICES}개까지 둘 수 있어요. 오래된 글을 지워주세요.")
        now = _now()
        cursor = await self.conn.execute(
            """INSERT INTO notices (title, body, category, visibility, pinned, published, created_at, updated_at, published_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, body, category, visibility, int(pinned), int(published), now, now, now if published else None, created_by),
        )
        await self.conn.commit()
        return await self.get(cursor.lastrowid, include_drafts=True, members=True)

    async def update(self, notice_id: int, fields: Dict) -> Dict:
        current = await self.get(notice_id, include_drafts=True, members=True)
        if not current:
            raise NoticeError("공지를 찾을 수 없습니다.")
        merged = {**current, **{k: v for k, v in fields.items() if v is not None}}
        title, body = _validate(merged["title"], merged["body"], merged["category"], merged["visibility"])
        published_at = current["published_at"]
        if merged["published"] and not current["published"]:
            published_at = _now()  # 공개 시점을 목록 정렬 기준으로 쓴다
        await self.conn.execute(
            """UPDATE notices SET title = ?, body = ?, category = ?, visibility = ?, pinned = ?, published = ?,
                      published_at = ?, updated_at = ? WHERE id = ?""",
            (title, body, merged["category"], merged["visibility"], int(merged["pinned"]), int(merged["published"]),
             published_at, _now(), notice_id),
        )
        await self.conn.commit()
        return await self.get(notice_id, include_drafts=True, members=True)

    async def delete(self, notice_id: int) -> None:
        cursor = await self.conn.execute("DELETE FROM notices WHERE id = ?", (notice_id,))
        await self.conn.commit()
        if cursor.rowcount == 0:
            raise NoticeError("공지를 찾을 수 없습니다.")

    # ---------- 에이전트 API 키 ----------
    async def key_status(self) -> Dict:
        async with self.conn.execute("SELECT value FROM system_settings WHERE key = ?", (KEY_SETTING,)) as cursor:
            row = await cursor.fetchone()
        return {"has_key": bool(row and row["value"])}

    async def rotate_key(self) -> str:
        """새 키를 만들고 해시만 저장한다. 평문은 이 호출의 반환값으로만 볼 수 있다."""
        key = "ntc_" + secrets.token_urlsafe(32)
        await self.conn.execute(
            """INSERT INTO system_settings (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (KEY_SETTING, hash_key(key)),
        )
        await self.conn.commit()
        return key

    async def revoke_key(self) -> None:
        await self.conn.execute("UPDATE system_settings SET value = '' WHERE key = ?", (KEY_SETTING,))
        await self.conn.commit()

    async def verify_key(self, key: str) -> bool:
        async with self.conn.execute("SELECT value FROM system_settings WHERE key = ?", (KEY_SETTING,)) as cursor:
            row = await cursor.fetchone()
        stored = (row["value"] if row else "") or ""
        return bool(stored) and bool(key) and hmac.compare_digest(stored, hash_key(key))
