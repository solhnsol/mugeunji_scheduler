"""토큰 충전·장부 관리.

- 토큰은 장부(token_ledger)에 쌓이는 증감 내역의 합이 잔액이다.
- 금액은 '유닛' 정수로 저장한다 (1토큰 = 2유닛, 즉 최소 단위 0.5토큰).
- 충전은 [회원이 상품 선택 → 충전 요청(pending) → 관리자 입금 확인 → 장부에 지급] 순서로 진행한다.
  나중에 입금 알림으로 자동 확인할 때도 같은 confirm_purchase를 쓰고 confirmed_by만 'auto'로 남긴다.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import aiosqlite

KST = timezone(timedelta(hours=9))

UNITS_PER_TOKEN = 2
MAX_PENDING_PURCHASES = 3
MAX_PACK_TOKENS = 10000

LEDGER_KIND_LABELS = {
    "purchase": "충전",
    "purchase_undo": "충전 취소",
    "adjust": "관리자 조정",
    "spend": "예약 사용",
    "refund": "예약 환불",
}


def to_units(tokens: float) -> Optional[int]:
    """토큰(소수 0.5 단위) → 유닛. 0.5 단위가 아니면 None."""
    doubled = tokens * UNITS_PER_TOKEN
    if abs(doubled - round(doubled)) > 1e-9:
        return None
    return int(round(doubled))


def from_units(units: int) -> float:
    """유닛 → 토큰. 정수면 int로 돌려줘 JSON에서 8.0 대신 8로 보이게 한다."""
    value = units / UNITS_PER_TOKEN
    return int(value) if value == int(value) else value


def _now() -> str:
    return datetime.now(KST).isoformat()


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
            "tokens": from_units(row["tokens_units"]),
            "sort_order": row["sort_order"],
            "active": bool(row["active"]),
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
    def _validate_pack(name: str, price_won: int, tokens: float) -> Tuple[Optional[str], Optional[int]]:
        name = (name or "").strip()
        if not name or len(name) > 30:
            return "상품 이름은 1~30자로 입력해주세요.", None
        if price_won < 1:
            return "결제 금액은 1원 이상이어야 합니다.", None
        units = to_units(tokens)
        if units is None:
            return "토큰은 0.5 단위로 입력해주세요.", None
        if units <= 0 or tokens > MAX_PACK_TOKENS:
            return f"토큰은 0보다 크고 {MAX_PACK_TOKENS} 이하여야 합니다.", None
        return None, units

    async def create_pack(self, name: str, price_won: int, tokens: float, sort_order: Optional[int] = None) -> Tuple[bool, str]:
        error, units = self._validate_pack(name, price_won, tokens)
        if error:
            return False, error
        try:
            if sort_order is None:
                async with self.conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM token_packs") as cursor:
                    sort_order = (await cursor.fetchone())[0]
            await self.conn.execute(
                "INSERT INTO token_packs (name, price_won, tokens_units, sort_order, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                (name.strip(), price_won, units, sort_order, _now()),
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
        tokens: Optional[float] = None,
        sort_order: Optional[int] = None,
        active: Optional[bool] = None,
    ) -> Tuple[bool, str]:
        pack = await self.get_pack(pack_id)
        if not pack:
            return False, "상품을 찾을 수 없습니다."
        new_name = pack["name"] if name is None else name
        new_price = pack["price_won"] if price_won is None else price_won
        new_tokens = pack["tokens"] if tokens is None else tokens
        error, units = self._validate_pack(new_name, new_price, new_tokens)
        if error:
            return False, error
        try:
            await self.conn.execute(
                """UPDATE token_packs
                   SET name = ?, price_won = ?, tokens_units = ?, sort_order = ?, active = ?
                   WHERE id = ?""",
                (
                    new_name.strip(),
                    new_price,
                    units,
                    pack["sort_order"] if sort_order is None else sort_order,
                    int(pack["active"] if active is None else active),
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
    async def get_balance_units(self, username: str) -> int:
        async with self.conn.execute(
            "SELECT COALESCE(SUM(delta_units), 0) FROM token_ledger WHERE username = ?", (username,)
        ) as cursor:
            return (await cursor.fetchone())[0]

    async def get_balance(self, username: str) -> float:
        return from_units(await self.get_balance_units(username))

    async def add_ledger(
        self,
        username: str,
        delta_units: int,
        kind: str,
        *,
        ref_type: Optional[str] = None,
        ref_id: Optional[int] = None,
        memo: Optional[str] = None,
        created_by: Optional[str] = None,
        commit: bool = True,
    ) -> int:
        """장부에 한 줄 추가. 예약 등 다른 작업과 한 트랜잭션으로 묶으려면 commit=False."""
        cursor = await self.conn.execute(
            """INSERT INTO token_ledger (username, delta_units, kind, ref_type, ref_id, memo, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (username, delta_units, kind, ref_type, ref_id, memo, _now(), created_by),
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
                "tokens": from_units(r["delta_units"]),
                "kind": r["kind"],
                "kind_label": LEDGER_KIND_LABELS.get(r["kind"], r["kind"]),
                "memo": r["memo"],
                "created_at": r["created_at"],
                "created_by": r["created_by"],
            }
            for r in rows
        ]

    async def list_balances(self) -> List[Dict]:
        async with self.conn.execute(
            """
            SELECT u.username, u.name, u.phone,
                   COALESCE(SUM(l.delta_units), 0) AS balance_units,
                   MAX(l.created_at) AS last_activity
            FROM users u
            LEFT JOIN token_ledger l ON l.username = u.username
            WHERE u.role != 'admin'
            GROUP BY u.username
            ORDER BY u.username
            """
        ) as cursor:
            rows = await cursor.fetchall()
        return [
            {
                "username": r["username"],
                "name": r["name"],
                "phone": r["phone"],
                "balance": from_units(r["balance_units"]),
                "last_activity": r["last_activity"],
            }
            for r in rows
        ]

    async def adjust(self, username: str, tokens: float, memo: str, admin_username: str) -> Tuple[bool, str]:
        units = to_units(tokens)
        if units is None or units == 0:
            return False, "조정할 토큰을 0.5 단위로, 0이 아닌 값으로 입력해주세요."
        memo = (memo or "").strip()
        if not memo:
            return False, "조정 사유를 입력해주세요."
        async with self.conn.execute("SELECT role FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, "사용자를 찾을 수 없습니다."
        if row["role"] == "admin":
            return False, "관리자 계정에는 토큰을 조정할 수 없습니다."
        balance = await self.get_balance_units(username)
        if balance + units < 0:
            return False, f"잔액({from_units(balance)}토큰)보다 많이 차감할 수 없습니다."
        try:
            await self.add_ledger(username, units, "adjust", memo=memo, created_by=admin_username)
            sign = "+" if units > 0 else ""
            return True, f"{username}님의 토큰을 {sign}{from_units(units)} 조정했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"조정 실패: {e}"

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
            "tokens": from_units(row["tokens_units"]),
            "status": row["status"],
            "created_at": row["created_at"],
            "confirmed_at": row["confirmed_at"],
            "confirmed_by": row["confirmed_by"],
            "memo": row["memo"],
        }

    async def request_purchase(self, username: str, pack_id: int) -> Tuple[bool, str]:
        pack = await self.get_pack(pack_id)
        if not pack or not pack["active"]:
            return False, "선택할 수 없는 상품입니다."
        async with self.conn.execute(
            "SELECT COUNT(*) FROM token_purchases WHERE username = ? AND status = 'pending'", (username,)
        ) as cursor:
            pending = (await cursor.fetchone())[0]
        if pending >= MAX_PENDING_PURCHASES:
            return False, f"확인 대기 중인 충전 요청이 이미 {MAX_PENDING_PURCHASES}건 있어요. 확인이 끝난 뒤 다시 요청해주세요."
        try:
            await self.conn.execute(
                """INSERT INTO token_purchases (username, pack_id, pack_name, price_won, tokens_units, status, created_at)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
                (username, pack["id"], pack["name"], pack["price_won"], to_units(pack["tokens"]), _now()),
            )
            await self.conn.commit()
            return True, "충전을 요청했어요. 관리자가 확인한 뒤 연락처로 입금 안내를 드릴게요. 조금만 기다려 주세요."
        except Exception as e:
            await self.conn.rollback()
            return False, f"충전 요청 실패: {e}"

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
            return False, f"취소 실패: {e}"

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
            await self.add_ledger(
                row["username"], row["tokens_units"], "purchase",
                ref_type="purchase", ref_id=purchase_id,
                memo=f"{row['pack_name']} ({row['price_won']:,}원)", created_by=confirmed_by, commit=False,
            )
            await self.conn.execute(
                "UPDATE token_purchases SET status = 'confirmed', confirmed_at = ?, confirmed_by = ? WHERE id = ?",
                (_now(), confirmed_by, purchase_id),
            )
            await self.conn.commit()
            return True, f"{row['username']}님께 {from_units(row['tokens_units'])}토큰을 지급했습니다."
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
        if await self.get_balance_units(row["username"]) < row["tokens_units"]:
            return False, "지급한 토큰을 이미 사용해 되돌릴 수 없어요. 필요하면 토큰 조정으로 처리해주세요."
        try:
            await self.add_ledger(
                row["username"], -row["tokens_units"], "purchase_undo",
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
