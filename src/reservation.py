import aiosqlite
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timezone, timedelta

from src.membership import MembershipManager
from src.automation_config import (
    RESERVATION_MONTHLY,
    RESERVATION_FREE,
    ScheduleConfig,
    now_kst,
    get_last_free_reset_time,
    get_next_free_reset_time,
    get_free_week_start,
    get_free_week_end,
    get_free_booking_window,
    slots_in_booking_window,
    slot_key,
)

KST = timezone(timedelta(hours=9))


class ReservationManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn
        self.membership = MembershipManager(conn)

    async def get_system_settings(self) -> Dict:
        async with self.conn.execute("SELECT key, value FROM system_settings") as cursor:
            settings_rows = await cursor.fetchall()
        return {row['key']: row['value'] for row in settings_rows}

    async def get_schedule_config(self) -> ScheduleConfig:
        settings = await self.get_system_settings()
        return ScheduleConfig.from_settings(settings)

    async def maybe_reset_free_reservations(self) -> bool:
        config = await self.get_schedule_config()
        if not config.auto_free_reset_enabled:
            return False
        now = now_kst()
        reset_due = get_last_free_reset_time(now, config)
        settings = await self.get_system_settings()
        last_reset = settings.get('last_free_reset_at')
        if last_reset:
            try:
                last_dt = datetime.fromisoformat(last_reset).astimezone(KST)
                if last_dt >= reset_due:
                    return False
            except (ValueError, TypeError):
                pass
        if now < reset_due:
            return False
        await self.conn.execute(
            "DELETE FROM reservations WHERE reservation_type = ?",
            (RESERVATION_FREE,),
        )
        await self.conn.execute(
            "UPDATE system_settings SET value = ? WHERE key = 'last_free_reset_at'",
            (reset_due.isoformat(),),
        )
        await self.conn.commit()
        return True

    async def check_reservation_availability(self) -> Tuple[bool, str]:
        await self.maybe_reset_free_reservations()
        config = await self.get_schedule_config()
        settings = await self.get_system_settings()
        opens_at_str = settings.get('reservation_opens_at')
        last_cleared_for = settings.get('last_cleared_for')

        now_kst_dt = now_kst()

        if opens_at_str:
            try:
                opens_at_dt_kst = datetime.fromisoformat(opens_at_str).astimezone(KST)
                clear_trigger_time = opens_at_dt_kst - timedelta(
                    minutes=config.monthly_clear_minutes_before
                )

                if (
                    config.auto_monthly_clear_enabled
                    and clear_trigger_time <= now_kst_dt < opens_at_dt_kst
                    and last_cleared_for != opens_at_str
                ):
                    await self.clear_monthly_reservations()

                    await self.conn.execute(
                        "UPDATE system_settings SET value = ? WHERE key = 'last_cleared_for'",
                        (opens_at_str,)
                    )
                    await self.conn.commit()

                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약자 명단이 초기화되었습니다. 예약은 {opens_at_local}부터 가능합니다."

                if now_kst_dt < opens_at_dt_kst:
                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약은 {opens_at_local}부터 가능합니다."
                else:
                    try:
                        await self.conn.execute("UPDATE system_settings SET value = 'true' WHERE key = 'reservation_enabled'")
                        await self.conn.execute("UPDATE system_settings SET value = NULL WHERE key = 'reservation_opens_at'")
                        await self.conn.commit()
                    except Exception:
                        await self.conn.rollback()
                        raise

            except (ValueError, TypeError):
                return False, "예약 오픈 시간 설정에 오류가 있습니다. 관리자에게 문의하세요."

        final_settings = await self.get_system_settings()
        if final_settings.get('reservation_enabled') != 'true':
            return False, "현재 예약이 불가능합니다. 관리자에게 문의하세요."

        return True, "예약 가능"

    async def check_free_reservation_availability(self) -> Tuple[bool, str]:
        await self.maybe_reset_free_reservations()
        config = await self.get_schedule_config()
        now = now_kst()
        window_start, _ = get_free_booking_window(now, config)
        if now < window_start:
            opens_local = window_start.strftime('%m월 %d일 %H:%M')
            return False, f"자유이용 예약은 {opens_local}부터 가능합니다."
        return True, "자유이용 예약 가능"

    async def _user_can_access_free(self, username: str) -> Tuple[bool, str]:
        cursor = await self.conn.execute(
            "SELECT role FROM users WHERE username = ?", (username,)
        )
        user_data = await cursor.fetchone()
        if user_data is None:
            return False, "사용자 정보를 찾을 수 없습니다."
        if user_data['role'] not in ('free', 'admin'):
            return False, "자유이용 권한이 없습니다."
        access = await self.membership.get_access_status(username)
        if user_data['role'] != 'admin' and not access["can_access_schedule"]:
            return False, access["message"]
        return True, ""

    async def create_reservation(self, username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
        access = await self.membership.get_access_status(username)
        if not access["can_access_schedule"]:
            return False, access["message"]

        is_available, message = await self.check_reservation_availability()
        if not is_available:
            return False, message

        try:
            cursor = await self.conn.execute(
                "SELECT allowed_hours, role FROM users WHERE username = ?", (username,)
            )
            user_data = await cursor.fetchone()

            if user_data is None:
                return False, "사용자 정보를 찾을 수 없습니다."
            user_allowed_hours = user_data['allowed_hours']
            user_role = user_data['role']

            cursor = await self.conn.execute(
                "SELECT COUNT(*) FROM reservations WHERE username = ? AND reservation_type = ?",
                (username, RESERVATION_MONTHLY),
            )
            row = await cursor.fetchone()
            existing_reservations_count = row[0] if row else 0

            time_indices = {slot['time_index'] for slot in reserve_times}
            group_to_check = {0, 1, 2, 3}

            if not group_to_check.isdisjoint(time_indices):
                if user_role != 'admin' and user_role != 'free':
                    return False, "새벽 예약은 자유이용권 사용자만 신청할 수 있습니다."
                if not group_to_check.issubset(time_indices):
                    return False, "새벽 예약은 한꺼번에만 신청할 수 있습니다."

            if existing_reservations_count + len(reserve_times) > user_allowed_hours:
                return False, f"예약 가능 시간({user_allowed_hours}시간)을 초과합니다."

            for time_slot in reserve_times:
                taken = await self._slot_taken(time_slot['day'], time_slot['time_index'])
                if taken:
                    return False, "이미 예약된 시간이 포함되어 있습니다."

            for time_slot in reserve_times:
                await self.conn.execute(
                    """INSERT INTO reservations (username, reservation_day, time_index, reservation_type)
                       VALUES (?, ?, ?, ?)""",
                    (username, time_slot['day'], time_slot['time_index'], RESERVATION_MONTHLY),
                )

            await self.conn.commit()
            return True, "이용 신청에 성공했습니다."

        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            return False, "신청 실패: 이미 예약되었거나 중복된 시간이 포함되어 있습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"처리 중 오류가 발생했습니다: {str(e)}"

    async def create_free_reservation(self, username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
        can_access, msg = await self._user_can_access_free(username)
        if not can_access:
            return False, msg

        is_available, message = await self.check_free_reservation_availability()
        if not is_available:
            return False, message

        window_slots = {
            slot_key(s['day'], int(s['time_index']))
            for s in slots_in_booking_window(now_kst(), await self.get_schedule_config())
        }
        for time_slot in reserve_times:
            key = slot_key(time_slot['day'], time_slot['time_index'])
            if key not in window_slots:
                return False, "현재 예약 창에 포함되지 않는 시간입니다. (매일 21:00~익일 20:00)"

        try:
            for time_slot in reserve_times:
                taken = await self._slot_taken(time_slot['day'], time_slot['time_index'])
                if taken:
                    return False, "이미 예약된 시간이 포함되어 있습니다."

            for time_slot in reserve_times:
                await self.conn.execute(
                    """INSERT INTO reservations (username, reservation_day, time_index, reservation_type)
                       VALUES (?, ?, ?, ?)""",
                    (username, time_slot['day'], time_slot['time_index'], RESERVATION_FREE),
                )

            await self.conn.commit()
            return True, "자유이용 신청에 성공했습니다."

        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            return False, "신청 실패: 이미 예약된 시간입니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"처리 중 오류가 발생했습니다: {str(e)}"

    async def _slot_taken(self, day: str, time_index: int) -> bool:
        cursor = await self.conn.execute(
            "SELECT 1 FROM reservations WHERE reservation_day = ? AND time_index = ?",
            (day, time_index),
        )
        return await cursor.fetchone() is not None

    async def clear_monthly_reservations(self) -> Tuple[bool, str]:
        try:
            await self.conn.execute(
                "DELETE FROM reservations WHERE reservation_type = ? AND username NOT IN ('신청불가')",
                (RESERVATION_MONTHLY,),
            )
            await self.conn.commit()
            return True, "성공"
        except Exception as e:
            await self.conn.rollback()
            return False, f"실패: {str(e)}"

    async def clear_reservations(self) -> Tuple[bool, str]:
        return await self.clear_monthly_reservations()

    async def delete_reservations(self, reserve_times: List[Dict]) -> Tuple[bool, str]:
        try:
            for time_slot in reserve_times:
                await self.conn.execute(
                    "DELETE FROM reservations WHERE reservation_day = ? AND time_index = ?",
                    (time_slot['day'], time_slot['time_index'])
                )
            await self.conn.commit()
            return True, f"{len(reserve_times)}개의 예약을 삭제했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"삭제 중 오류 발생: {str(e)}"

    async def force_create_reservation(
        self,
        target_username: str,
        reserve_times: List[Dict],
        reservation_type: str = RESERVATION_MONTHLY,
    ) -> Tuple[bool, str]:
        try:
            for time_slot in reserve_times:
                await self.conn.execute(
                    "DELETE FROM reservations WHERE reservation_day = ? AND time_index = ?",
                    (time_slot['day'], time_slot['time_index'])
                )
                await self.conn.execute(
                    """INSERT INTO reservations (username, reservation_day, time_index, reservation_type)
                       VALUES (?, ?, ?, ?)""",
                    (target_username, time_slot['day'], time_slot['time_index'], reservation_type),
                )
            await self.conn.commit()
            return True, f"'{target_username}'의 이름으로 {len(reserve_times)}개의 예약을 강제 등록했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"강제 등록 중 오류 발생: {str(e)}"

    async def get_reservations(
        self,
        reservation_type: Optional[str] = None,
    ) -> List[dict]:
        await self.maybe_reset_free_reservations()
        query = """
            SELECT r.username, r.reservation_day, r.time_index, r.reservation_type,
                   COALESCE(NULLIF(TRIM(u.name), ''), r.username) AS display_name
            FROM reservations r
            LEFT JOIN users u ON u.username = r.username
        """
        params: Tuple = ()
        if reservation_type:
            query += " WHERE r.reservation_type = ?"
            params = (reservation_type,)
        async with self.conn.execute(query, params) as cursor:
            reservations = await cursor.fetchall()
        return [dict(row) for row in reservations]

    async def get_all_reservations(self) -> List[dict]:
        return await self.get_reservations()

    async def get_weekly_usage(self, reservation_type: Optional[str] = RESERVATION_FREE) -> Dict:
        await self.maybe_reset_free_reservations()
        config = await self.get_schedule_config()
        now = now_kst()
        week_start = get_free_week_start(now, config)
        week_end = get_free_week_end(now, config)

        query = """
            SELECT r.username,
                   COALESCE(NULLIF(TRIM(u.name), ''), r.username) AS display_name,
                   COUNT(*) AS hours
            FROM reservations r
            LEFT JOIN users u ON u.username = r.username
            WHERE r.username NOT IN ('신청불가')
        """
        params: Tuple = ()
        if reservation_type:
            query += " AND r.reservation_type = ?"
            params = (reservation_type,)
        query += " GROUP BY r.username ORDER BY hours DESC, display_name ASC"

        async with self.conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        items = [dict(row) for row in rows]
        max_hours = max((item["hours"] for item in items), default=0)

        return {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "items": items,
            "max_hours": max_hours,
        }

    async def get_free_schedule_meta(self) -> Dict:
        await self.maybe_reset_free_reservations()
        config = await self.get_schedule_config()
        now = now_kst()
        window_start, window_end = get_free_booking_window(now, config)
        is_open, message = await self.check_free_reservation_availability()
        bookable_keys = {
            slot_key(s['day'], int(s['time_index']))
            for s in slots_in_booking_window(now, config)
        }
        return {
            "booking_open": is_open,
            "message": message,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "bookable_slots": list(bookable_keys),
        }

    async def get_automation_status(self) -> Dict:
        await self.maybe_reset_free_reservations()
        await self.check_reservation_availability()
        config = await self.get_schedule_config()
        settings = await self.get_system_settings()
        now = now_kst()
        window_start, window_end = get_free_booking_window(now, config)
        return {
            "reservation_enabled": settings.get("reservation_enabled") == "true",
            "reservation_opens_at": settings.get("reservation_opens_at"),
            "monthly_clear_minutes_before": config.monthly_clear_minutes_before,
            "auto_monthly_clear_enabled": config.auto_monthly_clear_enabled,
            "auto_free_reset_enabled": config.auto_free_reset_enabled,
            "free_reset_weekday": config.free_reset_weekday,
            "free_reset_hour": config.free_reset_hour,
            "free_reset_minute": config.free_reset_minute,
            "free_booking_start_hour": config.free_booking_start_hour,
            "free_booking_start_minute": config.free_booking_start_minute,
            "free_booking_window_hours": config.free_booking_window_hours,
            "last_cleared_for": settings.get("last_cleared_for"),
            "last_free_reset_at": settings.get("last_free_reset_at"),
            "next_free_reset_at": get_next_free_reset_time(now, config).isoformat(),
            "free_week_start": get_free_week_start(now, config).isoformat(),
            "free_week_end": get_free_week_end(now, config).isoformat(),
            "free_booking_window_start": window_start.isoformat(),
            "free_booking_window_end": window_end.isoformat(),
        }
