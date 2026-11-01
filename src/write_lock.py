import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar

# 단일 DB 연결을 공유하므로 쓰기는 이 락 하나로 직렬화한다 (프로세스 단위라 uvicorn 워커는 1개).
_lock = asyncio.Lock()
_held: ContextVar[bool] = ContextVar("write_lock_held", default=False)


@asynccontextmanager
async def writing():
    """쓰기 락을 잡는다. 이미 잡고 있는 요청 안에서 다시 부르면 그대로 통과한다 (재진입)."""
    if _held.get():
        yield
        return
    async with _lock:
        token = _held.set(True)
        try:
            yield
        finally:
            _held.reset(token)
