"""로컬 개발용 더미 데이터 생성.

    python scripts/seed_dummy.py                # data/dev.db 생성 (이미 있으면 중단)
    python scripts/seed_dummy.py --reset        # 기존 파일을 지우고 다시 생성
    python scripts/seed_dummy.py path/to/x.db

실행 후 서버는 DB 경로를 바꿔 띄운다:  DB_PATH=data/dev.db uvicorn main:app --reload
모든 계정 비밀번호는 1234, 관리자는 admin / admin1234.
"""
import argparse
import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from src.auth import AuthManager  # noqa: E402
from src.database import init_db  # noqa: E402
from src.membership import MembershipManager, usage_period  # noqa: E402
from src.reservation import ReservationManager  # noqa: E402
from src.automation_config import RESERVATION_FREE, RESERVATION_MONTHLY  # noqa: E402

PASSWORD = "1234"

USERS = [
    # username, name, phone
    ("newbie", "신규가입", "01000000001"),
    ("pending4", "입금대기", "01000000002"),
    ("paid6", "월예약6h", "01000000003"),
    ("free8", "자유이용8h", "01000000004"),
    ("freeonly", "자유전용", "01000000005"),
    ("leaving", "중단예정", "01000000006"),
]


async def main(db_path: str) -> None:
    conn = await init_db(db_path)
    auth = AuthManager(conn)
    ms = MembershipManager(conn)
    rm = ReservationManager(conn)

    for username, name, phone in USERS:
        ok, msg = await auth.register(username, PASSWORD, name, phone)
        if not ok:
            print(f"  ! {username}: {msg}")

    plans = {p["allowed_hours"]: p["id"] for p in await ms.get_plans()}
    for hours, price in ((4, 40000), (6, 60000), (8, 80000)):
        await conn.execute("UPDATE plans SET monthly_price = ? WHERE allowed_hours = ?", (price, hours))
    await conn.commit()

    this_month = "current"
    await ms.apply_for_plan("pending4", plans[4], this_month)
    await ms.apply_for_plan("paid6", plans[6], this_month)
    await ms.apply_for_plan("free8", plans[8], this_month)
    await ms.apply_for_plan("leaving", plans[4], this_month)
    await ms.update_user_membership(
        "freeonly", allowed_hours=0, free_access=True, custom_monthly_fee=40000
    )

    period = usage_period()
    for username in ("paid6", "free8", "freeonly", "leaving"):
        billing = await ms.get_billing_cycle(username, period)
        if billing:
            await ms.confirm_payment(billing["id"], "admin")
    await ms.request_cancellation("leaving")

    await rm.force_create_reservation("paid6", [
        {"day": "Tuesday", "time_index": 19}, {"day": "Tuesday", "time_index": 20},
        {"day": "Thursday", "time_index": 19},
    ], RESERVATION_MONTHLY)
    await rm.force_create_reservation("free8", [
        {"day": "Saturday", "time_index": 13}, {"day": "Saturday", "time_index": 14},
    ], RESERVATION_MONTHLY)
    await rm.force_create_reservation("freeonly", [
        {"day": "Sunday", "time_index": 22},
    ], RESERVATION_FREE)

    await conn.close()
    print(f"완료: {db_path}")
    print("  admin / admin1234, 나머지 계정 비밀번호 1234:", ", ".join(u[0] for u in USERS))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("db_path", nargs="?", default="data/dev.db")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()
    if os.path.exists(args.db_path):
        if not args.reset:
            sys.exit(f"{args.db_path} 가 이미 있습니다. 덮어쓰려면 --reset")
        os.remove(args.db_path)
    asyncio.run(main(args.db_path))
