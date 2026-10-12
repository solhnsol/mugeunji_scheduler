from datetime import datetime, timedelta, timezone
import aiosqlite
import os
from dotenv import load_dotenv
import bcrypt

from src.membership import DEFAULT_PLANS, period_from_offset
from src.automation_config import AUTOMATION_SETTING_DEFAULTS
from src.legacy_migration import run_legacy_migration

async def init_db(db_path: str = None):
    load_dotenv()
    db_path = db_path or os.getenv("DB_PATH", "data/reservation.db")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
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
        # 관리자가 임시 비밀번호를 발급하면 1 — 로그인 후 새 비밀번호를 설정할 때까지 다른 기능을 막는다
        ("must_change_password", "INTEGER NOT NULL DEFAULT 0"),
        # 비밀번호가 바뀌면 올려서 이전에 발급된 로그인 토큰을 무효화한다
        ("session_epoch", "INTEGER NOT NULL DEFAULT 0"),
        # 새벽(0~4시) 예약 허용 여부 (토큰 예약 시스템)
        ("dawn_allowed", "INTEGER NOT NULL DEFAULT 1"),
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
    if not await _column_exists(conn, table="subscriptions", column="start_period"):
        await conn.execute(
            "ALTER TABLE subscriptions ADD COLUMN start_period TEXT"
        )
    await conn.execute(
        """
        UPDATE subscriptions
        SET start_period = (
            SELECT MIN(period) FROM billing_cycles bc
            WHERE bc.username = subscriptions.username
        )
        WHERE start_period IS NULL
        AND EXISTS (
            SELECT 1 FROM billing_cycles bc WHERE bc.username = subscriptions.username
        )
        """
    )
    await conn.execute(
        "UPDATE subscriptions SET start_period = ? WHERE start_period IS NULL",
        (period_from_offset(1),),
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

    await _migrate_subscriptions_table(conn)

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
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            jti TEXT PRIMARY KEY NOT NULL,
            expires_at TEXT NOT NULL
        );
    """)

    # --- 토큰 시스템 (토큰은 최소 단위 1의 정수) ---
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS token_packs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_won INTEGER NOT NULL,
            tokens INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT
        );
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS token_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            pack_id INTEGER,
            pack_name TEXT NOT NULL,
            price_won INTEGER NOT NULL,
            tokens INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT,
            confirmed_at TEXT,
            confirmed_by TEXT,
            memo TEXT,
            FOREIGN KEY (username) REFERENCES users(username)
        );
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS token_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            delta INTEGER NOT NULL,
            kind TEXT NOT NULL,
            ref_type TEXT,
            ref_id INTEGER,
            memo TEXT,
            created_at TEXT,
            created_by TEXT,
            FOREIGN KEY (username) REFERENCES users(username)
        );
    """)
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_ledger_user ON token_ledger(username, id)"
    )
    # 토큰 소멸·무료 프로모션 팩용 컬럼 (기존 DB 마이그레이션)
    for table, name, col_type in [
        ("token_ledger", "expires_at", "TEXT"),            # 지급분이 사라지는 시각 (NULL이면 소멸 없음)
        ("token_packs", "auto_confirm", "INTEGER NOT NULL DEFAULT 0"),  # 요청 즉시 지급
        ("token_packs", "expires_on", "TEXT"),             # 이 날짜(KST) 끝에 소멸 (NULL이면 기본 소멸 기간)
        ("token_packs", "audience", "TEXT NOT NULL DEFAULT 'all'"),     # all | free(자유이용 회원만)
        ("token_purchases", "expires_on", "TEXT"),
    ]:
        if not await _column_exists(conn, table=table, column=name):
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
    # 공지·이용 안내 (관리자 또는 에이전트 API로 작성)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS notices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'notice',
            visibility TEXT NOT NULL DEFAULT 'members',
            pinned INTEGER NOT NULL DEFAULT 0,
            published INTEGER NOT NULL DEFAULT 0,
            created_at TEXT,
            updated_at TEXT,
            published_at TEXT,
            created_by TEXT
        );
    """)
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_notices_list ON notices(published, pinned, published_at)"
    )
    # 날짜 기반 예약 (토큰 시스템). 기존 reservations 테이블과는 완전히 분리돼 있다.
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            booking_date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            cost INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            refunded INTEGER NOT NULL DEFAULT 0,
            created_at TEXT,
            cancelled_at TEXT,
            created_by TEXT,
            FOREIGN KEY (username) REFERENCES users(username)
        );
    """)
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_slot ON bookings(booking_date, hour) WHERE status = 'active'"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(username, booking_date)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_purchases_status ON token_purchases(status, id)"
    )

    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_password:
        hashed_admin_password = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        await conn.execute(
            "INSERT OR IGNORE INTO users (username, password, allowed_hours, role) VALUES (?, ?, ?, ?)",
            ("admin", hashed_admin_password, 4, "admin")
        )

    settings_defaults = [
        ('reservation_enabled', 'true'),
        ('reservation_opens_at', None),
        ('last_cleared_for', None),
        ('current_access_period', None),
        ('last_free_reset_at', None),
        ('payment_guide', None),
        # 토큰 충전 메뉴를 회원에게 공개할지 (전환 전에는 꺼 둔다)
        ('token_charge_enabled', 'false'),
        # 예약 방식 전환 스위치: legacy(기존 월/자유이용) | token(날짜 기반 토큰 예약)
        ('reservation_mode', 'legacy'),
        # 충전한 토큰이 사용되지 않으면 사라지는 기간(개월)
        ('token_expiry_months', '3'),
        # 베타 모드에서 기존 월 예약을 매주 반복 적용할 달 (YYYY-MM)
        ('beta_month', ''),
        # 에이전트가 공지를 올릴 때 쓰는 API 키의 해시 (평문은 저장하지 않는다)
        ('notice_api_key_hash', ''),
        *[(k, v) for k, v in AUTOMATION_SETTING_DEFAULTS.items()],
    ]
    for key, value in settings_defaults:
        await conn.execute(
            "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
            (key, value)
        )

    # 11월 베타 안내 초안 (배포 후 관리자가 읽어보고 공개) — 한 번만 만든다
    from src.seed_notices import NOV_2026_BODY, NOV_2026_TITLE, SEED_KEY
    async with conn.execute("SELECT 1 FROM system_settings WHERE key = ?", (SEED_KEY,)) as cursor:
        seeded = await cursor.fetchone()
    if not seeded:
        now = datetime.now(timezone(timedelta(hours=9))).isoformat()
        await conn.execute(
            """INSERT INTO notices (title, body, category, visibility, pinned, published, created_at, updated_at, created_by)
               VALUES (?, ?, 'notice', 'members', 1, 0, ?, ?, 'system')""",
            (NOV_2026_TITLE, NOV_2026_BODY, now, now),
        )
        await conn.execute("INSERT INTO system_settings (key, value) VALUES (?, 'done')", (SEED_KEY,))

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
