"""날짜·시간 단위 토큰 예약.

- 예약은 (날짜, 시간) 한 칸이 한 건이고, 같은 칸은 한 명만 가질 수 있다.
- 칸마다 시간대별 토큰 비용(가격표)이 있고, 예약하면 장부에서 차감한다.
- 취소하면 환불 정책(시작까지 남은 시간별 단계)에 따라 일부 또는 전액을 돌려준다.
- 가격표와 환불 정책은 system_settings에 JSON으로 저장해 관리자가 바꿀 수 있다.
- 예약 가능 범위: 오늘 이후 ~ 이번 달 말, 다음 달은 기존 월 예약 오픈 시각 이후 전체.
"""
import calendar
import json
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import aiosqlite

from src.automation_config import KST, ScheduleConfig, get_current_monthly_open, now_kst
from src.settings import SettingsManager
from src.tokens import TokenManager

MODE_LEGACY = "legacy"
MODE_TOKEN = "token"

# 새벽 시간대 (회원별 허용 체크 대상)
DAWN_HOURS = (0, 1, 2, 3)

MAX_SLOTS_PER_REQUEST = 168

# 기본 가격표: [시작 시, 끝 시(미포함), 1시간당 토큰]
DEFAULT_PRICE_BANDS = [
    {"start": 0, "end": 4, "cost": 1},
    {"start": 4, "end": 8, "cost": 0},
    {"start": 8, "end": 12, "cost": 1},
    {"start": 12, "end": 16, "cost": 2},
    {"start": 16, "end": 24, "cost": 4},
]

# 기본 환불 정책: 시작 전까지 언제든 100% (이후 단계를 추가해 강화할 수 있다)
DEFAULT_REFUND_TIERS = [{"hours_before": 0, "percent": 100}]

SETTING_PRICE_BANDS = "token_price_bands"
SETTING_REFUND_TIERS = "token_refund_tiers"
SETTING_MODE = "reservation_mode"


class BookingError(Exception):
    """사용자에게 그대로 보여줄 수 있는 예약 오류."""


def validate_price_bands(bands) -> List[Dict]:
    """가격표 검증: 0~24시를 빈틈·겹침 없이 덮고, 비용은 0 이상의 정수."""
    if not isinstance(bands, list) or not bands:
        raise BookingError("가격표에 구간을 한 개 이상 넣어주세요.")
    cleaned = []
    for band in bands:
        try:
            start, end, cost = int(band["start"]), int(band["end"]), int(band["cost"])
        except (KeyError, TypeError, ValueError):
            raise BookingError("가격표 구간은 시작·끝·비용(정수)이 필요해요.")
        if not (0 <= start < end <= 24):
            raise BookingError("가격표 구간의 시간은 0~24 사이이고 시작이 끝보다 앞서야 해요.")
        if cost < 0 or cost > 1000:
            raise BookingError("가격표 비용은 0 이상 1000 이하의 정수여야 해요.")
        cleaned.append({"start": start, "end": end, "cost": cost})
    cleaned.sort(key=lambda b: b["start"])
    expected = 0
    for band in cleaned:
        if band["start"] != expected:
            raise BookingError("가격표 구간이 0시부터 24시까지 빈틈이나 겹침 없이 이어져야 해요.")
        expected = band["end"]
    if expected != 24:
        raise BookingError("가격표 구간이 0시부터 24시까지 빈틈이나 겹침 없이 이어져야 해요.")
    return cleaned


def validate_refund_tiers(tiers) -> List[Dict]:
    """환불 정책 검증: 단계마다 '시작 N시간 전까지 취소하면 P% 환불'. 가장 늦은 단계보다 늦으면 취소 불가."""
    if not isinstance(tiers, list) or not tiers:
        raise BookingError("환불 정책에 단계를 한 개 이상 넣어주세요.")
    cleaned = []
    seen = set()
    for tier in tiers:
        try:
            hours_before, percent = int(tier["hours_before"]), int(tier["percent"])
        except (KeyError, TypeError, ValueError):
            raise BookingError("환불 정책 단계는 시간(정수)과 환불 비율(정수)이 필요해요.")
        if hours_before < 0 or hours_before > 24 * 365:
            raise BookingError("환불 정책의 시간은 0 이상이어야 해요.")
        if percent < 0 or percent > 100:
            raise BookingError("환불 비율은 0~100 사이여야 해요.")
        if hours_before in seen:
            raise BookingError("같은 시간의 단계가 중복돼 있어요.")
        seen.add(hours_before)
        cleaned.append({"hours_before": hours_before, "percent": percent})
    cleaned.sort(key=lambda t: -t["hours_before"])
    return cleaned


