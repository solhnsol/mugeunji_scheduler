"""Render에서 받은 운영 DB 사본을 개인정보 제거본으로 복사한다 (배포 전 리허설용).

    python scripts/anonymize_db.py <원본.db> <출력.db>

이름/전화번호/이메일을 마스킹하고 모든 비밀번호를 '1234'로, 관리자는 'admin1234'로 바꾼다.
원본은 수정하지 않는다. 출력 파일은 커밋하지 말 것 (data/ 는 .gitignore).
"""
import shutil
import sqlite3
import sys

import bcrypt


def main(src: str, dst: str) -> None:
    shutil.copyfile(src, dst)
    conn = sqlite3.connect(dst)
    user_hash = bcrypt.hashpw(b"1234", bcrypt.gensalt()).decode()
    admin_hash = bcrypt.hashpw(b"admin1234", bcrypt.gensalt()).decode()
    rows = conn.execute("SELECT username, role FROM users ORDER BY rowid").fetchall()
    for i, (username, role) in enumerate(rows, 1):
        conn.execute(
            "UPDATE users SET password = ?, name = ?, phone = ?, email = NULL WHERE username = ?",
            (admin_hash if role == "admin" else user_hash,
             f"회원{i:03d}" if role != "admin" else "관리자",
             f"010{i:08d}" if role != "admin" else None,
             username),
        )
    conn.commit()
    conn.close()
    print(f"완료: {dst} ({len(rows)}명 익명화)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
