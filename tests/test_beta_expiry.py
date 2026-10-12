"""토큰 소멸, 무료 프로모션 팩, 일괄 지급, 베타 모드(기존 월 신청과 공존) 테스트."""
from datetime import datetime, timedelta, timezone

import pytest

from src.tokens import add_months, replay_lots

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 12, 10, 12, 0, tzinfo=KST)


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    monkeypatch.setattr("src.booking.now_kst", lambda: NOW)


@pytest.fixture(autouse=True)
def charge_open(client, admin):
    client.put("/admin/token-settings", headers=admin, json={"token_charge_enabled": True})
    yield
    client.put("/admin/token-settings", headers=admin, json={"token_charge_enabled": False})


def _row(delta, at, expires=None, ref=None, kind="x"):
    return {
        "delta": delta, "kind": kind, "created_at": at.isoformat(),
        "expires_at": expires.isoformat() if expires else None,
        "ref_type": ref[0] if ref else None, "ref_id": ref[1] if ref else None,
    }


def test_replay_expiry_and_fifo():
    t0 = datetime(2026, 1, 1, tzinfo=KST)
    rows = [
        _row(5, t0, expires=t0 + timedelta(days=30)),          # 먼저 사라질 토큰
        _row(5, t0, expires=t0 + timedelta(days=90)),
        _row(-3, t0 + timedelta(days=1), ref=("booking", 1)),   # 먼저 사라질 것부터 차감
    ]
    lots, spend = replay_lots(rows, t0 + timedelta(days=10))
    assert sum(l["tokens"] for l in lots) == 7
    assert spend[("booking", 1)] == (t0 + timedelta(days=30)).isoformat()  # 환불 시 이어받을 소멸 시각
    lots, _ = replay_lots(rows, t0 + timedelta(days=31))                  # 30일 뒤: 남은 2토큰 소멸
    assert sum(l["tokens"] for l in lots) == 5
    lots, _ = replay_lots(rows, t0 + timedelta(days=91))
    assert lots == []
    # 소멸 시각이 없는(예전) 지급분은 사라지지 않는다
    lots, _ = replay_lots([_row(4, t0)], t0 + timedelta(days=1000))
    assert sum(l["tokens"] for l in lots) == 4


def test_add_months_clamps_day():
    assert add_months(datetime(2026, 11, 30, tzinfo=KST), 3).date().isoformat() == "2027-02-28"


def test_purchase_expires_in_three_months(client, admin, make_user):
    username, member = make_user()
    pack_id = _make_pack(client, admin, name="일반팩", price=10000, tokens=7)
    pid = _request(client, member, pack_id)
    assert client.post(f"/admin/token-purchases/{pid}/confirm", headers=admin).status_code == 200
    me = client.get("/tokens/me", headers=member).json()
    assert me["balance"] == 7 and len(me["lots"]) == 1
    exp = datetime.fromisoformat(me["lots"][0]["expires_at"])
    days = (exp - datetime.now(KST)).days
    assert 88 <= days <= 93


def _make_pack(client, admin, **kw):
    body = {"name": kw.get("name", "팩"), "price_won": kw.get("price", 1000), "tokens": kw.get("tokens", 1)}
    for k in ("auto_confirm", "expires_on", "audience"):
        if k in kw:
            body[k] = kw[k]
    assert client.post("/admin/token-packs", headers=admin, json=body).status_code == 200
    packs = client.get("/admin/token-packs", headers=admin).json()
    return [p for p in packs if p["name"] == body["name"]][-1]["id"]


def _request(client, member, pack_id):
    r = client.post("/tokens/purchases", headers=member, json={"pack_id": pack_id})
    assert r.status_code == 200, r.text
    purchases = client.get("/tokens/me", headers=member).json()["purchases"]
    return purchases[0]["id"]


def test_free_promo_pack_is_instant_and_free_members_only(client, admin, make_user):
    free_user, free_member = make_user()
    normal_user, normal_member = make_user()
    assert client.put(f"/admin/users/{free_user}", headers=admin, json={"free_access": True}).status_code == 200
    end = (datetime.now(KST).date() + timedelta(days=20)).isoformat()
    pack_id = _make_pack(
        client, admin, name="무료 100", price=0, tokens=100, auto_confirm=True, expires_on=end, audience="free"
    )
    # 일반 회원은 목록에도 안 보이고 요청도 막힌다
    assert pack_id not in [p["id"] for p in client.get("/tokens/packs", headers=normal_member).json()]
    assert client.post("/tokens/purchases", headers=normal_member, json={"pack_id": pack_id}).status_code == 400
    # 자유이용 회원은 요청 즉시 지급 (횟수 제한 없음), 소멸은 지정한 날 끝
    for _ in range(2):
        r = client.post("/tokens/purchases", headers=free_member, json={"pack_id": pack_id})
        assert r.status_code == 200 and "바로" in r.json()["message"]
    me = client.get("/tokens/me", headers=free_member).json()
    assert me["balance"] == 200
    assert all(l["expires_at"].startswith((datetime.fromisoformat(end) + timedelta(days=1)).date().isoformat()) for l in me["lots"])