def cost_for_hour(bands: List[Dict], hour: int) -> int:
    for band in bands:
        if band["start"] <= hour < band["end"]:
            return band["cost"]
    return 0


def slot_start(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=KST)


def refund_percent(tiers: List[Dict], hours_remaining: float) -> Optional[int]:
    """남은 시간에 해당하는 환불 비율. 어느 단계에도 못 들면 None(취소 불가)."""
    for tier in sorted(tiers, key=lambda t: -t["hours_before"]):
        if hours_remaining >= tier["hours_before"]:
            return tier["percent"]
    return None


class BookingManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn
        self.tokens = TokenManager(conn)

    # ---------- 설정 ----------
    async def _settings(self) -> Dict:
        return await SettingsManager(self.conn).get_settings()

    @staticmethod
    def _bands_from(settings: Dict) -> List[Dict]:
        raw = settings.get(SETTING_PRICE_BANDS)
        if raw:
            try:
                return validate_price_bands(json.loads(raw))
            except (ValueError, BookingError):
                pass
        return validate_price_bands(DEFAULT_PRICE_BANDS)

    @staticmethod
    def _tiers_from(settings: Dict) -> List[Dict]:
        raw = settings.get(SETTING_REFUND_TIERS)
        if raw:
            try:
                return validate_refund_tiers(json.loads(raw))
            except (ValueError, BookingError):
                pass
        return validate_refund_tiers(DEFAULT_REFUND_TIERS)

    async def get_mode(self) -> str:
        return (await self._settings()).get(SETTING_MODE) or MODE_LEGACY

    async def set_mode(self, mode: str) -> Tuple[bool, str]:
        if mode not in (MODE_LEGACY, MODE_TOKEN):
            return False, "예약 방식이 올바르지 않습니다."
        ok, message = await SettingsManager(self.conn).upsert_settings({SETTING_MODE: mode})
        return ok, ("예약 방식을 저장했습니다." if ok else message)

    async def set_price_bands(self, bands) -> Tuple[bool, str]:
        try:
            cleaned = validate_price_bands(bands)
        except BookingError as e:
            return False, str(e)
        ok, message = await SettingsManager(self.conn).upsert_settings({SETTING_PRICE_BANDS: json.dumps(cleaned)})
        return ok, ("시간대별 토큰 가격을 저장했습니다." if ok else message)

    async def set_refund_tiers(self, tiers) -> Tuple[bool, str]:
        try:
            cleaned = validate_refund_tiers(tiers)
        except BookingError as e:
            return False, str(e)
        ok, message = await SettingsManager(self.conn).upsert_settings({SETTING_REFUND_TIERS: json.dumps(cleaned)})
        return ok, ("환불 정책을 저장했습니다." if ok else message)

    # ---------- 예약 가능 범위 ----------
    @staticmethod
    def bookable_window(now: datetime, settings: Dict) -> Dict:
        """오늘 ~ 이번 달 말, 다음 달 예약이 열렸으면 다음 달 말까지."""
        config = ScheduleConfig.from_settings(settings)
        local = now.astimezone(KST)
        today = local.date()
        month_end = date(local.year, local.month, calendar.monthrange(local.year, local.month)[1])

        next_open: Optional[datetime] = None
        if config.auto_monthly_open_enabled:
            next_open = get_current_monthly_open(local, config)
        else:
            raw = settings.get("reservation_opens_at")
            if raw:
                try:
                    manual = datetime.fromisoformat(raw).astimezone(KST)
                    if (manual.year, manual.month) == (local.year, local.month):
                        next_open = manual
                except (ValueError, TypeError):
                    next_open = None

        next_month_open = next_open is not None and local >= next_open
        end = month_end
        if next_month_open:
            ny, nm = (local.year + 1, 1) if local.month == 12 else (local.year, local.month + 1)
            end = date(ny, nm, calendar.monthrange(ny, nm)[1])
        return {
            "start": today,
            "end": end,
            "next_month_open_at": next_open,
            "next_month_open": next_month_open,
        }

    async def get_config(self, username: str, role: str) -> Dict:
        settings = await self._settings()
        now = now_kst()
        window = self.bookable_window(now, settings)
        dawn_allowed = True
        if role != "admin":
            async with self.conn.execute("SELECT dawn_allowed FROM users WHERE username = ?", (username,)) as cursor:
                row = await cursor.fetchone()
            dawn_allowed = bool(row["dawn_allowed"]) if row else True
        return {
            "mode": settings.get(SETTING_MODE) or MODE_LEGACY,
            "reservation_enabled": settings.get("reservation_enabled") != "false",
            "price_bands": self._bands_from(settings),
            "refund_tiers": self._tiers_from(settings),
            "bookable_from": window["start"].isoformat(),
            "bookable_until": window["end"].isoformat(),
            "next_month_open_at": window["next_month_open_at"].isoformat() if window["next_month_open_at"] else None,
            "next_month_open": window["next_month_open"],
            "dawn_hours": list(DAWN_HOURS),
            "dawn_allowed": dawn_allowed,
            "balance": await self.tokens.get_balance(username) if role != "admin" else None,
            "is_admin": role == "admin",
        }

    # ---------- 예약 ----------
    @staticmethod
    def _parse_slot(raw) -> Tuple[date, int]:
        try:
            day = date.fromisoformat(str(raw["date"]))
            hour = int(raw["hour"])
        except (KeyError, TypeError, ValueError):
            raise BookingError("예약 날짜와 시간이 올바르지 않습니다.")
        if not 0 <= hour <= 23:
            raise BookingError("예약 시간은 0~23시여야 합니다.")
        return day, hour

    async def create_bookings(
        self, username: str, role: str, raw_slots: List[Dict], *, force_by: Optional[str] = None
    ) -> Dict:
        """예약 생성. force_by(관리자 아이디)가 있으면 범위·권한·토큰을 따지지 않는 강제 등록.

        한 트랜잭션: 하나라도 실패하면 아무것도 저장되지 않는다.
        """
        if not raw_slots:
            raise BookingError("예약할 시간을 선택해주세요.")
        if len(raw_slots) > MAX_SLOTS_PER_REQUEST:
            raise BookingError(f"한 번에 {MAX_SLOTS_PER_REQUEST}칸까지 예약할 수 있어요.")

        settings = await self._settings()
        slots = sorted({self._parse_slot(s) for s in raw_slots})
        now = now_kst()
        exempt = force_by is not None or role == "admin"

        if not exempt and settings.get("reservation_enabled") == "false":
            raise BookingError("현재 예약이 불가능합니다. 관리자에게 문의하세요.")

        async with self.conn.execute("SELECT role, dawn_allowed FROM users WHERE username = ?", (username,)) as cursor:
            user = await cursor.fetchone()
        if not user:
            raise BookingError("사용자를 찾을 수 없습니다.")

        bands = self._bands_from(settings)
        window = self.bookable_window(now, settings)

        costs: List[int] = []
        for day, hour in slots:
            start = slot_start(day, hour)
            if start <= now:
                raise BookingError(f"{day.month}월 {day.day}일 {hour}시는 이미 지난 시간이에요.")
            if not exempt:
                if day < window["start"] or day > window["end"]:
                    raise BookingError(f"{day.month}월 {day.day}일은 아직 예약할 수 없는 날짜예요.")
                if hour in DAWN_HOURS and not user["dawn_allowed"]:
                    raise BookingError("새벽(0~4시) 예약 권한이 없어요. 필요하면 관리자에게 문의해주세요.")
            costs.append(0 if exempt else cost_for_hour(bands, hour))

        total = sum(costs)
        if not exempt:
            balance = await self.tokens.get_balance(username)
            if total > balance:
                raise BookingError(f"토큰이 부족해요. (필요 {total}, 보유 {balance})")
            if any(c == 0 for c in costs) and balance < 1:
                raise BookingError("토큰이 1개 이상 있어야 이 시간대를 예약할 수 있어요.")

        for day, hour in slots:
            async with self.conn.execute(
                "SELECT 1 FROM bookings WHERE booking_date = ? AND hour = ? AND status = 'active'",
                (day.isoformat(), hour),
            ) as cursor:
                if await cursor.fetchone():
                    raise BookingError("이미 예약된 시간이 포함되어 있어요.")

        created_at = now.isoformat()
        try:
            ids = []
            for (day, hour), cost in zip(slots, costs):
                cursor = await self.conn.execute(
                    """INSERT INTO bookings (username, booking_date, hour, cost, status, created_at, created_by)
                       VALUES (?, ?, ?, ?, 'active', ?, ?)""",
                    (username, day.isoformat(), hour, cost, created_at, force_by or username),
                )
                ids.append(cursor.lastrowid)
                if cost > 0:
                    await self.tokens.add_ledger(
                        username, -cost, "spend",
                        ref_type="booking", ref_id=cursor.lastrowid,
                        memo=f"{day.month}/{day.day} {hour}시 예약", created_by=username, commit=False,
                    )
            await self.conn.commit()
        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            raise BookingError("이미 예약된 시간이 포함되어 있어요.")
        except Exception:
            await self.conn.rollback()
            raise
        return {"ids": ids, "count": len(ids), "spent": total, "dates": sorted({d.isoformat() for d, _ in slots})}

    async def cancel_bookings(
        self,
        ids: List[int],
        *,
        username: Optional[str] = None,
        admin_username: Optional[str] = None,
        refund_override: Optional[bool] = None,
    ) -> Dict:
        """예약 취소. 회원은 username(본인)으로, 관리자는 admin_username으로 호출한다.

        관리자 취소는 refund_override=True면 전액 환불, False면 환불 없음, None이면 정책대로.
        """
        if not ids:
            raise BookingError("취소할 예약을 선택해주세요.")
        settings = await self._settings()
        tiers = self._tiers_from(settings)
        now = now_kst()

        rows = []
        for booking_id in sorted(set(ids)):
            async with self.conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)) as cursor:
                row = await cursor.fetchone()
            if not row or (username is not None and row["username"] != username):
                raise BookingError("취소할 예약을 찾을 수 없어요.")
            if row["status"] != "active":
                raise BookingError("이미 취소된 예약이 포함되어 있어요.")
            rows.append(row)

        plan = []
        for row in rows:
            start = slot_start(date.fromisoformat(row["booking_date"]), row["hour"])
            remaining = (start - now).total_seconds() / 3600
            if remaining < 0:
                raise BookingError("이미 시작된 예약은 취소할 수 없어요.")
            if admin_username is not None and refund_override is not None:
                percent = 100 if refund_override else 0
            else:
                percent = refund_percent(tiers, remaining)
                if percent is None:
                    raise BookingError("취소할 수 있는 시간이 지났어요.")
            plan.append((row, row["cost"] * percent // 100))

        try:
            total_refund = 0
            for row, refund in plan:
                await self.conn.execute(
                    "UPDATE bookings SET status = 'cancelled', refunded = ?, cancelled_at = ? WHERE id = ?",
                    (refund, now.isoformat(), row["id"]),
                )
                if refund > 0:
                    day = date.fromisoformat(row["booking_date"])
                    await self.tokens.add_ledger(
                        row["username"], refund, "refund",
                        ref_type="booking", ref_id=row["id"],
                        memo=f"{day.month}/{day.day} {row['hour']}시 예약 취소",
                        created_by=admin_username or username, commit=False,
                    )
                total_refund += refund
            await self.conn.commit()
        except Exception:
            await self.conn.rollback()
            raise
        return {
            "count": len(plan),
            "refunded": total_refund,
            "dates": sorted({row["booking_date"] for row, _ in plan}),
        }

    # ---------- 조회 ----------
    async def _names(self) -> Dict[str, str]:
        async with self.conn.execute(
            "SELECT username, COALESCE(NULLIF(TRIM(name), ''), username) AS display FROM users"
        ) as cursor:
            return {r["username"]: r["display"] for r in await cursor.fetchall()}

    async def range_grid(self, username: str, role: str, start: date, days: int) -> List[Dict]:
        """start부터 days일의 하루 24칸 상태. 칸 상태: free | taken | mine | past | closed."""
        if not 1 <= days <= 42:
            raise BookingError("조회 기간이 올바르지 않습니다.")
        end = start + timedelta(days=days - 1)
        settings = await self._settings()
        bands = self._bands_from(settings)
        now = now_kst()
        window = self.bookable_window(now, settings)

        async with self.conn.execute(
            "SELECT * FROM bookings WHERE status = 'active' AND booking_date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ) as cursor:
            rows = await cursor.fetchall()
        taken = {(r["booking_date"], r["hour"]): r for r in rows}
        names = await self._names()

        result = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            in_window = window["start"] <= day <= window["end"]
            slots = []
            for hour in range(24):
                booking = taken.get((day.isoformat(), hour))
                if booking:
                    status = "mine" if booking["username"] == username else "taken"
                elif slot_start(day, hour) <= now:
                    status = "past"
                elif not in_window and role != "admin":
                    status = "closed"
                else:
                    status = "free"
                slot = {"hour": hour, "status": status, "cost": cost_for_hour(bands, hour)}
                if booking:
                    own_or_admin = booking["username"] == username or role == "admin"
                    slot["booking_id"] = booking["id"] if own_or_admin else None
                    # 취소 시 환불 예상에 쓰는, 그 예약을 했을 때 낸 토큰 (남의 예약에는 노출하지 않는다)
                    slot["paid"] = booking["cost"] if own_or_admin else None
                    slot["name"] = names.get(booking["username"], booking["username"])
                slots.append(slot)
            result.append({"date": day.isoformat(), "bookable": in_window, "slots": slots})
        return result

    async def month_summary(self, username: str, role: str, year: int, month: int) -> List[Dict]:
        """한 달 달력용 요약: 날짜별 예약 수, 내 예약 수, 24칸 점유 문자열(0 빈칸, 1 예약됨, 2 내 예약)."""
        first = date(year, month, 1)
        last = date(year, month, calendar.monthrange(year, month)[1])
        settings = await self._settings()
        window = self.bookable_window(now_kst(), settings)
        async with self.conn.execute(
            "SELECT booking_date, hour, username FROM bookings WHERE status = 'active' AND booking_date BETWEEN ? AND ?",
            (first.isoformat(), last.isoformat()),
        ) as cursor:
            rows = await cursor.fetchall()
        occupancy: Dict[str, List[str]] = {}
        for r in rows:
            cells = occupancy.setdefault(r["booking_date"], ["0"] * 24)
            cells[r["hour"]] = "2" if r["username"] == username else "1"
        days = []
        for offset in range((last - first).days + 1):
            day = first + timedelta(days=offset)
            cells = occupancy.get(day.isoformat(), ["0"] * 24)
            days.append({
                "date": day.isoformat(),
                "bookable": window["start"] <= day <= window["end"] or (role == "admin" and day >= window["start"]),
                "booked": sum(1 for c in cells if c != "0"),
                "mine": sum(1 for c in cells if c == "2"),
                "occupancy": "".join(cells),
            })
        return days

    async def my_bookings(self, username: str, upcoming_only: bool = True, limit: int = 200) -> List[Dict]:
        now = now_kst()
        query = "SELECT * FROM bookings WHERE username = ? AND status = 'active'"
        params: List = [username]
        if upcoming_only:
            query += " AND booking_date >= ?"
            params.append((now - timedelta(days=1)).date().isoformat())
        query += " ORDER BY booking_date, hour LIMIT ?"
        params.append(limit)
        async with self.conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        result = []
        for r in rows:
            start = slot_start(date.fromisoformat(r["booking_date"]), r["hour"])
            if upcoming_only and start <= now:
                continue
            result.append({
                "id": r["id"],
                "date": r["booking_date"],
                "hour": r["hour"],
                "cost": r["cost"],
                "cancellable": start > now,
            })
        return result

    async def admin_list(self, day: Optional[date] = None, username: Optional[str] = None, limit: int = 500) -> List[Dict]:
        query = "SELECT b.*, COALESCE(NULLIF(TRIM(u.name), ''), b.username) AS display FROM bookings b LEFT JOIN users u ON u.username = b.username WHERE 1=1"
        params: List = []
        if day:
            query += " AND b.booking_date = ?"
            params.append(day.isoformat())
        if username:
            query += " AND b.username = ?"
            params.append(username)
        query += " ORDER BY b.booking_date DESC, b.hour DESC, b.id DESC LIMIT ?"
        params.append(limit)
        async with self.conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        return [
            {
                "id": r["id"], "username": r["username"], "name": r["display"], "date": r["booking_date"],
                "hour": r["hour"], "cost": r["cost"], "status": r["status"], "refunded": r["refunded"],
                "created_at": r["created_at"], "cancelled_at": r["cancelled_at"], "created_by": r["created_by"],
            }
            for r in rows
        ]
