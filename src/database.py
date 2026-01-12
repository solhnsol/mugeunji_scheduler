import aiosqlite
import os
from dotenv import load_dotenv
import bcrypt

async def init_db(db_path: str = "data/reservation.db"):
    load_dotenv()
    
    # SQLite 연결 생성 및 Row 팩토리 설정
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row
    
    await setup_database(conn)
    return conn

async def setup_database(conn: aiosqlite.Connection):
    # Users 테이블
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY NOT NULL,
            password TEXT NOT NULL,
            allowed_hours INTEGER NOT NULL,
            role TEXT NOT NULL
        )
    """)
    
    # Reservations 테이블
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            reservation_day TEXT NOT NULL,
            time_index INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(reservation_day, time_index)
        );
    """)
    
    # System Settings 테이블
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
    """)

    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_password:
        hashed_admin_password = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        await conn.execute(
            "INSERT OR IGNORE INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
            ("admin", hashed_admin_password, 0, "admin")
        )

    # 기본 설정값 초기화 (INSERT OR IGNORE 사용)
    await conn.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('reservation_enabled', 'true')
    )
    await conn.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('reservation_opens_at', None)
    )
    await conn.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('last_cleared_for', None)
    )
    
    await conn.commit()