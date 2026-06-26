import aiosqlite
import os
from dotenv import load_dotenv
import bcrypt

from src.membership import DEFAULT_PLANS
from src.automation_config import AUTOMATION_SETTING_DEFAULTS
from src.legacy_migration import run_legacy_migration

async def init_db(db_path: str = "data/reservation.db"):
    load_dotenv()
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row
    await setup_database(conn)
    return conn

async def _column_exists(conn: aiosqlite.Connection, table: str, column: str) -> bool:
    async with conn.execute(f"PRAGMA table_info({table})") as cursor:
        rows = await cursor.fetchall()
    return any(row["name"] == column for row in rows)

async def _migrate_users_table(conn: aiosqlite.Connection):
    columns = [
        ("email", "TEXT"),
        ("name", "TEXT"),
        ("phone", "TEXT"),
        ("custom_allowed_hours", "INTEGER"),
        ("custom_monthly_fee", "INTEGER"),
        ("created_at", "TEXT"),
    ]
    for name, col_type in columns:
        if not await _column_exists(conn, table="users", column=name):
            await conn.execute(f"ALTER TABLE users ADD COLUMN {name} {col_type}")

async def _migrate_reservations_table(conn: aiosqlite.Connection):
    if not await _column_exists(conn, table="reservations", column="reservation_type"):
        await conn.execute(
            "ALTER TABLE reservations ADD COLUMN reservation_type TEXT NOT NULL DEFAULT 'monthly'"
        )

async def _migrate_subscriptions_table(conn: aiosqlite.Connection):
    if not await _column_exists(conn, table="subscriptions", column="cancellation_effective_period"):
        await conn.execute(
            "ALTER TABLE subscriptions ADD COLUMN cancellation_effective_period TEXT"
        )

async def setup_database(conn: aiosqlite.Connection):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY NOT NULL,
            password TEXT NOT NULL,
            allowed_hours INTEGER NOT NULL,
            role TEXT NOT NULL
        )
    """)
    await _migrate_users_table(conn)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            reservation_day TEXT NOT NULL,
            time_index INTEGER NOT NULL,
            reservation_type TEXT NOT NULL DEFAULT 'monthly',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(reservation_day, time_index)
        );
    """)
    await _migrate_reservations_table(conn)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            allowed_hours INTEGER NOT NULL,
            monthly_price INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            plan_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_payment',
            auto_renew INTEGER NOT NULL DEFAULT 1,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (username) REFERENCES users(username),
            FOREIGN KEY (plan_id) REFERENCES plans(id)
        );
    """)
    await _migrate_subscriptions_table(conn)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS billing_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            period TEXT NOT NULL,
            plan_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            billing_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            paid_at TEXT,
            confirmed_by TEXT,
            created_at TEXT,
            UNIQUE(username, period),
            FOREIGN KEY (username) REFERENCES users(username),
            FOREIGN KEY (plan_id) REFERENCES plans(id)
        );
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS plan_change_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            new_plan_id INTEGER NOT NULL,
            effective_period TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT,
            FOREIGN KEY (username) REFERENCES users(username),
            FOREIGN KEY (new_plan_id) REFERENCES plans(id)
        );
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS settlement_periods (
            period TEXT PRIMARY KEY NOT NULL,
            status TEXT NOT NULL,
            opened_at TEXT,
            opened_by TEXT,
            closed_at TEXT
        );
    """)

    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_password:
        hashed_admin_password = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        await conn.execute(
            "INSERT OR IGNORE INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
            ("admin", hashed_admin_password, 0, "admin")
        )

    settings_defaults = [
        ('reservation_enabled', 'true'),
        ('reservation_opens_at', None),
        ('last_cleared_for', None),
        ('current_access_period', None),
        ('last_free_reset_at', None),
        *[(k, v) for k, v in AUTOMATION_SETTING_DEFAULTS.items()],
    ]
    for key, value in settings_defaults:
        await conn.execute(
            "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
            (key, value)
        )

    async with conn.execute("SELECT COUNT(*) FROM plans") as cursor:
        plan_count = (await cursor.fetchone())[0]
    if plan_count == 0:
        for plan in DEFAULT_PLANS:
            await conn.execute(
                "INSERT INTO plans (name, allowed_hours, monthly_price, sort_order) VALUES (?, ?, ?, ?)",
                (plan["name"], plan["allowed_hours"], plan["monthly_price"], plan["sort_order"]),
            )

    await run_legacy_migration(conn)
    await conn.commit()
