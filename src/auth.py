import aiosqlite
import bcrypt
from typing import Optional, Dict, List, Tuple
from dotenv import load_dotenv
import os
import asyncio
from functools import partial

class AuthManager:
    def __init__(self, conn: aiosqlite.Connection):
        load_dotenv()
        self.conn = conn

    async def _run_sync(self, func, *args, **kwargs):
        """동기 함수(bcrypt 등)를 별도 스레드에서 실행하여 이벤트 루프 차단 방지"""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, partial(func, *args, **kwargs))

    async def _validate_user(self, username: str, password: str) -> Optional[Dict]:
        async with self.conn.execute("SELECT * FROM users WHERE username = ?", (username,)) as cursor:
            user_data = await cursor.fetchone()

        if user_data:
            stored_hash = user_data['password'].encode('utf-8')
            password_bytes = password.encode('utf-8')
            
            # bcrypt 검증을 비동기 스타일로 실행
            is_valid = await self._run_sync(bcrypt.checkpw, password_bytes, stored_hash)
            if is_valid:
                return dict(user_data)
        return None

    async def login(self, username: str, password: str) -> Optional[Dict]:
        user_data = await self._validate_user(username, password)
        return user_data

    async def admin_login(self, username: str, password: str) -> Optional[Dict]:
        user_data = await self._validate_user(username, password)
        if user_data and user_data.get('role') == 'admin':
            return user_data
        return None

    async def update_users(self, new_users: List[Dict]) -> Tuple[bool, str]:
        try:
            # [수정] async with self.conn 제거 -> 명시적 트랜잭션 사용
            await self.conn.execute("DELETE FROM users")
            
            admin_password = os.getenv("ADMIN_PASSWORD")
            if not admin_password:
                return False, "실패: ADMIN_PASSWORD 환경 변수가 설정되지 않았습니다."

            # 관리자 비번 해싱 (별도 스레드)
            hashed_admin_password_bytes = await self._run_sync(
                bcrypt.hashpw, admin_password.encode('utf-8'), bcrypt.gensalt()
            )
            hashed_admin_password = hashed_admin_password_bytes.decode('utf-8')

            await self.conn.execute(
                "INSERT INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
                ("admin", hashed_admin_password, 0, "admin")
            )
            
            if not new_users:
                await self.conn.commit()
                return True, "성공: 관리자 계정만 생성되었습니다."
            
            users_to_insert = []
            for u in new_users:
                # 사용자 비번 해싱 (별도 스레드) - 반복문 내에서 await 사용
                pw_hash_bytes = await self._run_sync(
                    bcrypt.hashpw, u['password'].encode('utf-8'), bcrypt.gensalt()
                )
                pw_hash = pw_hash_bytes.decode('utf-8')
                
                role = 'admin' if u['role'] == 'admin' else 'free' if u['allowed_hours'] > 4 else 'user'
                users_to_insert.append((u['username'], pw_hash, u['allowed_hours'], role))

            await self.conn.executemany(
                "INSERT INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
                users_to_insert
            )
            
            # [중요] 모든 작업이 끝나면 커밋
            await self.conn.commit()
            return True, f"성공: 관리자를 포함하여 총 {len(new_users) + 1}명의 사용자로 목록을 교체했습니다."
        
        except Exception as e:
            # 오류 발생 시 롤백
            await self.conn.rollback()
            return False, f"실패: {str(e)}"

    async def get_all_users(self) -> List[Dict]:
        async with self.conn.execute("SELECT username, allowed_hours, role FROM users") as cursor:
            users = await cursor.fetchall()
        return [dict(row) for row in users]