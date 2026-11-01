def _row(client, admin, username):
    users = client.get("/admin/users", headers=admin).json()
    return next(u for u in users if u["username"] == username)


def test_me_records_client_kind(client, admin, make_user):
    username, auth = make_user()
    assert _row(client, admin, username)["last_client"] is None

    client.get("/me", headers={**auth, "X-Client": "mobile"})
    assert _row(client, admin, username)["last_client"] == "mobile"

    client.get("/me", headers={**auth, "X-Client": "app"})
    row = _row(client, admin, username)
    assert row["last_client"] == "app" and row["last_client_at"]

    # 모르는 값·헤더 없음은 기록을 바꾸지 않는다
    client.get("/me", headers={**auth, "X-Client": "hacker"})
    client.get("/me", headers=auth)
    assert _row(client, admin, username)["last_client"] == "app"
