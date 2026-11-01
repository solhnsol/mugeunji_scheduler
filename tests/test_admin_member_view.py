"""관리자 계정도 일반 로그인하면 회원으로, 관리자 로그인일 때만 관리자로 동작하는지."""


def test_admin_normal_login_is_member(client):
    r = client.post("/login", json={"username": "admin", "password": "admin-pass-1"})
    member = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=member).json()["role"] == "user"
    assert client.get("/admin/users", headers=member).status_code == 403


def test_admin_login_keeps_admin(client, admin):
    assert client.get("/me", headers=admin).json()["role"] == "admin"
    assert client.get("/admin/users", headers=admin).status_code == 200
