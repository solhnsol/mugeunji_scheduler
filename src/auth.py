# auth.py
import asyncpg
import bcrypt
from typing import Optional, Dict, List, Tuple
from dotenv import load_dotenv
import os

class AuthManager:
    def __init__(self, conn: asyncpg.Connection):
        load_dotenv()
        self.conn = conn

    async def _validate_user(self, username: str, password: str) -> Optional[Dict]:
        """사용자 이름으로 데이터를 가져와 비밀번호를 검증하는 내부 헬퍼 함수"""
        user_data = await self.conn.fetchrow(
            "SELECT * FROM users WHERE username = $1", username
        )

        if user_data:
            # Bcrypt 해시 검증
            stored_hash = user_data['password'].encode('utf-8')
            password_bytes = password.encode('utf-8')
            if bcrypt.checkpw(password_bytes, stored_hash):
                return dict(user_data)
        return None

    async def login(self, username: str, password: str) -> Optional[Dict]:
        """일반 사용자 로그인"""
        user_data = await self._validate_user(username, password)
        # 특별한 역할 제한 없이 로그인 성공 시 사용자 데이터 반환
        return user_data

    async def admin_login(self, username: str, password: str) -> Optional[Dict]:
        """관리자 사용자 로그인"""
        user_data = await self._validate_user(username, password)
        # 로그인 성공 후, 역할이 'admin'인지 추가로 확인
        if user_data and user_data.get('role') == 'admin':
            return user_data
        return None

    async def update_users(self, new_users: List[Dict]) -> Tuple[bool, str]:
        try:
            async with self.conn.transaction():
                await self.conn.execute("DELETE FROM users")
                
                admin_password = os.getenv("ADMIN_PASSWORD")
                if not admin_password:
                    # 환경 변수가 설정되지 않았을 경우에 대한 예외 처리
                    return False, "실패: ADMIN_PASSWORD 환경 변수가 설정되지 않았습니다."

                hashed_admin_password = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

                await self.conn.execute(
                    "INSERT INTO users (username, password, allowed_hours, role) VALUES ($1, $2, $3, $4)",
                    "admin", hashed_admin_password, 0, "admin"
                )
                
                if not new_users: # new_users가 비어있을 경우 바로 성공 처리
                    return True, "성공: 관리자 계정만 생성되었습니다."
                
                
                users_to_insert = [
                    (
                        u['username'],
                        # 각 사용자의 비밀번호를 해시 처리
                        bcrypt.hashpw(u['password'].encode('utf-8'), bcrypt.gensalt()).decode('utf-8'),
                        u['allowed_hours'],
                        'admin' if u['role'] == 'admin' else 'free' if u['allowed_hours'] > 4 else 'user'  # allowed_hours가 4 초과면 'free', 아니면 'user'
                    ) for u in new_users
                ]

                await self.conn.executemany(
                    "INSERT INTO users (username, password, allowed_hours, role) VALUES ($1, $2, $3, $4)",
                    users_to_insert
                )
            return True, f"성공: 관리자를 포함하여 총 {len(new_users) + 1}명의 사용자로 목록을 교체했습니다."
        
        except Exception as e:
            return False, f"실패: {str(e)}"

    async def get_all_users(self) -> List[Dict]:
        users = await self.conn.fetch("SELECT username, allowed_hours, role FROM users")
        return [dict(row) for row in users]