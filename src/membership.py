import aiosqlite
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

from src.automation_config import ScheduleConfig, get_monthly_reservation_target_period, now_kst
from src.schedule_utils import parse_opens_at

KST = timezone(timedelta(hours=9))

DEFAULT_PLANS = [
    {"name": "4시간", "allowed_hours": 4, "monthly_price": 0, "sort_order": 1},
    {"name": "6시간", "allowed_hours": 6, "monthly_price": 0, "sort_order": 2},
    {"name": "8시간", "allowed_hours": 8, "monthly_price": 0, "sort_order": 3},
]


def period_from_offset(months_ahead: int = 1, from_dt: Optional[datetime] = None) -> str:
    now = (from_dt or datetime.now(KST)).replace(tzinfo=None)
    year, month = now.year, now.month + months_ahead
    while month > 12:
        month -= 12
        year += 1
    return f"{year}-{month:02d}"


def role_from_hours(hours: int) -> str:
    return "free" if hours > 4 else "user"


def usage_period(from_dt: Optional[datetime] = None) -> str:
    """달력상 현재 월 — 시간표·자유이용 접근 판단에 사용."""
    return period_from_offset(0, from_dt)


def resolve_start_period(choice: Optional[str], from_dt: Optional[datetime] = None) -> str:
    """신청 시 이용 시작 달 (YYYY-MM). choice: 'current' | 'next' | YYYY-MM."""
    if choice in (None, "", "next"):
        return period_from_offset(1, from_dt)
    if choice == "current":
        return usage_period(from_dt)
    if len(choice) == 7 and choice[4] == "-":
        return choice
    return period_from_offset(1, from_dt)


class MembershipManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def get_plans(self) -> List[Dict]:
        async with self.conn.execute(
            "SELECT id, name, allowed_hours, monthly_price, sort_order FROM plans ORDER BY sort_order"
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_user_row(self, username: str) -> Optional[Dict]:
        async with self.conn.execute("SELECT * FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_subscription(self, username: str) -> Optional[Dict]:
        async with self.conn.execute(
            """
            SELECT s.*, p.name AS plan_name, p.allowed_hours AS plan_allowed_hours,
                   p.monthly_price AS plan_monthly_price
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.username = ?
            """,
            (username,),
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_effective_hours_and_price(self, username: str) -> Tuple[int, int, Optional[Dict]]:
        user = await self.get_user_row(username)
        sub = await self.get_subscription(username)
        if not sub:
            return 0, 0, None
        hours = user["custom_allowed_hours"] if user.get("custom_allowed_hours") is not None else sub["plan_allowed_hours"]
        price = user["custom_monthly_fee"] if user.get("custom_monthly_fee") is not None else sub["plan_monthly_price"]
        return hours, price, sub

    async def get_monthly_allowed_hours(self, username: str) -> int:
        user = await self.get_user_row(username)
        if not user:
            return 0
        if user.get("custom_allowed_hours") is not None:
            return int(user["custom_allowed_hours"])
        hours, _, sub = await self.get_effective_hours_and_price(username)
        if sub:
            return hours
        return int(user.get("allowed_hours") or 0)

    async def sync_user_entitlements(self, username: str) -> None:
        user = await self.get_user_row(username)
        if not user or user["role"] == "admin":
            return
        hours = await self.get_monthly_allowed_hours(username)
        if user["role"] == "free" and hours <= 4:
            new_role = "free"
        else:
            new_role = role_from_hours(hours)
        await self.conn.execute(
            "UPDATE users SET allowed_hours = ?, role = ? WHERE username = ?",
            (hours, new_role, username),
        )

    async def get_access_period(self) -> Optional[str]:
        async with self.conn.execute(
            "SELECT value FROM system_settings WHERE key = 'current_access_period'"
        ) as cursor:
            row = await cursor.fetchone()
        return row["value"] if row and row["value"] else None

    async def set_access_period(self, period: str) -> None:
        await self.conn.execute(
            "UPDATE system_settings SET value = ? WHERE key = 'current_access_period'",
            (period,),
        )

    async def admin_set_access_period(self, period: str) -> Tuple[bool, str]:
        if not period or len(period) != 7 or period[4] != "-":
            return False, "이용 기간 형식이 올바르지 않습니다. (YYYY-MM)"
        try:
            await self.set_access_period(period)
            await self.conn.commit()
            return True, f"현재 이용 기간이 {period}로 설정되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"설정 실패: {str(e)}"

    async def get_billing_cycle(self, username: str, period: str) -> Optional[Dict]:
        async with self.conn.execute(
            """
            SELECT bc.*, p.name AS plan_name
            FROM billing_cycles bc
            JOIN plans p ON p.id = bc.plan_id
            WHERE bc.username = ? AND bc.period = ?
            """,
            (username, period),
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row else None

    async def _sync_subscription_payment_status(self, username: str) -> None:
        """이용 달·예약 대상 달 입금 여부에 맞춰 구독 상태 동기화."""
        current = usage_period()
        target = await self.get_reservation_target_period()
        billing_current = await self.get_billing_cycle(username, current)
        billing_target = await self.get_billing_cycle(username, target)
        now = datetime.now(KST).isoformat()
        if self._is_billing_paid(billing_current) or self._is_billing_paid(billing_target):
            await self.conn.execute(
                """
                UPDATE subscriptions SET status = 'active', updated_at = ?
                WHERE username = ?
                """,
                (now, username),
            )
        else:
            await self.conn.execute(
                """
                UPDATE subscriptions SET status = 'pending_payment', updated_at = ?
                WHERE username = ?
                """,
                (now, username),
            )

    async def _get_schedule_config(self) -> ScheduleConfig:
        async with self.conn.execute("SELECT key, value FROM system_settings") as cursor:
            rows = await cursor.fetchall()
        settings = {row["key"]: row["value"] for row in rows}
        return ScheduleConfig.from_settings(settings)

    async def get_reservation_target_period(self, from_dt: Optional[datetime] = None) -> str:
        now = from_dt or now_kst()
        config = await self._get_schedule_config()
        if not config.auto_monthly_open_enabled:
            async with self.conn.execute(
                "SELECT value FROM system_settings WHERE key = 'reservation_opens_at'"
            ) as cursor:
                row = await cursor.fetchone()
            manual = parse_opens_at(row["value"] if row else None)
            if manual:
                return f"{manual.year}-{manual.month:02d}"
        return get_monthly_reservation_target_period(now, config)

    def _is_billing_paid(self, billing: Optional[Dict]) -> bool:
        return bool(billing and billing.get("status") == "paid")

    async def get_access_status(self, username: str) -> Dict:
        user = await self.get_user_row(username)
        if not user:
            return {"access_status": "unknown", "can_access_schedule": False, "message": "사용자를 찾을 수 없습니다."}
        if user["role"] == "admin":
            target = await self.get_reservation_target_period()
            return {
                "access_status": "active",
                "can_access_schedule": True,
                "can_reserve_monthly": True,
                "can_access_current_month": True,
                "can_view_schedule": True,
                "message": "관리자",
                "subscription": None,
                "billing": None,
                "access_period": usage_period(),
                "reservation_target_period": target,
            }

        sub = await self.get_subscription(username)
        if not sub:
            return {
                "access_status": "no_plan",
                "can_access_schedule": False,
                "can_reserve_monthly": False,
                "can_access_current_month": False,
                "can_view_schedule": False,
                "message": "요금제를 신청해주세요.",
                "subscription": None,
                "billing": None,
                "access_period": usage_period(),
                "reservation_target_period": await self.get_reservation_target_period(),
            }

        current_period = usage_period()
        next_period = period_from_offset(1)
        target_period = await self.get_reservation_target_period()
        billing_current = await self.get_billing_cycle(username, current_period)
        billing_next = await self.get_billing_cycle(username, next_period)
        billing_target = await self.get_billing_cycle(username, target_period)
        hours, price, _ = await self.get_effective_hours_and_price(username)

        pending_change = await self._get_pending_plan_change(username)
        pending_cancellation = self._pending_cancellation(sub)
        start_period = sub.get("start_period") or current_period

        paid_current = self._is_billing_paid(billing_current)
        paid_next = self._is_billing_paid(billing_next)
        paid_target = self._is_billing_paid(billing_target)

        can_access_current_month = paid_current
        can_access_schedule = paid_current or paid_next or paid_target
        can_reserve_monthly = paid_target
        can_view_schedule = True

        display_billing = billing_target or billing_next or billing_current
        if display_billing and display_billing["status"] == "paid":
            access_status = "active"
        elif display_billing and display_billing["status"] == "pending":
            access_status = "pending_payment"
        elif can_access_schedule:
            access_status = "active"
        else:
            access_status = "pending_payment"

        if can_reserve_monthly:
            message = "이용 가능"
        elif paid_next and not paid_current:
            config = await self._get_schedule_config()
            from src.automation_config import get_current_monthly_open, format_monthly_open_label
            this_month_open = get_current_monthly_open(now_kst(), config)
            if now_kst() < this_month_open:
                opens_at = format_monthly_open_label(this_month_open)
                message = (
                    f"{next_period} 이용 요금이 확인되었습니다. "
                    f"월간 예약은 {opens_at}부터 가능합니다."
                )
            else:
                message = f"{next_period} 이용 요금이 확인되었습니다."
        elif display_billing and display_billing["status"] == "pending":
            message = f"{display_billing['period']} 이용 요금 입금 확인 후 시간표를 이용할 수 있습니다."
        elif not can_access_schedule:
            message = f"{start_period} 이용 요금 입금 확인 후 시간표를 이용할 수 있습니다."
        else:
            message = "이용 가능"

        return {
            "access_status": access_status,
            "can_access_schedule": can_access_schedule,
            "can_reserve_monthly": can_reserve_monthly,
            "can_access_current_month": can_access_current_month,
            "can_view_schedule": can_view_schedule,
            "message": message,
            "subscription": self._public_subscription(sub, hours, price),
            "billing": self._public_billing(display_billing) if display_billing else None,
            "access_period": current_period,
            "reservation_target_period": target_period,
            "start_period": start_period,
            "pending_plan_change": pending_change,
            "pending_cancellation": pending_cancellation,
        }

    def _pending_cancellation(self, sub: Optional[Dict]) -> Optional[Dict]:
        if not sub or not sub.get("cancellation_effective_period"):
            return None
        return {"effective_period": sub["cancellation_effective_period"]}

    def _public_subscription(self, sub: Dict, hours: int, price: int) -> Dict:
        return {
            "plan_id": sub["plan_id"],
            "plan_name": sub["plan_name"],
            "status": sub["status"],
            "allowed_hours": hours,
            "monthly_price": price,
            "auto_renew": bool(sub["auto_renew"]),
            "start_period": sub.get("start_period"),
        }

    def _public_billing(self, billing: Dict) -> Dict:
        return {
            "period": billing["period"],
            "amount": billing["amount"],
            "status": billing["status"],
            "billing_type": billing["billing_type"],
            "plan_name": billing["plan_name"],
        }

    async def _get_pending_plan_change(self, username: str) -> Optional[Dict]:
        async with self.conn.execute(
            """
            SELECT pcr.*, p.name AS new_plan_name, p.allowed_hours, p.monthly_price
            FROM plan_change_requests pcr
            JOIN plans p ON p.id = pcr.new_plan_id
            WHERE pcr.username = ? AND pcr.status = 'pending'
            ORDER BY pcr.id DESC LIMIT 1
            """,
            (username,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return None
        return {
            "effective_period": row["effective_period"],
            "new_plan_id": row["new_plan_id"],
            "new_plan_name": row["new_plan_name"],
            "new_allowed_hours": row["allowed_hours"],
            "new_monthly_price": row["monthly_price"],
        }

    async def apply_for_plan(
        self, username: str, plan_id: int, start_period_choice: Optional[str] = None
    ) -> Tuple[bool, str]:
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."
        if user["role"] == "admin":
            return False, "관리자 계정은 요금제를 신청할 수 없습니다."

        async with self.conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)) as cursor:
            if not await cursor.fetchone():
                return False, "존재하지 않는 요금제입니다."

        existing = await self.get_subscription(username)
        if existing and existing["status"] == "active":
            return False, "이미 이용 중인 요금제가 있습니다. 변경은 다음 달부터 적용됩니다."

        start_period = resolve_start_period(start_period_choice)
        try:
            if existing:
                await self.conn.execute(
                    """
                    UPDATE subscriptions
                    SET plan_id = ?, status = 'pending_payment', start_period = ?, updated_at = ?
                    WHERE username = ?
                    """,
                    (plan_id, start_period, datetime.now(KST).isoformat(), username),
                )
            else:
                await self.conn.execute(
                    """
                    INSERT INTO subscriptions
                    (username, plan_id, status, auto_renew, start_period, created_at, updated_at)
                    VALUES (?, ?, 'pending_payment', 1, ?, ?, ?)
                    """,
                    (
                        username,
                        plan_id,
                        start_period,
                        datetime.now(KST).isoformat(),
                        datetime.now(KST).isoformat(),
                    ),
                )

            await self.sync_user_entitlements(username)
            await self._ensure_billing_cycle(username, start_period, billing_type="new")
            await self.conn.commit()
            return True, (
                f"{start_period} 요금제 신청이 완료되었습니다. "
                "입금 확인 후 이용 가능합니다."
            )
        except Exception as e:
            await self.conn.rollback()
            return False, f"요금제 신청 중 오류가 발생했습니다: {str(e)}"

    async def request_plan_change(self, username: str, new_plan_id: int) -> Tuple[bool, str]:
        sub = await self.get_subscription(username)
        if not sub:
            return False, "먼저 요금제를 신청해주세요."
        if sub["plan_id"] == new_plan_id:
            return False, "현재와 동일한 요금제입니다."

        async with self.conn.execute("SELECT id FROM plans WHERE id = ?", (new_plan_id,)) as cursor:
            if not await cursor.fetchone():
                return False, "존재하지 않는 요금제입니다."

        effective_period = period_from_offset(1)

        try:
            await self.conn.execute(
                "UPDATE plan_change_requests SET status = 'cancelled' WHERE username = ? AND status = 'pending'",
                (username,),
            )
            await self.conn.execute(
                """
                INSERT INTO plan_change_requests (username, new_plan_id, effective_period, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)
                """,
                (username, new_plan_id, effective_period, datetime.now(KST).isoformat()),
            )
            await self.conn.commit()
            return True, f"{effective_period}부터 요금제가 변경됩니다. 정산 시 새 요금이 청구됩니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"요금제 변경 신청 중 오류: {str(e)}"

    async def request_cancellation(self, username: str) -> Tuple[bool, str]:
        sub = await self.get_subscription(username)
        if not sub:
            return False, "요금제가 없습니다."
        if sub.get("cancellation_effective_period"):
            return False, "이미 중단이 예약되어 있습니다."

        effective_period = period_from_offset(1)
        now = datetime.now(KST).isoformat()

        try:
            await self.conn.execute(
                """
                UPDATE subscriptions
                SET auto_renew = 0, cancellation_effective_period = ?, updated_at = ?
                WHERE username = ?
                """,
                (effective_period, now, username),
            )
            await self.conn.commit()
            return True, f"{effective_period}부터 요금제가 중단됩니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"요금제 중단 신청 중 오류: {str(e)}"

    async def revoke_cancellation(self, username: str) -> Tuple[bool, str]:
        sub = await self.get_subscription(username)
        if not sub or not sub.get("cancellation_effective_period"):
            return False, "예약된 중단이 없습니다."

        now = datetime.now(KST).isoformat()
        try:
            await self.conn.execute(
                """
                UPDATE subscriptions
                SET auto_renew = 1, cancellation_effective_period = NULL, updated_at = ?
                WHERE username = ?
                """,
                (now, username),
            )
            await self.conn.commit()
            return True, "요금제 중단이 취소되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"중단 취소 중 오류: {str(e)}"

    async def _resolve_plan_for_period(self, username: str, period: str) -> int:
        async with self.conn.execute(
            """
            SELECT new_plan_id FROM plan_change_requests
            WHERE username = ? AND effective_period = ? AND status = 'pending'
            ORDER BY id DESC LIMIT 1
            """,
            (username, period),
        ) as cursor:
            row = await cursor.fetchone()
        if row:
            return row["new_plan_id"]
        sub = await self.get_subscription(username)
        if not sub:
            raise ValueError("subscription not found")
        return sub["plan_id"]

    async def _billing_type_for_user(self, username: str, period: str, plan_id: int) -> str:
        sub = await self.get_subscription(username)
        async with self.conn.execute(
            "SELECT COUNT(*) FROM billing_cycles WHERE username = ? AND status = 'paid'",
            (username,),
        ) as cursor:
            paid_count = (await cursor.fetchone())[0]

        async with self.conn.execute(
            """
            SELECT new_plan_id FROM plan_change_requests
            WHERE username = ? AND effective_period = ? AND status = 'pending'
            """,
            (username, period),
        ) as cursor:
            change = await cursor.fetchone()

        if paid_count == 0:
            return "new"
        if change and change["new_plan_id"] != sub["plan_id"]:
            return "plan_change"
        return "renewal"

    async def _ensure_billing_cycle(self, username: str, period: str, billing_type: Optional[str] = None) -> Dict:
        existing = await self.get_billing_cycle(username, period)
        if existing:
            return existing

        plan_id = await self._resolve_plan_for_period(username, period)
        if billing_type is None:
            billing_type = await self._billing_type_for_user(username, period, plan_id)

        user = await self.get_user_row(username)
        async with self.conn.execute("SELECT monthly_price FROM plans WHERE id = ?", (plan_id,)) as cursor:
            plan_row = await cursor.fetchone()
        amount = user["custom_monthly_fee"] if user.get("custom_monthly_fee") is not None else plan_row["monthly_price"]

        await self.conn.execute(
            """
            INSERT INTO billing_cycles (username, period, plan_id, amount, billing_type, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            (username, period, plan_id, amount, billing_type, datetime.now(KST).isoformat()),
        )
        return await self.get_billing_cycle(username, period)

    async def generate_billing(self, period: str) -> Tuple[bool, str]:
        """period(YYYY-MM) 명단 전원에게 청구를 만든다. 여러 번 눌러도 안전(이미 있으면 건너뜀)."""
        if not period or len(period) != 7 or period[4] != "-":
            return False, "기간 형식이 올바르지 않습니다. (YYYY-MM)"
        try:
            roster = await self._roster_usernames(period)
            created = 0
            for username in roster:
                if await self.get_billing_cycle(username, period):
                    continue
                plan_id = await self._resolve_plan_for_period(username, period)
                await self.conn.execute(
                    "UPDATE subscriptions SET plan_id = ? WHERE username = ?",
                    (plan_id, username),
                )
                await self._ensure_billing_cycle(username, period)
                await self.sync_user_entitlements(username)
                created += 1
            await self.conn.commit()
            return True, f"{period} 청구 {created}건을 새로 만들었습니다. (명단 {len(roster)}명)"
        except Exception as e:
            await self.conn.rollback()
            return False, f"청구 생성 실패: {str(e)}"

    def _in_roster(self, sub: Optional[Dict], period: str) -> bool:
        if not sub:
            return False
        if (sub.get("start_period") or "0000-00") > period:
            return False
        cancel = sub.get("cancellation_effective_period")
        return not (cancel and cancel <= period)

    async def _roster_usernames(self, period: str) -> List[str]:
        async with self.conn.execute(
            """
            SELECT s.username, s.start_period, s.cancellation_effective_period
            FROM subscriptions s JOIN users u ON u.username = s.username
            WHERE u.role != 'admin'
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [r["username"] for r in rows if self._in_roster(dict(r), period)]

    async def get_roster(self, period: str) -> Dict:
        """period 기준 명단(신청자)과 추가 후보(미신청자)."""
        members: List[Dict] = []
        candidates: List[Dict] = []
        users = await self.list_users_with_membership()

        # 회원마다 쿼리하지 않도록 구독/청구를 한 번에 가져온다.
        async with self.conn.execute(
            """
            SELECT s.*, p.name AS plan_name, p.allowed_hours AS plan_allowed_hours,
                   p.monthly_price AS plan_monthly_price
            FROM subscriptions s JOIN plans p ON p.id = s.plan_id
            """
        ) as cursor:
            subs = {r["username"]: dict(r) for r in await cursor.fetchall()}
        async with self.conn.execute(
            "SELECT * FROM billing_cycles WHERE period = ?", (period,)
        ) as cursor:
            billings = {r["username"]: dict(r) for r in await cursor.fetchall()}

        for user in users:
            username = user["username"]
            sub = subs.get(username)
            if self._in_roster(sub, period):
                custom_hours = user.get("custom_allowed_hours")
                custom_fee = user.get("custom_monthly_fee")
                hours = custom_hours if custom_hours is not None else sub["plan_allowed_hours"]
                price = custom_fee if custom_fee is not None else sub["plan_monthly_price"]
                billing = billings.get(username)
                members.append({
                    "username": username,
                    "name": user.get("name"),
                    "phone": user.get("phone"),
                    "plan_id": sub["plan_id"],
                    "plan_name": sub["plan_name"],
                    "allowed_hours": hours,
                    "monthly_price": price,
                    "custom_allowed_hours": user.get("custom_allowed_hours"),
                    "custom_monthly_fee": user.get("custom_monthly_fee"),
                    "free_access": user["role"] == "free",
                    "billing_id": billing["id"] if billing else None,
                    "billing_status": billing["status"] if billing else "none",
                    "billing_amount": billing["amount"] if billing else None,
                    "paid_at": billing.get("paid_at") if billing else None,
                })
            else:
                note = "요금제 없음"
                if sub and sub.get("cancellation_effective_period"):
                    note = f"{sub['cancellation_effective_period']}부터 제외됨"
                elif sub and (sub.get("start_period") or "") > period:
                    note = f"{sub['start_period']}부터 시작 예정"
                candidates.append({
                    "username": username,
                    "name": user.get("name"),
                    "phone": user.get("phone"),
                    "note": note,
                    "had_plan": bool(sub),
                })

        counts = {
            "members": len(members),
            "unbilled": sum(1 for m in members if m["billing_status"] == "none"),
            "pending": sum(1 for m in members if m["billing_status"] == "pending"),
            "paid": sum(1 for m in members if m["billing_status"] == "paid"),
            "total_amount": sum((m["billing_amount"] if m["billing_amount"] is not None else m["monthly_price"]) or 0 for m in members),
            "paid_amount": sum((m["billing_amount"] or 0) for m in members if m["billing_status"] == "paid"),
        }
        return {"period": period, "members": members, "candidates": candidates, "summary": counts}

    async def add_to_roster(
        self,
        username: str,
        period: str,
        plan_id: int,
        allowed_hours: Optional[int] = None,
        custom_monthly_fee: Optional[int] = None,
        free_access: Optional[bool] = None,
    ) -> Tuple[bool, str]:
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."
        if user["role"] == "admin":
            return False, "관리자 계정은 명단에 추가할 수 없습니다."
        async with self.conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)) as cursor:
            if not await cursor.fetchone():
                return False, "존재하지 않는 요금제입니다."
        if not period or len(period) != 7 or period[4] != "-":
            return False, "기간 형식이 올바르지 않습니다. (YYYY-MM)"

        now_iso = datetime.now(KST).isoformat()
        try:
            sub = await self.get_subscription(username)
            if sub:
                # 아직 이용 중인 회원의 제외를 되돌리는 경우엔 시작 월을 유지해 연속성을 보존한다.
                cancel = sub.get("cancellation_effective_period")
                still_active = not cancel or cancel > usage_period()
                start = sub.get("start_period") if still_active and sub.get("start_period") else period
                start = min(start, period)
                await self.conn.execute(
                    """
                    UPDATE subscriptions
                    SET plan_id = ?, start_period = ?, cancellation_effective_period = NULL,
                        auto_renew = 1, updated_at = ?
                    WHERE username = ?
                    """,
                    (plan_id, start, now_iso, username),
                )
            else:
                await self.conn.execute(
                    """
                    INSERT INTO subscriptions
                    (username, plan_id, status, auto_renew, start_period, created_at, updated_at)
                    VALUES (?, ?, 'pending_payment', 1, ?, ?, ?)
                    """,
                    (username, plan_id, period, now_iso, now_iso),
                )
            await self.conn.execute(
                "UPDATE plan_change_requests SET status = 'cancelled' WHERE username = ? AND status = 'pending'",
                (username,),
            )
            await self.conn.commit()
        except Exception as e:
            await self.conn.rollback()
            return False, f"명단 추가 실패: {str(e)}"

        ok, msg = await self.update_user_membership(
            username,
            plan_id=plan_id,
            allowed_hours=allowed_hours,
            clear_custom_hours=allowed_hours is None,
            custom_monthly_fee=custom_monthly_fee,
            clear_custom_fee=custom_monthly_fee is None,
            free_access=free_access,
        )
        if not ok:
            return False, msg

        try:
            await self._ensure_billing_cycle(username, period)
            await self._sync_subscription_payment_status(username)
            await self.sync_user_entitlements(username)
            await self.conn.commit()
        except Exception as e:
            await self.conn.rollback()
            return False, f"청구 생성 실패: {str(e)}"
        return True, f"'{username}'님을 {period} 명단에 추가했습니다."

    async def remove_from_roster(self, username: str, period: str) -> Tuple[bool, str]:
        """period부터 명단에서 제외(요금제 해제). 계정과 과거 기록은 유지."""
        if not period or len(period) != 7 or period[4] != "-":
            return False, "기간 형식이 올바르지 않습니다. (YYYY-MM)"
        if period < usage_period():
            return False, "이미 시작된 달 이전 기간은 명단에서 제외할 수 없습니다."
        sub = await self.get_subscription(username)
        if not sub or not self._in_roster(sub, period):
            return False, "이 기간 명단에 없는 회원입니다."
        billing = await self.get_billing_cycle(username, period)
        if billing and billing["status"] == "paid":
            return False, "이미 입금 확인된 회원입니다. 먼저 입금 확인을 취소한 뒤 제외해주세요."
        now_iso = datetime.now(KST).isoformat()
        try:
            await self.conn.execute(
                "DELETE FROM billing_cycles WHERE username = ? AND period >= ? AND status = 'pending'",
                (username, period),
            )
            await self.conn.execute(
                """
                UPDATE subscriptions
                SET cancellation_effective_period = ?, auto_renew = 0, updated_at = ?
                WHERE username = ?
                """,
                (period, now_iso, username),
            )
            await self.conn.execute(
                "UPDATE plan_change_requests SET status = 'cancelled' WHERE username = ? AND status = 'pending'",
                (username,),
            )
            await self._sync_subscription_payment_status(username)
            await self.conn.commit()
            return True, f"'{username}'님을 {period}부터 명단에서 제외했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"제외 실패: {str(e)}"

    async def confirm_payment(self, billing_id: int, admin_username: str) -> Tuple[bool, str]:
        try:
            async with self.conn.execute(
                "SELECT * FROM billing_cycles WHERE id = ?", (billing_id,)
            ) as cursor:
                billing = await cursor.fetchone()
            if not billing:
                return False, "청구 내역을 찾을 수 없습니다."
            if billing["status"] == "paid":
                return False, "이미 입금 확인된 내역입니다."

            now = datetime.now(KST).isoformat()
            await self.conn.execute(
                """
                UPDATE billing_cycles
                SET status = 'paid', paid_at = ?, confirmed_by = ?
                WHERE id = ?
                """,
                (now, admin_username, billing_id),
            )

            async with self.conn.execute(
                """
                SELECT id FROM plan_change_requests
                WHERE username = ? AND effective_period = ? AND status = 'pending'
                """,
                (billing["username"], billing["period"]),
            ) as cursor:
                change = await cursor.fetchone()
            if change:
                await self.conn.execute(
                    "UPDATE plan_change_requests SET status = 'applied' WHERE id = ?",
                    (change["id"],),
                )
                await self.conn.execute(
                    "UPDATE subscriptions SET plan_id = ? WHERE username = ?",
                    (billing["plan_id"], billing["username"]),
                )

            await self._sync_subscription_payment_status(billing["username"])
            await self.sync_user_entitlements(billing["username"])
            await self.conn.commit()
            return True, f"{billing['username']}님의 {billing['period']} 입금이 확인되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"입금 확인 실패: {str(e)}"

    async def undo_confirm_payment(self, billing_id: int) -> Tuple[bool, str]:
        try:
            async with self.conn.execute(
                "SELECT * FROM billing_cycles WHERE id = ?", (billing_id,)
            ) as cursor:
                billing = await cursor.fetchone()
            if not billing:
                return False, "청구 내역을 찾을 수 없습니다."
            if billing["status"] != "paid":
                return False, "입금 확인된 내역이 아닙니다."

            username = billing["username"]
            period = billing["period"]
            prev_period = self._previous_period(period)
            now = datetime.now(KST).isoformat()

            async with self.conn.execute(
                """
                SELECT id FROM plan_change_requests
                WHERE username = ? AND effective_period = ? AND status = 'applied'
                """,
                (username, period),
            ) as cursor:
                change = await cursor.fetchone()
            if change:
                await self.conn.execute(
                    "UPDATE plan_change_requests SET status = 'pending' WHERE id = ?",
                    (change["id"],),
                )
                prev_billing = await self.get_billing_cycle(username, prev_period)
                if prev_billing:
                    await self.conn.execute(
                        "UPDATE subscriptions SET plan_id = ?, updated_at = ? WHERE username = ?",
                        (prev_billing["plan_id"], now, username),
                    )

            await self.conn.execute(
                """
                UPDATE billing_cycles
                SET status = 'pending', paid_at = NULL, confirmed_by = NULL
                WHERE id = ?
                """,
                (billing_id,),
            )

            await self._sync_subscription_payment_status(username)
            await self.sync_user_entitlements(username)
            await self.conn.commit()
            return True, f"{username}님의 {period} 입금 확인이 취소되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"입금 확인 취소 실패: {str(e)}"

    async def undo_all_confirmations_for_period(self, period: str) -> Tuple[bool, str]:
        paid = await self.list_billing_cycles(period=period, status="paid")
        if not paid:
            return False, "취소할 입금 확인 내역이 없습니다."

        undone = 0
        errors: List[str] = []
        for row in paid:
            ok, msg = await self.undo_confirm_payment(row["id"])
            if ok:
                undone += 1
            else:
                errors.append(msg)

        if undone == 0:
            return False, errors[0] if errors else "취소에 실패했습니다."
        if errors:
            return True, f"{undone}건 취소됨 ({len(errors)}건 실패)"
        return True, f"{period} 입금 확인 {undone}건이 모두 취소되었습니다."

    async def list_billing_cycles(self, period: Optional[str] = None, status: Optional[str] = None) -> List[Dict]:
        query = """
            SELECT bc.*, p.name AS plan_name, u.name, u.phone, u.email,
                   u.custom_allowed_hours, u.custom_monthly_fee
            FROM billing_cycles bc
            JOIN plans p ON p.id = bc.plan_id
            JOIN users u ON u.username = bc.username
            WHERE u.role != 'admin'
        """
        params: List = []
        if period:
            query += " AND bc.period = ?"
            params.append(period)
        if status:
            query += " AND bc.status = ?"
            params.append(status)
        query += " ORDER BY bc.period DESC, bc.status ASC, bc.username ASC"

        async with self.conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_settlement_summary(self, period: str) -> Dict:
        cycles = await self.list_billing_cycles(period=period)
        prev_period = self._previous_period(period)
        prev_cycles = {c["username"]: c for c in await self.list_billing_cycles(period=prev_period, status="paid")}

        items = []
        counts = {"new": 0, "renewal": 0, "plan_change": 0, "pending": 0, "paid": 0}

        for cycle in cycles:
            prev = prev_cycles.get(cycle["username"])
            if cycle["billing_type"] == "new":
                change_label = "신규"
                counts["new"] += 1
            elif cycle["billing_type"] == "plan_change":
                change_label = "요금제 변경"
                counts["plan_change"] += 1
            else:
                change_label = "유지"
                counts["renewal"] += 1

            if prev and prev["plan_id"] != cycle["plan_id"] and cycle["billing_type"] != "new":
                change_label = f"{prev['plan_name']} → {cycle['plan_name']}"

            if cycle["status"] == "paid":
                counts["paid"] += 1
            else:
                counts["pending"] += 1

            items.append({
                **cycle,
                "change_label": change_label,
                "prev_plan_name": prev["plan_name"] if prev else None,
            })

        return {
            "period": period,
            "summary": counts,
            "items": items,
        }

    def _previous_period(self, period: str) -> str:
        year, month = map(int, period.split("-"))
        month -= 1
        if month < 1:
            month = 12
            year -= 1
        return f"{year}-{month:02d}"

    async def list_users_with_membership(self) -> List[Dict]:
        async with self.conn.execute(
            """
            SELECT u.username, u.email, u.name, u.phone, u.role, u.allowed_hours,
                   u.custom_allowed_hours, u.custom_monthly_fee,
                   s.plan_id, s.status AS subscription_status, s.auto_renew,
                   p.name AS plan_name, p.allowed_hours AS plan_allowed_hours,
                   p.monthly_price AS plan_monthly_price
            FROM users u
            LEFT JOIN subscriptions s ON s.username = u.username
            LEFT JOIN plans p ON p.id = s.plan_id
            WHERE u.role != 'admin'
            ORDER BY u.username
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_admin_users(self) -> List[Dict]:
        async with self.conn.execute(
            """
            SELECT username, email, name, phone, role, allowed_hours, custom_allowed_hours
            FROM users
            WHERE role = 'admin'
            ORDER BY username
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def update_admin_hours(self, username: str, allowed_hours: int) -> Tuple[bool, str]:
        user = await self.get_user_row(username)
        if not user or user["role"] != "admin":
            return False, "관리자 계정을 찾을 수 없습니다."
        if allowed_hours < 1 or allowed_hours > 24:
            return False, "월 예약 시간은 1~24시간 사이여야 합니다."
        try:
            await self.conn.execute(
                """
                UPDATE users SET allowed_hours = ?, custom_allowed_hours = ?
                WHERE username = ?
                """,
                (allowed_hours, allowed_hours, username),
            )
            await self.conn.commit()
            return True, f"'{username}' 관리자의 월 예약 시간이 {allowed_hours}시간으로 변경되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"관리자 수정 실패: {str(e)}"

    async def update_user_membership(
        self,
        username: str,
        *,
        allowed_hours: Optional[int] = None,
        free_access: Optional[bool] = None,
        plan_id: Optional[int] = None,
        custom_allowed_hours: Optional[int] = None,
        custom_monthly_fee: Optional[int] = None,
        clear_custom_hours: bool = False,
        clear_custom_fee: bool = False,
        auto_renew: Optional[bool] = None,
    ) -> Tuple[bool, str]:
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."
        if user["role"] == "admin":
            return False, "관리자 계정은 수정할 수 없습니다."

        hours_to_set = allowed_hours if allowed_hours is not None else custom_allowed_hours
        now_iso = datetime.now(KST).isoformat()

        try:
            sub = await self.get_subscription(username)
            created_subscription = False

            # 요금제를 지정하지 않았더라도, 개별 시간/요금/자유이용을 설정하려면 구독이 있어야
            # 청구·입금 확인·이용 권한 흐름이 동작한다. 없으면 가장 가까운 요금제로 만든다.
            needs_subscription = (
                plan_id is not None
                or hours_to_set is not None
                or custom_monthly_fee is not None
                or bool(free_access)
            )
            if not sub and needs_subscription:
                if plan_id is None:
                    async with self.conn.execute(
                        "SELECT id FROM plans ORDER BY ABS(allowed_hours - ?), sort_order LIMIT 1",
                        (hours_to_set or 0,),
                    ) as cursor:
                        plan_row = await cursor.fetchone()
                    if not plan_row:
                        return False, "등록된 요금제가 없습니다."
                    plan_id = plan_row["id"]
                async with self.conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)) as cursor:
                    if not await cursor.fetchone():
                        return False, "존재하지 않는 요금제입니다."
                await self.conn.execute(
                    """
                    INSERT INTO subscriptions
                    (username, plan_id, status, auto_renew, start_period, created_at, updated_at)
                    VALUES (?, ?, 'pending_payment', 1, ?, ?, ?)
                    """,
                    (username, plan_id, usage_period(), now_iso, now_iso),
                )
                created_subscription = True
            elif sub and plan_id is not None:
                async with self.conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)) as cursor:
                    if not await cursor.fetchone():
                        return False, "존재하지 않는 요금제입니다."
                await self.conn.execute(
                    "UPDATE subscriptions SET plan_id = ?, updated_at = ? WHERE username = ?",
                    (plan_id, now_iso, username),
                )
                # 요금제를 바꾸면서 시간을 따로 지정하지 않으면 새 요금제의 기본 시간을 따른다.
                if hours_to_set is None:
                    clear_custom_hours = True

            if clear_custom_hours:
                await self.conn.execute(
                    "UPDATE users SET custom_allowed_hours = NULL WHERE username = ?", (username,)
                )
            elif hours_to_set is not None:
                await self.conn.execute(
                    "UPDATE users SET custom_allowed_hours = ? WHERE username = ?", (hours_to_set, username)
                )

            if free_access is not None:
                hours = hours_to_set if hours_to_set is not None else await self.get_monthly_allowed_hours(username)
                new_role = "free" if free_access else role_from_hours(hours)
                await self.conn.execute(
                    "UPDATE users SET role = ? WHERE username = ?", (new_role, username)
                )

            if clear_custom_fee:
                await self.conn.execute(
                    "UPDATE users SET custom_monthly_fee = NULL WHERE username = ?", (username,)
                )
            elif custom_monthly_fee is not None:
                await self.conn.execute(
                    "UPDATE users SET custom_monthly_fee = ? WHERE username = ?", (custom_monthly_fee, username)
                )

            if auto_renew is not None:
                await self.conn.execute(
                    "UPDATE subscriptions SET auto_renew = ? WHERE username = ?",
                    (1 if auto_renew else 0, username),
                )

            if created_subscription:
                await self._ensure_billing_cycle(username, usage_period(), billing_type="new")

            # 아직 입금 전인 청구서는 바뀐 요금제/요금을 반영한다.
            if await self.get_subscription(username):
                _, price, sub_now = await self.get_effective_hours_and_price(username)
                async with self.conn.execute(
                    "SELECT id, period, plan_id FROM billing_cycles WHERE username = ? AND status = 'pending'",
                    (username,),
                ) as cursor:
                    pending_cycles = await cursor.fetchall()
                for cycle in pending_cycles:
                    resolved_plan = plan_id if plan_id is not None else cycle["plan_id"]
                    await self.conn.execute(
                        "UPDATE billing_cycles SET plan_id = ?, amount = ? WHERE id = ?",
                        (resolved_plan, price, cycle["id"]),
                    )

            await self.sync_user_entitlements(username)
            await self.conn.commit()
            return True, f"'{username}' 회원 정보가 수정되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"회원 수정 실패: {str(e)}"

    def build_settlement_copy_text(self, summary: Dict) -> str:
        lines = [f"[묵은지 작업실 {summary['period']} 정산 안내]"]
        for item in summary["items"]:
            status = "완료" if item["status"] == "paid" else "미입금"
            lines.append(
                f"- {item['username']}: {item['plan_name']} / {item['amount']:,}원 ({item['change_label']}) [{status}]"
            )
        return "\n".join(lines)
