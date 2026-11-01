"""이미 배포된 11월 베타 안내 공지를 한 번만 고치는 수정(fix v3) 테스트."""
import asyncio
import os
import tempfile

import aiosqlite

from src.database import setup_database
from src.seed_notices import FIX_V3_KEY, FIX_V3_REPLACEMENTS, NOV_2026_TITLE


async def _run():
    path = os.path.join(tempfile.mkdtemp(), "fix.db")
    async with aiosqlite.connect(path) as conn:
        conn.row_factory = aiosqlite.Row
        await setup_database(conn)
        await conn.commit()
        # 수정 전 상태로 되돌린다: 옛 문장을 가진 공지 + 수정 기록 없음
        old_body = "\n".join(old for old, _ in FIX_V3_REPLACEMENTS)
        await conn.execute("UPDATE notices SET body = ? WHERE title = ?", (old_body, NOV_2026_TITLE))
        await conn.execute("DELETE FROM system_settings WHERE key = ?", (FIX_V3_KEY,))
        await conn.commit()
        await setup_database(conn)
        await conn.commit()
        async with conn.execute("SELECT body FROM notices WHERE title = ?", (NOV_2026_TITLE,)) as cur:
            body = (await cur.fetchone())["body"]
    return body


def test_fix_v3_updates_deployed_notice():
    body = asyncio.run(_run())
    assert "토큰 **8개**" in body and "토큰 **10개**" not in body
    assert '"11월 베타 무료 충전"' in body