def test_price_zero_requires_auto_confirm(client, admin):
    r = client.post("/admin/token-packs", headers=admin, json={"name": "공짜", "price_won": 0, "tokens": 5})
    assert r.status_code == 400


def test_bulk_grant(client, admin, make_user):
    u1, m1 = make_user()
    u2, m2 = make_user()
    end = (datetime.now(KST).date() + timedelta(days=10)).isoformat()
    r = client.post("/admin/tokens/grant", headers=admin, json={"usernames": [u1, u2], "tokens": 10, "memo": "11월 베타", "expires_on": end})
    assert r.status_code == 200, r.text
    assert client.get("/tokens/me", headers=m1).json()["balance"] == 10
    ledger = client.get(f"/admin/token-ledger/{u2}", headers=admin).json()["ledger"]
    assert ledger[0]["kind"] == "grant" and ledger[0]["expires_at"]
    bad = client.post("/admin/tokens/grant", headers=admin, json={"usernames": [u1, "없는사람"], "tokens": 1, "memo": "x"})
    assert bad.status_code == 400
    assert client.get("/tokens/me", headers=m1).json()["balance"] == 10  # 일부만 지급되지 않는다


@pytest.fixture()
def beta_mode(client, admin):
    r = client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "beta", "beta_month": "2026-12"})
    assert r.status_code == 200, r.text
    yield
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})


def test_beta_does_not_require_month_and_uses_current_monthly_period(client, admin, make_user):
    """월 신청 패턴은 '지금 받고 있는 월 신청의 대상 달'에 적용된다 (베타 달 설정과 무관)."""
    client.put("/admin/booking-settings", headers=admin, json={"beta_month": ""})
    r = client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "beta"})
    assert r.status_code == 200, r.text
    try:
        owner, _ = make_user("월신청러2")
        booker, booker_h = make_user("토큰러2")
        client.post("/admin/tokens/adjust", headers=admin, json={"username": booker, "tokens": 30, "memo": "t"})
        client.post("/admin/reservations/create", headers=admin, json={
            "target_username": owner, "reservation_type": "monthly",
            "reservations": [{"day": "Wednesday", "time_index": 11}],
        })
        # NOW=2026-12-10 → 월 신청 대상 달은 2026-12: 수요일 11시는 막히고 다른 달에는 적용되지 않는다
        blocked = client.post("/bookings", headers=booker_h, json={"slots": [{"date": "2026-12-16", "hour": 11}]})
        assert blocked.status_code == 400 and "월 신청" in blocked.json()["detail"]
        ok = client.post("/bookings", headers=booker_h, json={"slots": [{"date": "2026-12-16", "hour": 12}]})
        assert ok.status_code == 200, ok.text
    finally:
        client.post("/admin/reservations/delete", headers=admin, json={"reservations": [{"day": "Wednesday", "time_index": 11}]})
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})


def test_beta_monthly_vs_token_conflicts(client, admin, make_user, beta_mode):
    owner, owner_h = make_user("월신청러")
    booker, booker_h = make_user("토큰러")
    client.post("/admin/tokens/adjust", headers=admin, json={"username": booker, "tokens": 30, "memo": "t"})
    # 관리자가 월 신청(목요일 15시)을 강제 등록 -> 12월 목요일 15시는 토큰 화면에서 예약됨
    r = client.post("/admin/reservations/create", headers=admin, json={
        "target_username": owner, "reservation_type": "monthly",
        "reservations": [{"day": "Thursday", "time_index": 15}],
    })
    assert r.status_code == 200, r.text
    day = client.get("/bookings/range", headers=booker_h, params={"start": "2026-12-17", "days": 1}).json()["days"][0]
    slot = {s["hour"]: s for s in day["slots"]}[15]
    assert slot["status"] == "taken" and slot["name"] == "월신청러" and slot["booking_id"] is None
    mine_view = client.get("/bookings/range", headers=owner_h, params={"start": "2026-12-17", "days": 1}).json()["days"][0]
    assert {s["hour"]: s for s in mine_view["slots"]}[15]["status"] == "mine"
    cal = {d["date"]: d for d in client.get("/bookings/calendar", headers=booker_h, params={"month": "2026-12"}).json()["days"]}
    assert cal["2026-12-17"]["occupancy"][15] == "1" and cal["2026-12-24"]["occupancy"][15] == "1"
    assert cal["2026-12-18"]["occupancy"][15] == "0"
    blocked = client.post("/bookings", headers=booker_h, json={"slots": [{"date": "2026-12-17", "hour": 15}]})
    assert blocked.status_code == 400 and "월 신청" in blocked.json()["detail"]
    # 반대로 토큰 예약이 있는 시간은 월 신청을 만들 수 없다 (금요일 20시에 12/18 토큰 예약)
    ok = client.post("/bookings", headers=booker_h, json={"slots": [{"date": "2026-12-18", "hour": 20}]})
    assert ok.status_code == 200, ok.text
    r = client.post("/admin/reservations/create", headers=admin, json={
        "target_username": owner, "reservation_type": "monthly",
        "reservations": [{"day": "Friday", "time_index": 20}],
    })
    assert r.status_code == 400 and "토큰" in r.json()["detail"]
    # 베타 이외의 달(1월)은 월 신청이 적용되지 않는다
    jan = client.get("/bookings/range", headers=booker_h, params={"start": "2027-01-07", "days": 1})
    assert jan.status_code in (200, 400)


