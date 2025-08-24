import aiosqlite
import os

async def get_db_connection(db_path: str = "data/users.db"):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row
    return conn

async def setup_database(conn: aiosqlite.Connection):
    cursor = await conn.cursor()
    await cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY NOT NULL,
            password TEXT NOT NULL,
            allowed_hours INTEGER NOT NULL,
            role TEXT NOT NULL
        )
    """)
    await cursor.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            reservation_day TEXT NOT NULL,
            time_index INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(reservation_day, time_index)
        );
    """)
    await cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
    """)
    await cursor.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('reservation_enabled', 'true')
    )
    await cursor.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('reservation_opens_at', None)
    )
    await cursor.execute(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
        ('last_cleared_for', None) 
    )
    await conn.commit()
    await cursor.close()