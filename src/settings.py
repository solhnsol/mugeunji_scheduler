import aiosqlite
from typing import Dict, Tuple

class SettingsManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def get_settings(self) -> Dict:
        cursor = await self.conn.cursor()
        await cursor.execute("SELECT key, value FROM system_settings")
        settings = await cursor.fetchall()
        await cursor.close()
        return {row['key']: row['value'] for row in settings}

    async def update_settings(self, new_settings: Dict) -> Tuple[bool, str]:
        cursor = await self.conn.cursor()
        try:
            await cursor.execute("BEGIN TRANSACTION")
            for key, value in new_settings.items():
                await cursor.execute(
                    "UPDATE system_settings SET value = ? WHERE key = ?",
                    (value, key)
                )
            await self.conn.commit()
            return True, "설정을 성공적으로 업데이트했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"설정 업데이트 중 오류 발생: {str(e)}"
        finally:
            await cursor.close()