def test_beta_blocks_free_use_but_not_monthly(client, admin, make_user, beta_mode):
    _, member = make_user()
    free = client.post("/free/reserve", headers=member, json={"reservations": [{"day": "Monday", "time_index": 10}]})
    assert free.status_code == 403 and "토큰" in free.json()["detail"]
    monthly = client.post("/reserve", headers=member, json={"reservations": [{"day": "Monday", "time_index": 10}]})
    assert monthly.status_code != 403 or "토큰" not in monthly.json()["detail"]
    # 토큰 메뉴·예약은 열린다
    assert client.get("/tokens/me", headers=member).status_code == 200
    assert client.get("/bookings/config", headers=member).json()["mode"] == "beta"
    assert client.get("/settings").json()["reservation_mode"] == "beta"


def test_balances_list_includes_dawn_flag(client, admin, make_user):
    username, _ = make_user()
    client.put(f"/admin/users/{username}/dawn", headers=admin, json={"allowed": False})
    row = [b for b in client.get("/admin/token-balances", headers=admin).json() if b["username"] == username][0]
    assert row["dawn_allowed"] is False and row["role"] == "user"


def test_expiry_accepts_exact_time_and_rejects_past(client, admin, make_user):
    u, member = make_user()
    future = (datetime.now(KST) + timedelta(days=5)).strftime("%Y-%m-%dT21:00")
    r = client.post("/admin/tokens/grant", headers=admin, json={"usernames": [u], "tokens": 5, "memo": "정확한 시각", "expires_on": future})
    assert r.status_code == 200, r.text
    ledger = client.get(f"/admin/token-ledger/{u}", headers=admin).json()
    assert ledger["lots"][0]["expires_at"].startswith(future) and ledger["lots"][0]["expires_at"].endswith("+09:00")
    past = (datetime.now(KST) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
    bad = client.post("/admin/tokens/grant", headers=admin, json={"usernames": [u], "tokens": 5, "memo": "지난 기한", "expires_on": past})
    assert bad.status_code == 400 and "지났" in bad.json()["detail"]
    assert client.post("/admin/tokens/grant", headers=admin, json={"usernames": [u], "tokens": 1, "memo": "x", "expires_on": "11/30"}).status_code == 400


def test_promo_pack_closes_at_exact_time(client, admin, make_user):
    free_user, free_member = make_user()
    client.put(f"/admin/users/{free_user}", headers=admin, json={"free_access": True})
    past = (datetime.now(KST) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M")
    pack_id = _make_pack(client, admin, name="종료된 무료", price=0, tokens=50, auto_confirm=True, expires_on=past, audience="free")
    assert pack_id not in [p["id"] for p in client.get("/tokens/packs", headers=free_member).json()]
    assert client.post("/tokens/purchases", headers=free_member, json={"pack_id": pack_id}).status_code == 400


def test_beta_month_open_time_exposed(client, admin):
    client.put("/admin/booking-settings", headers=admin, json={"beta_month": "2026-11"})
    s = client.get("/admin/booking-settings", headers=admin).json()
    assert s["beta_month_open_at"].startswith("2026-11-30T21:00")


def test_switching_to_beta_clears_leftover_free_reservations(client, admin, make_user):
    u, _ = make_user("자유러")
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})
    r = client.post("/admin/reservations/create", headers=admin, json={
        "target_username": u, "reservation_type": "free",
        "reservations": [{"day": "Saturday", "time_index": 3}],
    })
    assert r.status_code == 200, r.text
    before = client.get("/free/schedule", headers=admin).json()["free_reservations"]
    assert any(x["username"] == u for x in before)
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "beta"})
    try:
        after = client.get("/free/schedule", headers=admin).json()["free_reservations"]
        assert not any(x["username"] == u for x in after)
    finally:
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})
