import aiosqlite
from typing import List, Dict, Tuple

class ReservationManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def create_reservation(self, username: str, reserve_times: List[Dict]) -> Tuple[bool, str]:
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
            await cursor.execute("DELETE FROM reservations")
            await self.conn.commit()
            return True, "성공"
        except Exception as e:
            await self.conn.rollback()
            return False, f"실패: {str(e)}"
        finally:
            await cursor.close()

    async def get_all_reservations(self) -> List[dict]:
        cursor = await self.conn.cursor()
        await cursor.execute("SELECT username, reservation_day, time_index FROM reservations")
        reservations = await cursor.fetchall()
        await cursor.close()
        return [dict(row) for row in reservations]