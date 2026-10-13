"""SQLite 일일 백업. 서비스가 켜져 있어도 안전하게(온라인 백업 API) 복사한다.

사용: python scripts/backup_db.py [--db data/reservation.db] [--out data/backups] [--keep 14]
cron 예: 0 4 * * * cd /경로/mugeunji_scheduler && python scripts/backup_db.py

복원: 서비스를 멈추고 백업 파일을 DB_PATH 위치로 복사한 뒤(기존 -wal, -shm 파일은 지운다) 다시 시작한다.
"""
import argparse
import os
import sqlite3
from datetime import datetime


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.getenv("DB_PATH", "data/reservation.db"))
    parser.add_argument("--out", default="data/backups")
    parser.add_argument("--keep", type=int, default=14, help="남겨 둘 백업 개수")
    args = parser.parse_args()

    if not os.path.exists(args.db):
        raise SystemExit(f"DB 파일이 없어요: {args.db}")
    os.makedirs(args.out, exist_ok=True)
    target = os.path.join(args.out, f"reservation-{datetime.now():%Y%m%d-%H%M%S}.db")

    src = sqlite3.connect(args.db)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("백업 파일 무결성 검사에 실패했어요.")
    finally:
        dst.close()
        src.close()
    os.chmod(target, 0o600)  # 회원 연락처가 들어 있으므로 본인만 읽게 한다

    backups = sorted(f for f in os.listdir(args.out) if f.startswith("reservation-") and f.endswith(".db"))
    for old in backups[: max(0, len(backups) - args.keep)]:
        os.remove(os.path.join(args.out, old))
    print(f"백업 완료: {target}")


if __name__ == "__main__":
    main()
