# import aiosqlite
import asyncpg
import os
from dotenv import load_dotenv
import bcrypt

async def create_db_pool():
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL 환경 변수가 설정되지 않았습니다.")
    
    # 여러 개의 연결을 관리하는 '풀'을 생성합니다.
    pool = await asyncpg.create_pool(
        db_url,
        statement_cache_size=0
        )
    if not pool:
        raise RuntimeError("데이터베이스 풀을 생성하는 데 실패했습니다.")
        
    # 첫 연결 시 테이블이 없으면 생성하도록 초기화 로직을 추가합니다.
    async with pool.acquire() as conn:
        await setup_database(conn)

    return pool

async def setup_database(conn: asyncpg.Connection):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY NOT NULL,
            password TEXT NOT NULL,
            allowed_hours INTEGER NOT NULL,
            role TEXT NOT NULL
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            reservation_day TEXT NOT NULL,
            time_index INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(reservation_day, time_index)
        );
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
    """)

    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_password:
        return False, "실패: ADMIN_PASSWORD 환경 변수가 설정되지 않았습니다."

    hashed_admin_password = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    await conn.execute(
        "INSERT INTO users (username, password, allowed_hours, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
        "admin", hashed_admin_password, 0, "admin"
    )
    
    await conn.execute(
        "INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
        'reservation_enabled', 'true'
    )
    await conn.execute(
        "INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
        'reservation_opens_at', None
    )
    await conn.execute(
        "INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
        'last_cleared_for', None
    )