import asyncpg
from typing import Dict, Tuple

class SettingsManager:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def get_settings(self) -> Dict:
        settings = await self.conn.fetch("SELECT key, value FROM system_settings")
        return {row['key']: row['value'] for row in settings}

    async def update_settings(self, new_settings: Dict) -> Tuple[bool, str]:
        try:
            async with self.conn.transaction():
                for key, value in new_settings.items():
                    await self.conn.execute(
                        "UPDATE system_settings SET value = $1 WHERE key = $2",
                        value, key
                    )
            return True, "설정을 성공적으로 업데이트했습니다."
        except Exception as e:
            return False, f"설정 업데이트 중 오류 발생: {str(e)}"