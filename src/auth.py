# auth.py
import asyncpg
from typing import Optional, Dict, List, Tuple

class AuthManager:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def login(self, username: str, password: str) -> Optional[Dict]:
        user_data = await self.conn.fetchrow(
            "SELECT * FROM users WHERE username = $1", username
        )

        if user_data and user_data['password'] == password:
            return dict(user_data)
        return None
    
    async def admin_login(self, username: str, password: str) -> Optional[Dict]:
        user_data = await self.conn.fetchrow(
            "SELECT * FROM users WHERE username = $1 AND role = 'admin'",
            username
        )

        if user_data and user_data['password'] == password:
            return dict(user_data)
        return None

    async def update_users(self, new_users: List[Dict]) -> Tuple[bool, str]:
        try:
            async with self.conn.transaction():
                await self.conn.execute("DELETE FROM users")
                
                await self.conn.execute(
                    "INSERT INTO users (username, password, allowed_hours, role) VALUES ($1, $2, $3, $4)",
                    "admin", "1885", 0, "admin"
                )
                
                users_to_insert = [
                    (u['username'], u['password'], u['allowed_hours'], u['role'])
                    for u in new_users
                ]

                await self.conn.executemany(
                    "INSERT INTO users (username, password, allowed_hours, role) VALUES ($1, $2, $3, $4)",
                    users_to_insert
                )
            return True, f"성공: {len(new_users)}명의 사용자로 목록을 교체했습니다."
        
        except Exception as e:
            return False, f"실패: {str(e)}"

    async def get_all_users(self) -> List[Dict]:
        users = await self.conn.fetch("SELECT username, allowed_hours, role FROM users")
        return [dict(row) for row in users]