"""관리자 계정도 일반 로그인하면 회원으로, 관리자 로그인일 때만 관리자로 동작하는지."""


def test_admin_normal_login_is_member(client):
    r = client.post("/login", json={"username": "admin", "password": "admin-pass-1"})
    member = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = client.get("/me", headers=member).json()
    assert me["role"] == "user" and me["admin_account"]
    assert client.get("/admin/users", headers=member).status_code == 403


def test_admin_login_keeps_admin(client, admin):
    assert client.get("/me", headers=admin).json()["role"] == "admin"
    assert client.get("/admin/users", headers=admin).status_code == 200


def test_admin_account_gets_tokens_free(client, admin):
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"})
    try:
        client.post("/admin/token-packs", headers=admin, json={"name": "관리자팩", "price_won": 30000, "tokens": 5})
        r = client.post("/login", json={"username": "admin", "password": "admin-pass-1"})
        member = {"Authorization": f"Bearer {r.json()['access_token']}"}
        pack = next(p for p in client.get("/tokens/packs", headers=member).json() if p["name"] == "관리자팩")
        assert pack["price_won"] == 0 and pack["auto_confirm"]
        before = client.get("/tokens/me", headers=member).json()["balance"]
        assert client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]}).status_code == 200
        assert client.get("/tokens/me", headers=member).json()["balance"] == before + 5
    finally:
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})
