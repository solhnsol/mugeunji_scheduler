"""회원이 거치는 핵심 흐름을 API로 처음부터 끝까지: 가입 → 충전 요청 → 입금 확인 → 예약 → 취소 환불."""
from datetime import datetime, timedelta, timezone

import pytest

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 12, 10, 12, 0, tzinfo=KST)


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    monkeypatch.setattr("src.booking.now_kst", lambda: NOW)


@pytest.fixture()
def token_mode(client, admin):
    assert client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"}).status_code == 200
    yield
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})


def test_signup_to_booking_and_refund(client, admin, token_mode):
    # 가입 → 로그인
    r = client.post("/register", json={"username": "flowuser", "password": "secret12", "name": "흐름", "phone": "01055556666"})
    assert r.status_code == 200, r.text
    login = client.post("/login", json={"username": "flowuser", "password": "secret12"})
    assert login.status_code == 200
    member = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # 충전 상품 → 요청 → 관리자 확인
    pack = client.post("/admin/token-packs", headers=admin, json={"name": "흐름팩", "price_won": 20000, "tokens": 12})
    assert pack.status_code == 200, pack.text
    pack_id = next(p["id"] for p in client.get("/admin/token-packs", headers=admin).json() if p["name"] == "흐름팩")
    assert any(p["id"] == pack_id for p in client.get("/tokens/packs", headers=member).json())
    assert client.post("/tokens/purchases", headers=member, json={"pack_id": pack_id}).status_code == 200
    assert client.get("/tokens/me", headers=member).json()["balance"] == 0  # 확인 전에는 지급되지 않는다
    purchase = client.get("/admin/token-purchases", headers=admin, params={"status": "pending"}).json()
    purchase_id = next(p["id"] for p in purchase if p["username"] == "flowuser")
    assert client.post(f"/admin/token-purchases/{purchase_id}/confirm", headers=admin).status_code == 200
    assert client.get("/tokens/me", headers=member).json()["balance"] == 12

    # 예약: 16~17시는 4토큰
    r = client.post("/bookings", headers=member, json={"slots": [{"date": "2026-12-26", "hour": 16}]})
    assert r.status_code == 200, r.text
    assert client.get("/tokens/me", headers=member).json()["balance"] == 8
    mine = client.get("/bookings/mine", headers=member).json()
    assert len(mine) == 1 and mine[0]["cost"] == 4

    # 같은 칸은 다른 회원이 예약할 수 없다
    client.post("/register", json={"username": "flowother", "password": "secret12", "name": "다른", "phone": "01077778888"})
    other = {"Authorization": "Bearer " + client.post("/login", json={"username": "flowother", "password": "secret12"}).json()["access_token"]}
    client.post("/admin/tokens/adjust", headers=admin, json={"username": "flowother", "tokens": 5, "memo": "테스트"})
    assert client.post("/bookings", headers=other, json={"slots": [{"date": "2026-12-26", "hour": 16}]}).status_code == 400
    # 남의 예약은 취소할 수 없다
    assert client.post("/bookings/cancel", headers=other, json={"ids": [mine[0]["id"]]}).status_code == 400

    # 취소하면 기본 정책(시작 전까지 100%)대로 환불
    assert client.post("/bookings/cancel", headers=member, json={"ids": [mine[0]["id"]]}).status_code == 200
    assert client.get("/tokens/me", headers=member).json()["balance"] == 12
    assert client.get("/bookings/mine", headers=member).json() == []
