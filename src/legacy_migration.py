"""기존 Render/CSV 사용자·예약 데이터를 새 스키마로 이전."""
from datetime import datetime, timezone, timedelta

import aiosqlite

from src.membership import period_from_offset

KST = timezone(timedelta(hours=9))


async def _setting(conn: aiosqlite.Connection, key: str) -> str | None:
    async with conn.execute(
        "SELECT value FROM system_settings WHERE key = ?", (key,)
    ) as cursor:
        row = await cursor.fetchone()
    return row["value"] if row else None


async def _plan_id_for_hours(conn: aiosqlite.Connection, hours: int) -> int | None:
    async with conn.execute(
        "SELECT id FROM plans WHERE allowed_hours = ? ORDER BY sort_order LIMIT 1",
        (hours,),
    ) as cursor:
        row = await cursor.fetchone()
    if row:
        return row["id"]
    async with conn.execute(
        "SELECT id FROM plans ORDER BY ABS(allowed_hours - ?), sort_order LIMIT 1",
        (hours,),
    ) as cursor:
        row = await cursor.fetchone()
    return row["id"] if row else None


async def run_legacy_migration(conn: aiosqlite.Connection) -> None:
    if await _setting(conn, "legacy_migration_v1") == "done":
        return

    now = datetime.now(KST).isoformat()

    await conn.execute(
        """
        UPDATE users
        SET name = username
        WHERE role != 'admin'
          AND (name IS NULL OR TRIM(name) = '')
        """
    )

    access_period = await _setting(conn, "current_access_period")
    if not access_period:
        access_period = period_from_offset(0)
        await conn.execute(
            """
            INSERT INTO system_settings (key, value) VALUES ('current_access_period', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (access_period,),
        )

    async with conn.execute(
        """
        SELECT u.username, u.allowed_hours, u.role
        FROM users u
        LEFT JOIN subscriptions s ON s.username = u.username
        WHERE u.role != 'admin' AND s.id IS NULL AND u.allowed_hours > 0
        """
    ) as cursor:
        legacy_users = await cursor.fetchall()

    for user in legacy_users:
        username = user["username"]
        hours = int(user["allowed_hours"])
        plan_id = await _plan_id_for_hours(conn, hours)
        if not plan_id:
            continue

        await conn.execute(
            """
            INSERT INTO subscriptions (username, plan_id, status, auto_renew, created_at, updated_at)
            VALUES (?, ?, 'active', 1, ?, ?)
            """,
            (username, plan_id, now, now),
        )

        async with conn.execute(
            """
            SELECT amount FROM (
                SELECT p.monthly_price AS amount
                FROM plans p WHERE p.id = ?
            )
            """,
            (plan_id,),
        ) as cursor:
            price_row = await cursor.fetchone()
        amount = price_row["amount"] if price_row else 0

        await conn.execute(
            """
            INSERT OR IGNORE INTO billing_cycles
                (username, period, plan_id, amount, billing_type, status, paid_at, created_at)
            VALUES (?, ?, ?, ?, 'renewal', 'paid', ?, ?)
            """,
            (username, access_period, plan_id, amount, now, now),
        )

    await conn.execute(
        """
        INSERT INTO system_settings (key, value) VALUES ('legacy_migration_v1', 'done')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """
    )
    await conn.commit()
