import aiosqlite
from typing import List, Dict, Tuple
from datetime import datetime, timezone, timedelta

class ReservationManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def get_system_settings(self) -> Dict:
            cursor = await self.conn.cursor()
            await cursor.execute("SELECT key, value FROM system_settings")
            settings = await cursor.fetchall()
            await cursor.close()
            return {row['key']: row['value'] for row in settings}

    async def check_reservation_availability(self) -> Tuple[bool, str]:
        settings = await self.get_system_settings()
        opens_at_str = settings.get('reservation_opens_at')
        last_cleared_for = settings.get('last_cleared_for')


        # 대한민국 표준시(KST)를 정의합니다. (UTC+9)
        KST = timezone(timedelta(hours=9))
        now_kst = datetime.now(KST)

        if opens_at_str:
            try:
                opens_at_dt_kst = datetime.fromisoformat(opens_at_str).astimezone(KST)
                clear_trigger_time = opens_at_dt_kst - timedelta(minutes=20)
                if clear_trigger_time <= now_kst < opens_at_dt_kst and last_cleared_for != opens_at_str:
                    
                    # 모든 예약 초기화
                    await self.clear_reservations()
                    
                    # 초기화가 실행되었음을 기록 (중복 실행 방지)
                    cursor = await self.conn.cursor()
                    await cursor.execute(
                        "UPDATE system_settings SET value = ? WHERE key = 'last_cleared_for'",
                        (opens_at_str,)
                    )
                    await self.conn.commit()
                    await cursor.close()
                    
                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약자 명단이 초기화되었습니다. 예약은 {opens_at_local}부터 가능합니다."

                if now_kst < opens_at_dt_kst:
                    opens_at_local = opens_at_dt_kst.strftime('%Y년 %m월 %d일 %H시 %M분')
                    return False, f"예약은 {opens_at_local}부터 가능합니다."
                else:
                    cursor = await self.conn.cursor()
                    await cursor.execute("UPDATE system_settings SET value = 'true' WHERE key = 'reservation_enabled'")
                    await cursor.execute("UPDATE system_settings SET value = NULL WHERE key = 'reservation_opens_at'")
                    await self.conn.commit()
                    await cursor.close()

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

        cursor = await self.conn.cursor()
        try:
            await cursor.execute("SELECT allowed_hours FROM users WHERE username = ?", (username,))
            user_data = await cursor.fetchone()

            if not user_data:
                return False, "사용자 정보를 찾을 수 없습니다."

            await cursor.execute("SELECT COUNT(*) FROM reservations WHERE username = ?", (username,))
            existing_reservations_count = (await cursor.fetchone())[0]

            allowed_hours = int(user_data['allowed_hours'])

            if existing_reservations_count + len(reserve_times) > allowed_hours:
                return False, f"예약 가능 시간({allowed_hours}시간)을 초과합니다."

            await cursor.execute("BEGIN TRANSACTION")
            for time_slot in reserve_times:
                await cursor.execute(
                    "INSERT INTO reservations (username, reservation_day, time_index) VALUES (?, ?, ?)",
                    (username, time_slot['day'], time_slot['time_index'])
                )
            await self.conn.commit()
            return True, "이용 신청에 성공했습니다."

        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            return False, "신청 실패: 이미 예약되었거나 중복된 시간이 포함되어 있습니다."
        except Exception as e:
            if self.conn.in_transaction:
                await self.conn.rollback()
            return False, f"처리 중 오류가 발생했습니다: {str(e)}"
        finally:
            await cursor.close()

    async def clear_reservations(self) -> Tuple[bool, str]:
        cursor = await self.conn.cursor()
        try:
            await cursor.execute("DELETE FROM reservations WHERE time_index >= 7")
            await self.conn.commit()
            return True, "성공"
        except Exception as e:
            await self.conn.rollback()
            return False, f"실패: {str(e)}"
        finally:
            await cursor.close()

    async def delete_reservations(self, reserve_times: List[Dict]) -> Tuple[bool, str]:
        cursor = await self.conn.cursor()
        try:
            await cursor.execute("BEGIN TRANSACTION")
            for time_slot in reserve_times:
                await cursor.execute(
                    "DELETE FROM reservations WHERE reservation_day = ? AND time_index = ?",
                    (time_slot['day'], time_slot['time_index'])
                )
            await self.conn.commit()
            return True, f"{len(reserve_times)}개의 예약을 삭제했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"삭제 중 오류 발생: {str(e)}"
        finally:
            await cursor.close()

    async def force_create_reservation(self, target_username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
            cursor = await self.conn.cursor()
            try:
                await cursor.execute("BEGIN TRANSACTION")
                for time_slot in reserve_times:
                    await cursor.execute(
                        "DELETE FROM reservations WHERE reservation_day = ? AND time_index = ?",
                        (time_slot['day'], time_slot['time_index'])
                    )
                    await cursor.execute(
                        "INSERT INTO reservations (username, reservation_day, time_index) VALUES (?, ?, ?)",
                        (target_username, time_slot['day'], time_slot['time_index'])
                    )
                await self.conn.commit()
                return True, f"'{target_username}'의 이름으로 {len(reserve_times)}개의 예약을 강제 등록했습니다."
            except Exception as e:
                await self.conn.rollback()
                return False, f"강제 등록 중 오류 발생: {str(e)}"
            finally:
                await cursor.close()

    async def get_all_reservations(self) -> List[dict]:
        cursor = await self.conn.cursor()
        await cursor.execute("SELECT username, reservation_day, time_index FROM reservations")
        reservations = await cursor.fetchall()
        await cursor.close()
        return [dict(row) for row in reservations]