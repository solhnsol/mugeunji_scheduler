# auth.py
import aiosqlite
from typing import Optional, Dict, List, Tuple

class AuthManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def login(self, username: str, password: str) -> Optional[Dict]:
        cursor = await self.conn.cursor()
        await cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user_data = await cursor.fetchone()
        await cursor.close()

        if user_data and user_data['password'] == password:
            return dict(user_data)
        return None
    
    async def admin_login(self, username: str, password: str) -> Optional[Dict]:
        cursor = await self.conn.cursor()
        await cursor.execute(
            "SELECT * FROM users WHERE username = ? AND role = 'admin'",
            (username,)
        )
        user_data = await cursor.fetchone()
        await cursor.close()

        if user_data and user_data['password'] == password:
            return dict(user_data)
        return None

    async def update_users(self, new_users: List[Dict]) -> Tuple[bool, str]:
        cursor = await self.conn.cursor()
        try:
            await cursor.execute("BEGIN TRANSACTION")
            await cursor.execute("DELETE FROM users")
            users_to_insert = [
                (u['username'], u['password'], u['allowed_hours'], u['role'])
                for u in new_users
            ]
            await cursor.executemany(
                "INSERT INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
                users_to_insert
            )
            await self.conn.commit()
            return True, f"성공: {len(new_users)}명의 사용자로 목록을 교체했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"실패: {str(e)}"
        finally:
            await cursor.close()