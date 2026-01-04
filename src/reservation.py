import aiosqlite
from typing import List, Dict, Tuple
from datetime import datetime, timezone, timedelta

class ReservationManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def get_system_settings(self) -> Dict:
        async with self.conn.execute("SELECT key, value FROM system_settings") as cursor:
            settings_rows = await cursor.fetchall()
        return {row['key']: row['value'] for row in settings_rows}

    async def check_reservation_availability(self) -> Tuple[bool, str]:
        settings = await self.get_system_settings()
        opens_at_str = settings.get('reservation_opens_at')
        last_cleared_for = settings.get('last_cleared_for')

        KST = timezone(timedelta(hours=9))
        now_kst = datetime.now(KST)

        if opens_at_str:
            try:
                opens_at_dt_kst = datetime.fromisoformat(opens_at_str).astimezone(KST)
                clear_trigger_time = opens_at_dt_kst - timedelta(minutes=20)
                
                if clear_trigger_time <= now_kst < opens_at_dt_kst and last_cleared_for != opens_at_str:
                    await self.clear_reservations()
                    
                    await self.conn.execute(
                        "UPDATE system_settings SET value = ? WHERE key = 'last_cleared_for'",
                        (opens_at_str,)
                    )
                    await self.conn.commit()
                    
                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약자 명단이 초기화되었습니다. 예약은 {opens_at_local}부터 가능합니다."

                if now_kst < opens_at_dt_kst:
                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약은 {opens_at_local}부터 가능합니다."
                else:
                    try:
                        await self.conn.execute("UPDATE system_settings SET value = 'true' WHERE key = 'reservation_enabled'")
                        await self.conn.execute("UPDATE system_settings SET value = NULL WHERE key = 'reservation_opens_at'")
                        await self.conn.commit()
                    except:
                        await self.conn.rollback()
                        raise

            except (ValueError, TypeError):
                return False, "예약 오픈 시간 설정에 오류가 있습니다. 관리자에게 문의하세요."
                
        final_settings = await self.get_system_settings()
        if final_settings.get('reservation_enabled') != 'true':
            return False, "현재 예약이 불가능합니다. 관리자에게 문의하세요."
            
        return True, "예약 가능"
        
    async def create_reservation(self, username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
        is_available, message = await self.check_reservation_availability()
        if not is_available:
            return False, message

        try:
            # [수정] 트랜잭션 시작 (명시적이지 않아도 첫 쓰기 작업 시 시작됨)
            cursor = await self.conn.execute(
                "SELECT allowed_hours, role FROM users WHERE username = ?", (username,)
            )
            user_data = await cursor.fetchone()
            
            if user_data is None:
                return False, "사용자 정보를 찾을 수 없습니다."
            user_allowed_hours = user_data['allowed_hours']
            user_role = user_data['role']

            cursor = await self.conn.execute(
                "SELECT COUNT(*) FROM reservations WHERE username = ?", (username,)
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
                await self.conn.execute(
                    "INSERT INTO reservations (username, reservation_day, time_index) VALUES (?, ?, ?)",
                    (username, time_slot['day'], time_slot['time_index'])
                )
            
            # [중요] 커밋
            await self.conn.commit()
            return True, "이용 신청에 성공했습니다."
        
        except aiosqlite.IntegrityError:
             await self.conn.rollback()
             return False, "신청 실패: 이미 예약되었거나 중복된 시간이 포함되어 있습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"처리 중 오류가 발생했습니다: {str(e)}"

    async def clear_reservations(self) -> Tuple[bool, str]:
        try:
            await self.conn.execute("DELETE FROM reservations WHERE username NOT IN ('신청불가')")
            await self.conn.commit()
            return True, "성공"
        except Exception as e:
            await self.conn.rollback()
            return False, f"실패: {str(e)}"

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

    async def force_create_reservation(self, target_username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
        try:
            for time_slot in reserve_times:
                await self.conn.execute(
                    "DELETE FROM reservations WHERE reservation_day = ? AND time_index = ?",
                    (time_slot['day'], time_slot['time_index'])
                )
                await self.conn.execute(
                    "INSERT INTO reservations (username, reservation_day, time_index) VALUES (?, ?, ?)",
                    (target_username, time_slot['day'], time_slot['time_index'])
                )
            await self.conn.commit()
            return True, f"'{target_username}'의 이름으로 {len(reserve_times)}개의 예약을 강제 등록했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"강제 등록 중 오류 발생: {str(e)}"

    async def get_all_reservations(self) -> List[dict]:
        async with self.conn.execute("SELECT username, reservation_day, time_index FROM reservations") as cursor:
            reservations = await cursor.fetchall()
        return [dict(row) for row in reservations]