import aiosqlite
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

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

    async def sync_user_entitlements(self, username: str) -> None:
        user = await self.get_user_row(username)
        if not user or user["role"] == "admin":
            return
        hours, _, _ = await self.get_effective_hours_and_price(username)
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

    async def get_open_settlement(self) -> Optional[Dict]:
        async with self.conn.execute(
            "SELECT * FROM settlement_periods WHERE status = 'open' ORDER BY period DESC LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row else None

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
        """이번 달(usage_period) 입금 여부에 맞춰 구독 상태 동기화."""
        billing = await self.get_billing_cycle(username, usage_period())
        now = datetime.now(KST).isoformat()
        if billing and billing["status"] == "paid":
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

    async def get_access_status(self, username: str) -> Dict:
        user = await self.get_user_row(username)
        if not user:
            return {"access_status": "unknown", "can_access_schedule": False, "message": "사용자를 찾을 수 없습니다."}
        if user["role"] == "admin":
            return {
                "access_status": "active",
                "can_access_schedule": True,
                "message": "관리자",
                "subscription": None,
                "billing": None,
                "access_period": usage_period(),
            }

        sub = await self.get_subscription(username)
        if not sub:
            return {
                "access_status": "no_plan",
                "can_access_schedule": False,
                "message": "요금제를 신청해주세요.",
                "subscription": None,
                "billing": None,
                "access_period": usage_period(),
            }

        active_period = usage_period()
        billing = await self.get_billing_cycle(username, active_period)
        hours, price, _ = await self.get_effective_hours_and_price(username)

        pending_change = await self._get_pending_plan_change(username)
        open_settlement = await self.get_open_settlement()
        pending_cancellation = self._pending_cancellation(sub)

        if billing and billing["status"] == "paid":
            return {
                "access_status": "active",
                "can_access_schedule": True,
                "message": "이용 가능",
                "subscription": self._public_subscription(sub, hours, price),
                "billing": self._public_billing(billing),
                "access_period": active_period,
                "pending_plan_change": pending_change,
                "pending_cancellation": pending_cancellation,
                "open_settlement_period": open_settlement["period"] if open_settlement else None,
            }

        if billing and billing["status"] == "pending":
            return {
                "access_status": "pending_payment",
                "can_access_schedule": False,
                "message": f"{billing['period']} 이용 요금 입금 확인 후 시간표를 이용할 수 있습니다.",
                "subscription": self._public_subscription(sub, hours, price),
                "billing": self._public_billing(billing),
                "access_period": active_period,
                "pending_plan_change": pending_change,
                "pending_cancellation": pending_cancellation,
                "open_settlement_period": open_settlement["period"] if open_settlement else None,
            }

        return {
            "access_status": "pending_payment",
            "can_access_schedule": False,
            "message": f"{active_period} 이용 요금 입금 확인 후 시간표를 이용할 수 있습니다.",
            "subscription": self._public_subscription(sub, hours, price),
            "billing": None,
            "access_period": active_period,
            "pending_plan_change": pending_change,
            "pending_cancellation": pending_cancellation,
            "open_settlement_period": open_settlement["period"] if open_settlement else None,
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

    async def apply_for_plan(self, username: str, plan_id: int) -> Tuple[bool, str]:
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

        open_settlement = await self.get_open_settlement()
        try:
            if existing:
                await self.conn.execute(
                    "UPDATE subscriptions SET plan_id = ?, status = 'pending_payment', updated_at = ? WHERE username = ?",
                    (plan_id, datetime.now(KST).isoformat(), username),
                )
            else:
                await self.conn.execute(
                    """
                    INSERT INTO subscriptions (username, plan_id, status, auto_renew, created_at, updated_at)
                    VALUES (?, ?, 'pending_payment', 1, ?, ?)
                    """,
                    (username, plan_id, datetime.now(KST).isoformat(), datetime.now(KST).isoformat()),
                )

            await self.sync_user_entitlements(username)

            if open_settlement:
                await self._ensure_billing_cycle(username, open_settlement["period"], billing_type="new")
                await self.conn.commit()
                return True, f"{open_settlement['period']} 요금제 신청이 완료되었습니다. 입금 확인 후 이용 가능합니다."

            await self.conn.commit()
            return True, "요금제 신청이 완료되었습니다. 다음 달 정산이 열리면 입금 안내가 표시됩니다."
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

        open_settlement = await self.get_open_settlement()
        effective_period = open_settlement["period"] if open_settlement else period_from_offset(1)

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

        open_settlement = await self.get_open_settlement()
        effective_period = open_settlement["period"] if open_settlement else period_from_offset(1)
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

    async def open_settlement(self, period: str, admin_username: str) -> Tuple[bool, str]:
        if not period or len(period) != 7:
            return False, "정산 기간 형식이 올바르지 않습니다. (YYYY-MM)"

        existing_open = await self.get_open_settlement()
        if existing_open:
            return False, f"이미 {existing_open['period']} 정산이 열려 있습니다. 먼저 마감하거나 입금을 처리해주세요."

        try:
            await self.conn.execute(
                """
                INSERT INTO settlement_periods (period, status, opened_at, opened_by)
                VALUES (?, 'open', ?, ?)
                """,
                (period, datetime.now(KST).isoformat(), admin_username),
            )

            async with self.conn.execute(
                """
                SELECT username FROM subscriptions
                WHERE status IN ('active', 'pending_payment')
                """
            ) as cursor:
                subscribers = await cursor.fetchall()

            created = 0
            for row in subscribers:
                username = row["username"]
                user = await self.get_user_row(username)
                if not user or user["role"] == "admin":
                    continue
                plan_id = await self._resolve_plan_for_period(username, period)
                await self.conn.execute(
                    "UPDATE subscriptions SET plan_id = ? WHERE username = ?",
                    (plan_id, username),
                )
                billing = await self._ensure_billing_cycle(username, period)
                if billing:
                    created += 1
                await self.sync_user_entitlements(username)

            await self.conn.commit()
            return True, f"{period} 다음 달 정산이 열렸습니다. 청구 대상 {created}명"
        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            return False, f"{period} 정산 기간이 이미 존재합니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"정산 열기 실패: {str(e)}"

    async def close_settlement(self, period: str) -> Tuple[bool, str]:
        try:
            await self.conn.execute(
                "UPDATE settlement_periods SET status = 'closed', closed_at = ? WHERE period = ? AND status = 'open'",
                (datetime.now(KST).isoformat(), period),
            )
            if self.conn.total_changes == 0:
                await self.conn.rollback()
                return False, "열린 정산 기간을 찾을 수 없습니다."
            await self.conn.commit()
            return True, f"{period} 정산이 마감되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"정산 마감 실패: {str(e)}"

    async def reopen_settlement(self, period: str) -> Tuple[bool, str]:
        existing_open = await self.get_open_settlement()
        if existing_open:
            return False, f"이미 {existing_open['period']} 정산이 열려 있습니다."

        try:
            await self.conn.execute(
                """
                UPDATE settlement_periods
                SET status = 'open', closed_at = NULL
                WHERE period = ? AND status = 'closed'
                """,
                (period,),
            )
            if self.conn.total_changes == 0:
                await self.conn.rollback()
                return False, "마감된 정산 기간을 찾을 수 없습니다."
            await self.conn.commit()
            return True, f"{period} 정산이 다시 열렸습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"정산 다시 열기 실패: {str(e)}"

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

        settlement = None
        async with self.conn.execute(
            "SELECT * FROM settlement_periods WHERE period = ?", (period,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                settlement = dict(row)

        return {
            "period": period,
            "settlement": settlement,
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
                   p.name AS plan_name, p.monthly_price AS plan_monthly_price
            FROM users u
            LEFT JOIN subscriptions s ON s.username = u.username
            LEFT JOIN plans p ON p.id = s.plan_id
            WHERE u.role != 'admin'
            ORDER BY u.username
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

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

        try:
            if clear_custom_hours:
                await self.conn.execute(
                    "UPDATE users SET custom_allowed_hours = NULL WHERE username = ?", (username,)
                )
            elif hours_to_set is not None:
                await self.conn.execute(
                    "UPDATE users SET custom_allowed_hours = ? WHERE username = ?", (hours_to_set, username)
                )

            if free_access is not None:
                hours, _, _ = await self.get_effective_hours_and_price(username)
                if hours_to_set is not None:
                    hours = hours_to_set
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

            if plan_id is not None:
                sub = await self.get_subscription(username)
                if sub:
                    await self.conn.execute(
                        "UPDATE subscriptions SET plan_id = ?, updated_at = ? WHERE username = ?",
                        (plan_id, datetime.now(KST).isoformat(), username),
                    )
                else:
                    await self.conn.execute(
                        """
                        INSERT INTO subscriptions (username, plan_id, status, auto_renew, created_at, updated_at)
                        VALUES (?, ?, 'pending_payment', 1, ?, ?)
                        """,
                        (username, plan_id, datetime.now(KST).isoformat(), datetime.now(KST).isoformat()),
                    )

            if auto_renew is not None:
                await self.conn.execute(
                    "UPDATE subscriptions SET auto_renew = ? WHERE username = ?",
                    (1 if auto_renew else 0, username),
                )

            open_settlement = await self.get_open_settlement()
            if open_settlement:
                billing = await self.get_billing_cycle(username, open_settlement["period"])
                if billing and billing["status"] == "pending":
                    _, price, _ = await self.get_effective_hours_and_price(username)
                    resolved_plan = plan_id if plan_id is not None else billing["plan_id"]
                    await self.conn.execute(
                        "UPDATE billing_cycles SET plan_id = ?, amount = ? WHERE id = ?",
                        (resolved_plan, price, billing["id"]),
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
