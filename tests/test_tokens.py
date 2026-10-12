"""토큰 충전·장부 API 테스트."""


def _enable(client, admin):
    r = client.put("/admin/token-settings", headers=admin, json={"token_charge_enabled": True})
    assert r.status_code == 200, r.text


def _add_pack(client, admin, name="1만원", price=10000, tokens=16):
    r = client.post("/admin/token-packs", headers=admin, json={"name": name, "price_won": price, "tokens": tokens})
    assert r.status_code == 200, r.text
    packs = client.get("/admin/token-packs", headers=admin).json()
    return [p for p in packs if p["name"] == name][-1]


def test_member_cannot_use_tokens_until_enabled(client, admin, make_user):
    _, member = make_user()
    client.put("/admin/token-settings", headers=admin, json={"token_charge_enabled": False})
    assert client.get("/tokens/packs", headers=member).status_code == 403
    assert client.get("/settings").json()["token_charge_enabled"] is False
    # 관리자는 미리 써볼 수 있다
    assert client.get("/tokens/packs", headers=admin).status_code == 200
    _enable(client, admin)
    assert client.get("/tokens/packs", headers=member).status_code == 200
    assert client.get("/settings").json()["token_charge_enabled"] is True


def test_pack_validation_and_crud(client, admin):
    # 토큰은 1 이상의 정수만 허용 (소수·0·음수는 입력 검증에서 거절)
    for bad_tokens in (0.5, 0, -3):
        bad = client.post("/admin/token-packs", headers=admin, json={"name": "x", "price_won": 1000, "tokens": bad_tokens})
        assert bad.status_code in (400, 422), bad.text
    pack = _add_pack(client, admin, "검증상품", 20000, 17)
    assert pack["tokens"] == 17 and pack["price_won"] == 20000 and pack["active"] is True
    r = client.put(f"/admin/token-packs/{pack['id']}", headers=admin, json={"tokens": 18, "active": False})
    assert r.status_code == 200
    updated = [p for p in client.get("/admin/token-packs", headers=admin).json() if p["id"] == pack["id"]][0]
    assert updated["tokens"] == 18 and updated["active"] is False
    # 판매 중지된 상품은 회원 목록에서 빠진다
    assert all(p["id"] != pack["id"] for p in client.get("/tokens/packs", headers=admin).json())
    assert client.delete(f"/admin/token-packs/{pack['id']}", headers=admin).status_code == 200
    assert client.delete(f"/admin/token-packs/{pack['id']}", headers=admin).status_code == 400


def test_purchase_flow_confirm_and_undo(client, admin, make_user):
    _enable(client, admin)
    pack = _add_pack(client, admin, "충전A", 10000, 16)
    username, member = make_user()

    r = client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    assert r.status_code == 200
    me = client.get("/tokens/me", headers=member).json()
    assert me["balance"] == 0 and me["purchases"][0]["status"] == "pending"
    purchase_id = me["purchases"][0]["id"]

    pending = client.get("/admin/token-purchases", headers=admin, params={"status_filter": "pending"}).json()
    assert any(p["id"] == purchase_id and p["username"] == username and p["tokens"] == 16 for p in pending)

    assert client.post(f"/admin/token-purchases/{purchase_id}/confirm", headers=admin).status_code == 200
    assert client.post(f"/admin/token-purchases/{purchase_id}/confirm", headers=admin).status_code == 400  # 중복 지급 방지
    me = client.get("/tokens/me", headers=member).json()
    assert me["balance"] == 16
    assert me["ledger"][0]["kind"] == "purchase" and me["ledger"][0]["tokens"] == 16
    assert me["purchases"][0]["confirmed_by"] == "admin"

    # 상품 가격이 나중에 바뀌어도 요청에 기록된 금액·토큰은 그대로
    client.put(f"/admin/token-packs/{pack['id']}", headers=admin, json={"price_won": 99999, "tokens": 1})
    assert client.get("/tokens/me", headers=member).json()["purchases"][0]["price_won"] == 10000

    assert client.post(f"/admin/token-purchases/{purchase_id}/undo", headers=admin).status_code == 200
    assert client.get("/tokens/me", headers=member).json()["balance"] == 0
    assert client.post(f"/admin/token-purchases/{purchase_id}/undo", headers=admin).status_code == 400


def test_undo_blocked_when_tokens_were_used(client, admin, make_user):
    _enable(client, admin)
    pack = _add_pack(client, admin, "충전B", 10000, 16)
    username, member = make_user()
    client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    purchase_id = client.get("/tokens/me", headers=member).json()["purchases"][0]["id"]
    client.post(f"/admin/token-purchases/{purchase_id}/confirm", headers=admin)
    client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": -10, "memo": "사용 가정"})
    r = client.post(f"/admin/token-purchases/{purchase_id}/undo", headers=admin)
    assert r.status_code == 400 and "이미 사용" in r.json()["detail"]


def test_reject_and_user_cancel_and_pending_limit(client, admin, make_user):
    _enable(client, admin)
    pack = _add_pack(client, admin, "충전C", 10000, 16)
    _, member = make_user()
    for _ in range(3):
        assert client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]}).status_code == 200
    too_many = client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    assert too_many.status_code == 400 and "대기 중" in too_many.json()["detail"]

    purchases = client.get("/tokens/me", headers=member).json()["purchases"]
    assert client.post(f"/tokens/purchases/{purchases[0]['id']}/cancel", headers=member).status_code == 200
    assert client.post(f"/tokens/purchases/{purchases[0]['id']}/cancel", headers=member).status_code == 400
    assert client.post(f"/admin/token-purchases/{purchases[1]['id']}/reject", headers=admin, json={"memo": "입금 없음"}).status_code == 200
    states = {p["id"]: p["status"] for p in client.get("/tokens/me", headers=member).json()["purchases"]}
    assert states[purchases[0]["id"]] == "cancelled" and states[purchases[1]["id"]] == "cancelled"
    # 다른 회원의 요청은 취소할 수 없다
    _, other = make_user("김철수")
    assert client.post(f"/tokens/purchases/{purchases[2]['id']}/cancel", headers=other).status_code == 400


def test_adjust_rules(client, admin, make_user):
    username, member = make_user()
    ok = client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": 7, "memo": "이벤트"})
    assert ok.status_code == 200
    assert client.get("/tokens/me", headers=admin).status_code == 200  # 관리자 미리보기
    ledger = client.get(f"/admin/token-ledger/{username}", headers=admin).json()
    assert ledger["balance"] == 7 and ledger["ledger"][0]["memo"] == "이벤트"
    # 잔액보다 많이 차감 불가, 정수만, 0 불가
    assert client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": -8, "memo": "x"}).status_code == 400
    assert client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": 1.5, "memo": "x"}).status_code in (400, 422)
    assert client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": 0, "memo": "x"}).status_code == 400
    assert client.post("/admin/tokens/adjust", headers=admin, json={"username": "nobody", "tokens": 1, "memo": "x"}).status_code == 400
    assert client.post("/admin/tokens/adjust", headers=admin, json={"username": "admin", "tokens": 1, "memo": "x"}).status_code == 400
    balances = {b["username"]: b["balance"] for b in client.get("/admin/token-balances", headers=admin).json()}
    assert balances[username] == 7


def test_member_cannot_call_admin_endpoints(client, make_user):
    _, member = make_user()
    assert client.get("/admin/token-packs", headers=member).status_code == 403
    assert client.post("/admin/tokens/adjust", headers=member, json={"username": "x", "tokens": 1, "memo": "m"}).status_code == 403
    assert client.post("/admin/token-purchases/1/confirm", headers=member).status_code == 403
