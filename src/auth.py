import re
import os
import secrets
import csv
import io
import asyncio
import aiosqlite
import bcrypt
from functools import partial
from typing import Optional, Dict, List, Tuple
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

KST = timezone(timedelta(hours=9))
# 헷갈리기 쉬운 문자(0/O, 1/l/I)를 뺀 임시 비밀번호용 문자 집합
TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PHONE_PATTERN = re.compile(r"^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$")


def normalize_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone.strip())


def is_profile_complete(user: Optional[Dict]) -> bool:
    if not user:
        return False
    name = (user.get("name") or "").strip() or (user.get("username") or "").strip()
    phone = normalize_phone(user.get("phone") or "")
    return len(name) >= 2 and len(phone) >= 10 and phone.startswith("01")


class AuthManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def _run_sync(self, func, *args):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(func, *args))

    async def _validate_user(self, username: str, password: str) -> Optional[Dict]:
        async with self.conn.execute(
            "SELECT username, password, allowed_hours, role, session_epoch FROM users WHERE username = ?",
            (username,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return None
        user = dict(row)
        valid = await self._run_sync(
            bcrypt.checkpw, password.encode("utf-8"), user["password"].encode("utf-8")
        )
        if not valid:
            return None
        return user

    async def login(self, username: str, password: str) -> Optional[Dict]:
        return await self._validate_user(username, password)

    async def register(
        self, username: str, password: str, name: str, phone: str
    ) -> Tuple[bool, str]:
        username = username.strip()
        name = name.strip()
        phone = normalize_phone(phone)

        if len(username) < 2:
            return False, "아이디는 2자 이상이어야 합니다."
        if len(name) < 2:
            return False, "이름은 2자 이상이어야 합니다."
        if len(password) < 4:
            return False, "비밀번호는 4자 이상이어야 합니다."
        if not PHONE_PATTERN.match(phone):
            return False, "올바른 휴대폰 번호 형식이 아닙니다. (예: 010-1234-5678)"
        if username == "admin":
            return False, "사용할 수 없는 아이디입니다."

        async with self.conn.execute("SELECT username FROM users WHERE username = ?", (username,)) as cursor:
            if await cursor.fetchone():
                return False, "이미 사용 중인 아이디입니다."

        async with self.conn.execute("SELECT username FROM users WHERE phone = ?", (phone,)) as cursor:
            if await cursor.fetchone():
                return False, "이미 등록된 전화번호입니다."

        try:
            pw_hash_bytes = await self._run_sync(
                bcrypt.hashpw, password.encode("utf-8"), bcrypt.gensalt()
            )
            now = datetime.now(KST).isoformat()
            await self.conn.execute(
                """
                INSERT INTO users (username, password, allowed_hours, role, name, phone, created_at)
                VALUES (?, ?, 0, 'user', ?, ?, ?)
                """,
                (username, pw_hash_bytes.decode("utf-8"), name, phone, now),
            )
            await self.conn.commit()
            return True, "회원가입이 완료되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"회원가입 실패: {str(e)}"

    async def update_profile(
        self,
        username: str,
        *,
        name: Optional[str] = None,
        phone: Optional[str] = None,
        current_password: Optional[str] = None,
        new_password: Optional[str] = None,
    ) -> Tuple[bool, str]:
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."

        updates: List[str] = []
        params: List[object] = []

        if name is not None:
            name = name.strip()
            if len(name) < 2:
                return False, "이름은 2자 이상이어야 합니다."
            updates.append("name = ?")
            params.append(name)

        if phone is not None:
            phone = normalize_phone(phone)
            if not PHONE_PATTERN.match(phone):
                return False, "올바른 휴대폰 번호 형식이 아닙니다."
            async with self.conn.execute(
                "SELECT username FROM users WHERE phone = ? AND username != ?",
                (phone, username),
            ) as cursor:
                if await cursor.fetchone():
                    return False, "이미 등록된 전화번호입니다."
            updates.append("phone = ?")
            params.append(phone)

        if new_password is not None:
            if not current_password:
                return False, "현재 비밀번호를 입력해주세요."
            if len(new_password) < 4:
                return False, "새 비밀번호는 4자 이상이어야 합니다."
            valid = await self._run_sync(
                bcrypt.checkpw,
                current_password.encode("utf-8"),
                user["password"].encode("utf-8"),
            )
            if not valid:
                return False, "현재 비밀번호가 올바르지 않습니다."
            pw_hash = await self._run_sync(
                bcrypt.hashpw, new_password.encode("utf-8"), bcrypt.gensalt()
            )
            updates.append("password = ?")
            params.append(pw_hash.decode("utf-8"))
            # 비밀번호를 바꾸면 임시 비밀번호 상태를 해제하고, 이전에 발급된 로그인 토큰은 무효화한다
            updates.append("must_change_password = 0")
            updates.append("session_epoch = session_epoch + 1")

        if not updates:
            return False, "변경할 항목이 없습니다."

        params.append(username)
        try:
            await self.conn.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE username = ?",
                params,
            )
            await self.conn.commit()
            return True, "정보가 저장되었습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"저장 실패: {str(e)}"

    async def reset_password(self, username: str) -> Tuple[bool, str]:
        """임시 비밀번호를 발급한다. 성공하면 두 번째 값이 임시 비밀번호(한 번만 보여줄 것)."""
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."
        if user["role"] == "admin":
            return False, "관리자 계정의 비밀번호는 초기화할 수 없습니다."
        temp = "".join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(8))
        pw_hash = await self._run_sync(bcrypt.hashpw, temp.encode("utf-8"), bcrypt.gensalt())
        try:
            await self.conn.execute(
                """UPDATE users
                   SET password = ?, must_change_password = 1, session_epoch = session_epoch + 1
                   WHERE username = ?""",
                (pw_hash.decode("utf-8"), username),
            )
            await self.conn.commit()
            return True, temp
        except Exception as e:
            await self.conn.rollback()
            return False, f"초기화 실패: {str(e)}"

    async def get_delete_preview(self, username: str) -> Optional[Dict]:
        user = await self.get_user_row(username)
        if not user or user["role"] == "admin":
            return None
        counts: Dict[str, int] = {}
        for key, sql in (
            ("reservations", "SELECT COUNT(*) FROM reservations WHERE username = ?"),
            ("billing", "SELECT COUNT(*) FROM billing_cycles WHERE username = ?"),
            ("billing_paid", "SELECT COUNT(*) FROM billing_cycles WHERE username = ? AND status = 'paid'"),
        ):
            async with self.conn.execute(sql, (username,)) as cursor:
                counts[key] = (await cursor.fetchone())[0]
        return {"username": username, "name": user.get("name"), **counts}

    async def delete_user(self, username: str) -> Tuple[bool, str]:
        """회원과 그 예약·청구·구독 기록을 모두 삭제한다 (관리자 계정은 불가)."""
        user = await self.get_user_row(username)
        if not user:
            return False, "사용자를 찾을 수 없습니다."
        if user["role"] == "admin":
            return False, "관리자 계정은 삭제할 수 없습니다."
        try:
            for table in ("reservations", "billing_cycles", "plan_change_requests", "subscriptions"):
                await self.conn.execute(f"DELETE FROM {table} WHERE username = ?", (username,))
            await self.conn.execute("DELETE FROM users WHERE username = ?", (username,))
            await self.conn.commit()
            return True, f"'{user.get('name') or username}' 회원을 삭제했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"삭제 실패: {str(e)}"

    async def get_user_row(self, username: str) -> Optional[Dict]:
        async with self.conn.execute("SELECT * FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_all_users(self) -> List[Dict]:
        async with self.conn.execute(
            "SELECT username, allowed_hours, role FROM users WHERE role != 'admin' ORDER BY username"
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def update_users(self, csv_content: str) -> Tuple[bool, str]:
        try:
            reader = csv.DictReader(io.StringIO(csv_content))
            required = {"username", "password", "allowed_hours", "role"}
            if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
                return False, "CSV 헤더는 username, password, allowed_hours, role 이어야 합니다."

            rows = list(reader)
            if not rows:
                return False, "CSV에 데이터가 없습니다."

            created = updated = skipped = 0
            for row in rows:
                username = (row["username"] or "").strip()
                role = (row["role"] or "").strip()
                if not username or username == "admin" or role == "admin" or not row["password"]:
                    skipped += 1
                    continue
                hours = int(row["allowed_hours"])
                pw_hash = (
                    await self._run_sync(
                        bcrypt.hashpw, row["password"].encode("utf-8"), bcrypt.gensalt()
                    )
                ).decode("utf-8")
                async with self.conn.execute(
                    "SELECT role FROM users WHERE username = ?", (username,)
                ) as cursor:
                    existing = await cursor.fetchone()
                if existing and existing["role"] == "admin":
                    skipped += 1
                    continue
                if existing:
                    await self.conn.execute(
                        "UPDATE users SET password = ?, allowed_hours = ?, role = ? WHERE username = ?",
                        (pw_hash, hours, role, username),
                    )
                    updated += 1
                else:
                    await self.conn.execute(
                        "INSERT INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
                        (username, pw_hash, hours, role),
                    )
                    created += 1
            await self.conn.commit()
            return True, f"신규 {created}명, 갱신 {updated}명, 건너뜀 {skipped}명 (기존 사용자·예약·정산 기록은 삭제하지 않습니다)."
        except Exception as e:
            await self.conn.rollback()
            return False, f"CSV 업로드 실패: {str(e)}"
