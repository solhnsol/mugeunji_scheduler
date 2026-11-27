"""오류 신고와 월별 이용 통계.

- 신고: 회원이 설명과 함께 보낸다. 디버깅용 정보(화면 경로, 기기, 최근 오류 기록)는 context JSON으로 받아 그대로 저장한다.
  개인정보는 아이디 외에 받지 않고, 90일이 지나면 지운다.
- 통계: 별도 기록 없이 bookings 표(취소된 예약도 남는다)에서 계산한다.
"""
import calendar
import json
from datetime import date, timedelta
from typing import Dict, List, Optional

import aiosqlite

from src.automation_config import now_kst

# 급한 유형은 화면에서 오픈채팅 연락을 먼저 안내한다
CATEGORIES = {"charge": "입금했는데 충전이 안 돼요", "booking": "예약이 안 돼요", "bug": "화면이 이상해요", "other": "그 밖의 문제"}
URGENT = ("charge", "booking")
MAX_MESSAGE = 1000
MAX_CONTEXT = 20000
MAX_PER_HOUR = 5
KEEP_DAYS = 90


class ReportError(Exception):
    """사용자에게 그대로 보여줄 수 있는 오류."""


async def create_report(conn: aiosqlite.Connection, username: str, category: str, message: str, page: str, context: Dict) -> int:
    if category not in CATEGORIES:
        raise ReportError("신고 유형을 골라주세요.")
    message = message.strip()
    if not message:
        raise ReportError("어떤 문제인지 적어주세요.")
    blob = json.dumps(context, ensure_ascii=False)
    if len(blob) > MAX_CONTEXT:
        raise ReportError("함께 보낼 정보가 너무 커요.")
    now = now_kst()
    hour_ago = (now - timedelta(hours=1)).isoformat()
    async with conn.execute("SELECT COUNT(*) FROM error_reports WHERE username = ? AND created_at > ?", (username, hour_ago)) as cur:
        if (await cur.fetchone())[0] >= MAX_PER_HOUR:
            raise ReportError("신고를 너무 많이 보냈어요. 잠시 뒤에 다시 해주세요.")
    await conn.execute("DELETE FROM error_reports WHERE created_at < ?", ((now - timedelta(days=KEEP_DAYS)).isoformat(),))
    cur = await conn.execute(
        "INSERT INTO error_reports (username, category, message, page, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (username, category, message[:MAX_MESSAGE], page[:200], blob, now.isoformat()),
    )
    await conn.commit()
    return cur.lastrowid


async def list_reports(conn: aiosqlite.Connection, status: str = "open", limit: int = 100) -> Dict:
    where, params = ("WHERE r.status = ?", [status]) if status in ("open", "done") else ("", [])
    async with conn.execute(
        f"""SELECT r.*, COALESCE(NULLIF(TRIM(u.name), ''), r.username) AS display
            FROM error_reports r LEFT JOIN users u ON u.username = r.username
            {where} ORDER BY r.id DESC LIMIT ?""",
        (*params, limit),
    ) as cur:
        rows = await cur.fetchall()
    async with conn.execute("SELECT COUNT(*) FROM error_reports WHERE status = 'open'") as cur:
        open_count = (await cur.fetchone())[0]
    items = [
        {
            "id": r["id"], "username": r["username"], "name": r["display"], "category": r["category"],
            "category_label": CATEGORIES.get(r["category"], r["category"]), "urgent": r["category"] in URGENT,
            "message": r["message"], "page": r["page"], "status": r["status"], "created_at": r["created_at"],
            "context": json.loads(r["context"] or "{}"),
        }
        for r in rows
    ]
    return {"items": items, "open_count": open_count}


async def set_status(conn: aiosqlite.Connection, report_id: int, status: str) -> bool:
    cur = await conn.execute("UPDATE error_reports SET status = ? WHERE id = ?", (status, report_id))
    await conn.commit()
    return cur.rowcount > 0


async def booking_stats(conn: aiosqlite.Connection, month: Optional[str] = None) -> Dict:
    """month(YYYY-MM)의 이용 통계. 예약 칸 수 기준이고, 시간 범위는 하루 24시간으로 본다."""
    today = now_kst().date()
    try:
        year, mon = (int(x) for x in (month or today.strftime("%Y-%m")).split("-"))
        first = date(year, mon, 1)
    except ValueError:
        raise ReportError("월은 2026-12 형식으로 입력해주세요.")
    days = calendar.monthrange(year, mon)[1]
    last = first.replace(day=days)
    async with conn.execute(
        """SELECT b.booking_date, b.hour, b.cost, b.status, b.refunded, b.username, b.created_by,
                  COALESCE(NULLIF(TRIM(u.name), ''), b.username) AS display
           FROM bookings b LEFT JOIN users u ON u.username = b.username
           WHERE b.booking_date >= ? AND b.booking_date <= ?""",
        (first.isoformat(), last.isoformat()),
    ) as cur:
        rows = await cur.fetchall()
    async with conn.execute("SELECT DISTINCT substr(booking_date, 1, 7) m FROM bookings ORDER BY m DESC") as cur:
        months = [r["m"] for r in await cur.fetchall()]

    active = [r for r in rows if r["status"] == "active"]
    cancelled = [r for r in rows if r["status"] != "active"]
    by_hour = [0] * 24
    by_weekday = [0] * 7  # 월요일부터
    per_member: Dict[str, Dict] = {}
    for r in active:
        by_hour[r["hour"]] += 1
        by_weekday[date.fromisoformat(r["booking_date"]).weekday()] += 1
        m = per_member.setdefault(r["username"], {"name": r["display"], "hours": 0, "spent": 0})
        m["hours"] += 1
        m["spent"] += r["cost"]
    top: List[Dict] = sorted(per_member.values(), key=lambda m: (-m["hours"], m["name"]))[:5]
    return {
        "month": first.strftime("%Y-%m"),
        "months": months,
        "capacity_hours": days * 24,
        "booked_hours": len(active),
        "utilization": round(len(active) / (days * 24) * 100, 1),
        "cancelled_hours": len(cancelled),
        "members": len(per_member),
        # 토큰은 쓴 만큼에서 돌려준 만큼을 뺀 순사용량
        "tokens_used": sum(r["cost"] for r in rows) - sum(r["refunded"] for r in cancelled),
        # 관리자가 회원 대신 넣은 예약
        "admin_hours": sum(1 for r in active if r["created_by"] != r["username"]),
        "by_hour": by_hour,
        "by_weekday": by_weekday,
        "top_members": top,
    }
