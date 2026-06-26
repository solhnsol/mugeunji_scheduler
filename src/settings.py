import aiosqlite
from typing import Dict, Tuple


class SettingsManager:
    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn

    async def get_settings(self) -> Dict:
        async with self.conn.execute("SELECT key, value FROM system_settings") as cursor:
            rows = await cursor.fetchall()
        return {row["key"]: row["value"] for row in rows}

    async def update_settings(self, new_settings: Dict) -> Tuple[bool, str]:
        return await self.upsert_settings(new_settings)

    async def upsert_settings(self, new_settings: Dict) -> Tuple[bool, str]:
        try:
            for key, value in new_settings.items():
                await self.conn.execute(
                    """
                    INSERT INTO system_settings (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (key, value),
                )
            await self.conn.commit()
            return True, "설정을 성공적으로 업데이트했습니다."
        except Exception as e:
            await self.conn.rollback()
            return False, f"설정 업데이트 중 오류 발생: {str(e)}"
