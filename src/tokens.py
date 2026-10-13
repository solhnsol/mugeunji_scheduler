"""토큰 충전·장부 관리.

- 토큰은 장부(token_ledger)에 쌓이는 증감 내역의 합이 잔액이다.
- 토큰은 최소 단위 1의 정수다.
- 충전은 [회원이 상품 선택 → 충전 요청(pending) → 관리자 입금 확인 → 장부에 지급] 순서로 진행한다.
  나중에 입금 알림으로 자동 확인할 때도 같은 confirm_purchase를 쓰고 confirmed_by만 'auto'로 남긴다.
"""
import logging
import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import aiosqlite

KST = timezone(timedelta(hours=9))

MAX_PENDING_PURCHASES = 3
MAX_PACK_TOKENS = 10000
logger = logging.getLogger(__name__)

DEFAULT_EXPIRY_MONTHS = 3
PACK_AUDIENCES = ("all", "free")

LEDGER_KIND_LABELS = {
    "purchase": "충전",
    "purchase_undo": "충전 취소",
    "grant": "무료 지급",
    "adjust": "관리자 조정",
    "spend": "예약 사용",
    "refund": "예약 환불",
}


def _now() -> str:
    return datetime.now(KST).isoformat()


def add_months(moment: datetime, months: int) -> datetime:
    month_index = moment.month - 1 + months
    year, month = moment.year + month_index // 12, month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def parse_expires_on(value: Optional[str]) -> Optional[str]:
    """소멸 기한을 검증해 돌려준다. 'YYYY-MM-DD'(그날 끝까지) 또는 'YYYY-MM-DDTHH:MM'(그 시각까지, KST). 빈 값이면 None."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        if "T" in value:
            return datetime.fromisoformat(value).replace(tzinfo=None, second=0, microsecond=0).isoformat(timespec="minutes")
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError("사용 기한은 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 형식이어야 합니다.")


def expiry_moment(value: str) -> datetime:
    """기한 값이 끝나는 순간. 날짜만 있으면 그날이 끝나는 순간(다음 날 0시), 시각이 있으면 그 시각."""
    if "T" in value:
        return datetime.fromisoformat(value).replace(tzinfo=KST)
    day = date.fromisoformat(value) + timedelta(days=1)
    return datetime(day.year, day.month, day.day, tzinfo=KST)


def expiry_at_end_of(value: str) -> str:
    return expiry_moment(value).isoformat()


def is_expired(value: Optional[str]) -> bool:
    return bool(value) and expiry_moment(value) <= datetime.now(KST)


def replay_lots(rows, now: datetime) -> Tuple[List[Dict], Dict]:
    """장부를 순서대로 다시 계산해 아직 남은 지급분(lot)과 사용분별 소멸 시각을 구한다.

    - 지급(+)은 하나의 lot이 되고, 사용(-)은 그 시점에 살아 있는 lot 중 먼저 사라질 것부터 차감한다.
    - now 이전에 소멸 시각이 지난 lot은 남은 토큰에서 빠진다.
    - 사용분을 환불할 때 원래 차감한 lot의 소멸 시각을 이어받도록 (ref_type, ref_id)별로 기록한다.
    """
    lots: List[List] = []
    spend_expiry: Dict = {}
    for r in rows:
        at = datetime.fromisoformat(r["created_at"]) if r["created_at"] else now
        exp = datetime.fromisoformat(r["expires_at"]) if r["expires_at"] else None
        if r["delta"] > 0:
            lots.append([r["delta"], exp])
            continue
        need = -r["delta"]
        live = sorted(
            (lot for lot in lots if lot[0] > 0 and (lot[1] is None or lot[1] > at)),
            key=lambda lot: (lot[1] is None, lot[1] or at),
        )
        earliest = None
        for lot in live:
            if need <= 0:
                break
            take = min(lot[0], need)
            lot[0] -= take
            need -= take
            if lot[1] is not None and (earliest is None or lot[1] < earliest):
                earliest = lot[1]
        if r["ref_type"] and r["ref_id"] is not None:
            spend_expiry[(r["ref_type"], r["ref_id"])] = earliest.isoformat() if earliest else None
    remaining = [
        {"tokens": lot[0], "expires_at": lot[1].isoformat() if lot[1] else None}
        for lot in lots
        if lot[0] > 0 and (lot[1] is None or lot[1] > now)
    ]
    return remaining, spend_expiry


class TokenManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    # ---------- 상품 ----------
    @staticmethod
    def _pack_row(row) -> Dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "price_won": row["price_won"],
            "tokens": row["tokens"],
            "sort_order": row["sort_order"],
            "active": bool(row["active"]),
            "auto_confirm": bool(row["auto_confirm"]),
            "expires_on": row["expires_on"],
            "audience": row["audience"],
        }

    async def list_packs(self, active_only: bool = True) -> List[Dict]:
        query = "SELECT * FROM token_packs"
        if active_only:
            query += " WHERE active = 1"
        query += " ORDER BY sort_order, price_won, id"
        async with self.conn.execute(query) as cursor:
            return [self._pack_row(r) for r in await cursor.fetchall()]

    async def get_pack(self, pack_id: int) -> Optional[Dict]:
        async with self.conn.execute("SELECT * FROM token_packs WHERE id = ?", (pack_id,)) as cursor:
            row = await cursor.fetchone()
        return self._pack_row(row) if row else None

    @staticmethod
    def _validate_pack(
        name: str, price_won: int, tokens: int, auto_confirm: bool = False, audience: str = "all"
    ) -> Optional[str]:
        name = (name or "").strip()
        if not name or len(name) > 30:
            return "상품 이름은 1~30자로 입력해주세요."
        if price_won < (0 if auto_confirm else 1):
            return "결제 금액은 1원 이상이어야 합니다. (무료 상품은 '바로 지급'을 켜야 0원으로 만들 수 있어요)"
        if audience not in PACK_AUDIENCES:
            return "대상은 전체 또는 자유이용 회원이어야 합니다."
        if tokens < 1 or tokens > MAX_PACK_TOKENS:
            return f"토큰은 1 이상 {MAX_PACK_TOKENS} 이하의 정수여야 합니다."
        return None

    async def create_pack(
        self,
        name: str,
        price_won: int,
        tokens: int,
        sort_order: Optional[int] = None,
        *,
        auto_confirm: bool = False,
        expires_on: Optional[str] = None,
        audience: str = "all",
    ) -> Tuple[bool, str]:
        error = self._validate_pack(name, price_won, tokens, auto_confirm, audience)
        if error:
            return False, error
        try:
            expires_on = parse_expires_on(expires_on)
        except ValueError as e:
            return False, str(e)
        try:
            if sort_order is None:
                async with self.conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM token_packs") as cursor:
                    sort_order = (await cursor.fetchone())[0]
            await self.conn.execute(
                """INSERT INTO token_packs (name, price_won, tokens, sort_order, active, created_at, auto_confirm, expires_on, audience)
                   VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)""",
                (name.strip(), price_won, tokens, sort_order, _now(), int(auto_confirm), expires_on, audience),
            )
            await self.conn.commit()
            return True, "상품을 추가했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"상품 추가 실패: {e}"

    async def update_pack(
        self,
        pack_id: int,
        *,
        name: Optional[str] = None,
        price_won: Optional[int] = None,
        tokens: Optional[int] = None,
        sort_order: Optional[int] = None,
        active: Optional[bool] = None,
        auto_confirm: Optional[bool] = None,
        expires_on: Optional[str] = None,
        clear_expires_on: bool = False,
        audience: Optional[str] = None,
    ) -> Tuple[bool, str]:
        pack = await self.get_pack(pack_id)
        if not pack:
            return False, "상품을 찾을 수 없습니다."
        new_name = pack["name"] if name is None else name
        new_price = pack["price_won"] if price_won is None else price_won
        new_tokens = pack["tokens"] if tokens is None else tokens
        new_auto = pack["auto_confirm"] if auto_confirm is None else auto_confirm
        new_audience = pack["audience"] if audience is None else audience
        error = self._validate_pack(new_name, new_price, new_tokens, new_auto, new_audience)
        if error:
            return False, error
        try:
            new_expires_on = None if clear_expires_on else (parse_expires_on(expires_on) or pack["expires_on"])
        except ValueError as e:
            return False, str(e)
        try:
            await self.conn.execute(
                """UPDATE token_packs
                   SET name = ?, price_won = ?, tokens = ?, sort_order = ?, active = ?,
                       auto_confirm = ?, expires_on = ?, audience = ?
                   WHERE id = ?""",
                (
                    new_name.strip(),
                    new_price,
                    new_tokens,
                    pack["sort_order"] if sort_order is None else sort_order,
                    int(pack["active"] if active is None else active),
                    int(new_auto),
                    new_expires_on,
                    new_audience,
                    pack_id,
                ),
            )
            await self.conn.commit()
            return True, "상품을 수정했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"상품 수정 실패: {e}"

    async def delete_pack(self, pack_id: int) -> Tuple[bool, str]:
        """충전 요청에는 상품 이름·금액·토큰이 그대로 기록돼 있어 상품을 지워도 내역은 유지된다."""
        if not await self.get_pack(pack_id):
            return False, "상품을 찾을 수 없습니다."
        try:
            await self.conn.execute("DELETE FROM token_packs WHERE id = ?", (pack_id,))
            await self.conn.commit()
            return True, "상품을 삭제했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"상품 삭제 실패: {e}"

    # ---------- 잔액·장부 ----------
    async def _ledger_rows(self, username: str):
        async with self.conn.execute(
            """SELECT delta, kind, ref_type, ref_id, created_at, expires_at
               FROM token_ledger WHERE username = ? ORDER BY id""",
            (username,),
        ) as cursor:
            return await cursor.fetchall()

    async def get_lots(self, username: str) -> List[Dict]:
        """아직 남아 있는 지급분 목록 (소멸이 빠른 순)."""
        lots, _ = replay_lots(await self._ledger_rows(username), datetime.now(KST))
        return sorted(lots, key=lambda lot: (lot["expires_at"] is None, lot["expires_at"] or ""))

    async def get_balance(self, username: str) -> int:
        lots, _ = replay_lots(await self._ledger_rows(username), datetime.now(KST))
        return sum(lot["tokens"] for lot in lots)

    async def spend_expiries(self, username: str) -> Dict:
        """(ref_type, ref_id) -> 그 사용분이 차감한 지급분의 소멸 시각. 환불이 같은 소멸 시각을 이어받는 데 쓴다."""
        _, spend_expiry = replay_lots(await self._ledger_rows(username), datetime.now(KST))
        return spend_expiry

    async def default_expiry_at(self, expires_on: Optional[str] = None) -> str:
        """새 지급분의 소멸 시각. expires_on(날짜)이 있으면 그날 끝, 없으면 설정한 개월 수 뒤."""
        if expires_on:
            return expiry_at_end_of(expires_on)
        async with self.conn.execute("SELECT value FROM system_settings WHERE key = 'token_expiry_months'") as cursor:
            row = await cursor.fetchone()
        try:
            months = int(row["value"]) if row and row["value"] else DEFAULT_EXPIRY_MONTHS
        except (TypeError, ValueError):
            months = DEFAULT_EXPIRY_MONTHS
        return add_months(datetime.now(KST), max(months, 0)).isoformat()

    async def add_ledger(
        self,
        username: str,
        delta: int,
        kind: str,
        *,
        ref_type: Optional[str] = None,
        ref_id: Optional[int] = None,
        memo: Optional[str] = None,
        created_by: Optional[str] = None,
        expires_at: Optional[str] = None,
        commit: bool = True,
    ) -> int:
        """장부에 한 줄 추가. 예약 등 다른 작업과 한 트랜잭션으로 묶으려면 commit=False.

        expires_at은 지급(+)분이 사라지는 시각이다 (없으면 소멸하지 않음).
        """
        cursor = await self.conn.execute(
            """INSERT INTO token_ledger (username, delta, kind, ref_type, ref_id, memo, created_at, created_by, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (username, delta, kind, ref_type, ref_id, memo, _now(), created_by, expires_at),
        )
        if commit:
            await self.conn.commit()
        return cursor.lastrowid

    async def list_ledger(self, username: str, limit: int = 50) -> List[Dict]:
        async with self.conn.execute(
            "SELECT * FROM token_ledger WHERE username = ? ORDER BY id DESC LIMIT ?", (username, limit)
        ) as cursor:
            rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "tokens": r["delta"],
                "kind": r["kind"],
                "kind_label": LEDGER_KIND_LABELS.get(r["kind"], r["kind"]),
                "memo": r["memo"],
                "created_at": r["created_at"],
                "created_by": r["created_by"],
                "expires_at": r["expires_at"],
            }
            for r in rows
        ]

    async def list_balances(self) -> List[Dict]:
        async with self.conn.execute(
            """SELECT username, name, phone, role, dawn_allowed FROM users WHERE role != 'admin' ORDER BY username"""
        ) as cursor:
            users = await cursor.fetchall()
        async with self.conn.execute(
            """SELECT l.username, l.delta, l.kind, l.ref_type, l.ref_id, l.created_at, l.expires_at
               FROM token_ledger l JOIN users u ON u.username = l.username
               WHERE u.role != 'admin' ORDER BY l.id"""
        ) as cursor:
            ledger = await cursor.fetchall()
        by_user: Dict[str, List] = {}
        last_activity: Dict[str, str] = {}
        for r in ledger:
            by_user.setdefault(r["username"], []).append(r)
            last_activity[r["username"]] = r["created_at"]
        now = datetime.now(KST)
        result = []
        for u in users:
            lots, _ = replay_lots(by_user.get(u["username"], []), now)
            expiring = [lot["expires_at"] for lot in lots if lot["expires_at"]]
            result.append({
                "username": u["username"],
                "name": u["name"],
                "phone": u["phone"],
                "role": u["role"],
                "dawn_allowed": bool(u["dawn_allowed"]),
                "balance": sum(lot["tokens"] for lot in lots),
                "next_expiry": min(expiring) if expiring else None,
                "last_activity": last_activity.get(u["username"]),
            })
        return result

    async def adjust(
        self, username: str, tokens: int, memo: str, admin_username: str, expires_on: Optional[str] = None
    ) -> Tuple[bool, str]:
        if tokens == 0:
            return False, "조정할 토큰을 0이 아닌 정수로 입력해주세요."
        memo = (memo or "").strip()
        if not memo:
            return False, "조정 사유를 입력해주세요."
        async with self.conn.execute("SELECT role FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "사용자를 찾을 수 없습니다."
        if row["role"] == "admin":
            return False, "관리자 계정에는 토큰을 조정할 수 없습니다."
        balance = await self.get_balance(username)
        if balance + tokens < 0:
            return False, f"잔액({balance}토큰)보다 많이 차감할 수 없습니다."
        try:
            expires_at = await self.default_expiry_at(parse_expires_on(expires_on)) if tokens > 0 else None
        except ValueError as e:
            return False, str(e)
        if expires_at and datetime.fromisoformat(expires_at) <= datetime.now(KST):
            return False, "사용 기한이 이미 지났어요."
        try:
            await self.add_ledger(
                username, tokens, "adjust", memo=memo, created_by=admin_username, expires_at=expires_at
            )
            sign = "+" if tokens > 0 else ""
            return True, f"{username}님의 토큰을 {sign}{tokens} 조정했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"조정 실패: {e}"

    async def grant_many(
        self, usernames: List[str], tokens: int, memo: str, admin_username: str, expires_on: Optional[str] = None
    ) -> Tuple[bool, str]:
        """여러 회원에게 무료 토큰을 한 번에 지급한다 (한 트랜잭션)."""
        usernames = sorted({u for u in usernames if u})
        if not usernames:
            return False, "지급할 회원을 선택해주세요."
        if tokens < 1 or tokens > MAX_PACK_TOKENS:
            return False, f"지급 토큰은 1 이상 {MAX_PACK_TOKENS} 이하의 정수여야 합니다."
        memo = (memo or "").strip()
        if not memo:
            return False, "지급 사유를 입력해주세요."
        try:
            expires_at = await self.default_expiry_at(parse_expires_on(expires_on))
        except ValueError as e:
            return False, str(e)
        if datetime.fromisoformat(expires_at) <= datetime.now(KST):
            return False, "사용 기한이 이미 지났어요."
        placeholders = ",".join("?" * len(usernames))
        async with self.conn.execute(
            f"SELECT username FROM users WHERE role != 'admin' AND username IN ({placeholders})", usernames
        ) as cursor:
            found = {r["username"] for r in await cursor.fetchall()}
        missing = [u for u in usernames if u not in found]
        if missing:
            return False, f"찾을 수 없는 회원이 있어요: {', '.join(missing)}"
        try:
            for username in usernames:
                await self.add_ledger(
                    username, tokens, "grant", memo=memo, created_by=admin_username,
                    expires_at=expires_at, commit=False,
                )
            await self.conn.commit()
            return True, f"{len(usernames)}명에게 {tokens}토큰씩 지급했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"지급 실패: {e}"

    # ---------- 충전 요청 ----------
    @staticmethod
    def _purchase_row(row) -> Dict:
        return {
            "id": row["id"],
            "username": row["username"],
            "name": row["name"] if "name" in row.keys() else None,
            "phone": row["phone"] if "phone" in row.keys() else None,
            "pack_id": row["pack_id"],
            "pack_name": row["pack_name"],
            "price_won": row["price_won"],
            "tokens": row["tokens"],
            "status": row["status"],
            "created_at": row["created_at"],
            "confirmed_at": row["confirmed_at"],
            "confirmed_by": row["confirmed_by"],
            "memo": row["memo"],
            "expires_on": row["expires_on"],
        }

    async def request_purchase(self, username: str, pack_id: int) -> Tuple[bool, str]:
        pack = await self.get_pack(pack_id)
        if not pack or not pack["active"]:
            return False, "선택할 수 없는 상품입니다."
        if is_expired(pack["expires_on"]):
            return False, "이미 종료된 상품입니다."
        if pack["audience"] == "free":
            async with self.conn.execute("SELECT role FROM users WHERE username = ?", (username,)) as cursor:
                user = await cursor.fetchone()
            if not user or user["role"] not in ("free", "admin"):
                return False, "자유이용 회원만 받을 수 있는 상품입니다."
        if not pack["auto_confirm"]:
            async with self.conn.execute(
                "SELECT COUNT(*) FROM token_purchases WHERE username = ? AND status = 'pending'", (username,)
            ) as cursor:
                pending = (await cursor.fetchone())[0]
            if pending >= MAX_PENDING_PURCHASES:
                return False, f"확인 대기 중인 충전 요청이 이미 {MAX_PENDING_PURCHASES}건 있어요. 확인이 끝난 뒤 다시 요청해주세요."
        try:
            cursor = await self.conn.execute(
                """INSERT INTO token_purchases (username, pack_id, pack_name, price_won, tokens, status, created_at, expires_on)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (username, pack["id"], pack["name"], pack["price_won"], pack["tokens"], _now(), pack["expires_on"]),
            )
            await self.conn.commit()
        except Exception as e:
            await self.conn.rollback()
            logger.exception("token purchase request failed")
            return False, "충전 요청에 실패했어요. 잠시 뒤 다시 시도해주세요."
        if pack["auto_confirm"]:
            ok, _ = await self.confirm_purchase(cursor.lastrowid, "auto")
            if not ok:
                return False, "토큰 지급에 실패했어요. 잠시 뒤 다시 시도해주세요."
            return True, f"{pack['tokens']}토큰이 바로 지급됐어요."
        return True, "충전을 요청했어요. 관리자가 확인한 뒤 연락처로 입금 안내를 드릴게요. 조금만 기다려 주세요."

    async def list_user_purchases(self, username: str, limit: int = 20) -> List[Dict]:
        async with self.conn.execute(
            "SELECT * FROM token_purchases WHERE username = ? ORDER BY id DESC LIMIT ?", (username, limit)
        ) as cursor:
            return [self._purchase_row(r) for r in await cursor.fetchall()]

    async def cancel_own_purchase(self, username: str, purchase_id: int) -> Tuple[bool, str]:
        async with self.conn.execute(
            "SELECT * FROM token_purchases WHERE id = ? AND username = ?", (purchase_id, username)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "충전 요청을 찾을 수 없습니다."
        if row["status"] != "pending":
            return False, "이미 처리된 요청은 취소할 수 없어요."
        try:
            await self.conn.execute(
                "UPDATE token_purchases SET status = 'cancelled', memo = ? WHERE id = ?", ("회원이 취소", purchase_id)
            )
            await self.conn.commit()
            return True, "충전 요청을 취소했어요."
        except Exception as e:
            await self.conn.rollback()
            logger.exception("token purchase cancel failed")
            return False, "취소하지 못했어요. 잠시 뒤 다시 시도해주세요."

    async def list_purchases(self, status: Optional[str] = None, limit: int = 100) -> List[Dict]:
        query = """
            SELECT p.*, u.name AS name, u.phone AS phone
            FROM token_purchases p LEFT JOIN users u ON u.username = p.username
        """
        params: Tuple = ()
        if status:
            query += " WHERE p.status = ?"
            params = (status,)
        query += " ORDER BY p.id DESC LIMIT ?"
        async with self.conn.execute(query, params + (limit,)) as cursor:
            return [self._purchase_row(r) for r in await cursor.fetchall()]

    async def confirm_purchase(self, purchase_id: int, confirmed_by: str) -> Tuple[bool, str]:
        """입금을 확인해 토큰을 지급한다. confirmed_by: 관리자 아이디 또는 'auto'(자동 확인)."""
        async with self.conn.execute("SELECT * FROM token_purchases WHERE id = ?", (purchase_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "충전 요청을 찾을 수 없습니다."
        if row["status"] != "pending":
            return False, "확인 대기 중인 요청이 아닙니다."
        try:
            expires_at = await self.default_expiry_at(row["expires_on"])
            await self.add_ledger(
                row["username"], row["tokens"], "purchase",
                ref_type="purchase", ref_id=purchase_id,
                memo=f"{row['pack_name']} ({row['price_won']:,}원)", created_by=confirmed_by,
                expires_at=expires_at, commit=False,
            )
            await self.conn.execute(
                "UPDATE token_purchases SET status = 'confirmed', confirmed_at = ?, confirmed_by = ? WHERE id = ?",
                (_now(), confirmed_by, purchase_id),
            )
            await self.conn.commit()
            return True, f"{row['username']}님께 {row['tokens']}토큰을 지급했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"확인 실패: {e}"

    async def reject_purchase(self, purchase_id: int, memo: Optional[str] = None) -> Tuple[bool, str]:
        async with self.conn.execute("SELECT status FROM token_purchases WHERE id = ?", (purchase_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "충전 요청을 찾을 수 없습니다."
        if row["status"] != "pending":
            return False, "확인 대기 중인 요청이 아닙니다."
        try:
            await self.conn.execute(
                "UPDATE token_purchases SET status = 'cancelled', memo = ? WHERE id = ?",
                ((memo or "").strip() or "관리자가 반려", purchase_id),
            )
            await self.conn.commit()
            return True, "충전 요청을 반려했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"반려 실패: {e}"

    async def undo_confirm_purchase(self, purchase_id: int, admin_username: str) -> Tuple[bool, str]:
        """잘못 확인한 충전을 되돌린다. 지급한 토큰을 이미 썼다면 되돌릴 수 없다."""
        async with self.conn.execute("SELECT * FROM token_purchases WHERE id = ?", (purchase_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "충전 요청을 찾을 수 없습니다."
        if row["status"] != "confirmed":
            return False, "확인된 충전이 아닙니다."
        if await self.get_balance(row["username"]) < row["tokens"]:
            return False, "지급한 토큰을 이미 사용해 되돌릴 수 없어요. 필요하면 토큰 조정으로 처리해주세요."
        try:
            await self.add_ledger(
                row["username"], -row["tokens"], "purchase_undo",
                ref_type="purchase", ref_id=purchase_id,
                memo=f"{row['pack_name']} 확인 취소", created_by=admin_username, commit=False,
            )
            await self.conn.execute(
                "UPDATE token_purchases SET status = 'pending', confirmed_at = NULL, confirmed_by = NULL WHERE id = ?",
                (purchase_id,),
            )
            await self.conn.commit()
            return True, "충전 확인을 취소했습니다. 요청은 다시 확인 대기 상태가 됩니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"취소 실패: {e}"
