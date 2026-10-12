"""날짜 기반 토큰 예약 테스트. 시각은 고정해서 날짜에 상관없이 같은 결과가 나오게 한다."""
from datetime import datetime, timedelta, timezone

import pytest

KST = timezone(timedelta(hours=9))
# 2026-12-10(목) 12:00 — 이번 달 말은 12/31, 다음 달 예약 오픈은 12/31 21:00(기본 설정)
NOW = datetime(2026, 12, 10, 12, 0, tzinfo=KST)


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr("src.booking.now_kst", lambda: state["now"])
    return state


@pytest.fixture()
def token_mode(client, admin):
    r = client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"})
    assert r.status_code == 200, r.text
    yield
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})
    client.put("/admin/booking-settings", headers=admin, json={"refund_tiers": [{"hours_before": 0, "percent": 100}]})


def _give(client, admin, username, tokens):
    r = client.post("/admin/tokens/adjust", headers=admin, json={"username": username, "tokens": tokens, "memo": "테스트 지급"})
    assert r.status_code == 200, r.text


def _book(client, headers, *slots):
    return client.post("/bookings", headers=headers, json={"slots": [{"date": d, "hour": h} for d, h in slots]})


def _balance(client, headers):
    return client.get("/bookings/config", headers=headers).json()["balance"]


def test_config_defaults(client, make_user):
    _, member = make_user()
    cfg = client.get("/bookings/config", headers=member).json()
    assert cfg["price_bands"] == [
        {"start": 0, "end": 4, "cost": 1}, {"start": 4, "end": 8, "cost": 0}, {"start": 8, "end": 12, "cost": 1},
        {"start": 12, "end": 16, "cost": 2}, {"start": 16, "end": 24, "cost": 4},
    ]
    assert cfg["refund_tiers"] == [{"hours_before": 0, "percent": 100}]
    assert cfg["bookable_from"] == "2026-12-10" and cfg["bookable_until"] == "2026-12-31"
    assert cfg["next_month_open"] is False and cfg["next_month_open_at"].startswith("2026-12-31T21:00")
    assert cfg["dawn_allowed"] is True and cfg["balance"] == 0


def test_mode_guards(client, admin, make_user):
    username, member = make_user()
    _give(client, admin, username, 10)
    # 전환 전: 회원은 토큰 예약 불가, 기존 예약은 가능(막히지 않음), 관리자는 미리 써볼 수 있다
    assert _book(client, member, ("2026-12-26", 16)).status_code == 403
    assert client.get("/bookings/mine", headers=member).status_code == 403
    assert client.get("/bookings/calendar", headers=admin, params={"month": "2026-12"}).status_code == 200
    # 전환 후: 토큰 예약 가능, 기존 예약 API는 회원에게 막힌다
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"})
    try:
        assert _book(client, member, ("2026-12-26", 16)).status_code == 200
        r = client.post("/reserve", headers=member, json={"reservations": [{"day": "Monday", "time_index": 10}]})
        assert r.status_code == 403 and "토큰" in r.json()["detail"]
        assert client.get("/settings").json()["reservation_mode"] == "token"
    finally:
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})


def test_charging_is_open_in_token_mode(client, admin, make_user, token_mode):
    """전환되면 충전 공개 스위치와 상관없이 회원이 충전 화면을 쓸 수 있다."""
    _, member = make_user()
    client.put("/admin/token-settings", headers=admin, json={"token_charge_enabled": False})
    assert client.get("/tokens/me", headers=member).status_code == 200
    assert client.get("/tokens/packs", headers=member).status_code == 200


def test_book_spends_tokens_and_shows_in_grids(client, admin, make_user, token_mode):
    u1, m1 = make_user("홍길동")
    u2, m2 = make_user("김철수")
    _give(client, admin, u1, 20)
    r = _book(client, m1, ("2026-12-12", 16), ("2026-12-12", 17), ("2026-12-12", 13))
    assert r.status_code == 200, r.text
    assert r.json()["spent"] == 4 + 4 + 2 and _balance(client, m1) == 10
    ledger = client.get("/tokens/me", headers=admin)  # 관리자 미리보기와 별개로 회원 장부 확인
    spend = [l for l in client.get(f"/admin/token-ledger/{u1}", headers=admin).json()["ledger"] if l["kind"] == "spend"]
    assert len(spend) == 3 and sum(l["tokens"] for l in spend) == -10

    day = client.get("/bookings/range", headers=m1, params={"start": "2026-12-12", "days": 1}).json()["days"][0]
    slots = {s["hour"]: s for s in day["slots"]}
    assert slots[16]["status"] == "mine" and slots[16]["booking_id"] is not None and slots[16]["paid"] == 4
    assert slots[14]["status"] == "free" and slots[14]["cost"] == 2 and slots[5]["cost"] == 0
    # 다른 회원 화면: 예약된 칸은 이름만 보이고 취소용 id는 숨겨진다
    other = {s["hour"]: s for s in client.get("/bookings/range", headers=m2, params={"start": "2026-12-12", "days": 1}).json()["days"][0]["slots"]}
    assert other[16]["status"] == "taken" and other[16]["name"] == "홍길동" and other[16]["booking_id"] is None and other[16]["paid"] is None

    cal = {d["date"]: d for d in client.get("/bookings/calendar", headers=m1, params={"month": "2026-12"}).json()["days"]}
    assert cal["2026-12-12"]["booked"] == 3 and cal["2026-12-12"]["mine"] == 3 and cal["2026-12-12"]["occupancy"][16] == "2"
    assert cal["2026-12-12"]["bookable"] is True and cal["2026-12-05"]["bookable"] is False  # 지난 날짜
    cal2 = {d["date"]: d for d in client.get("/bookings/calendar", headers=m2, params={"month": "2026-12"}).json()["days"]}
    assert cal2["2026-12-12"]["occupancy"][16] == "1" and cal2["2026-12-12"]["mine"] == 0
    assert len(client.get("/bookings/mine", headers=m1).json()) == 3


def test_balance_and_zero_cost_rules(client, admin, make_user, token_mode):
    username, member = make_user()
    low = _book(client, member, ("2026-12-13", 16))
    assert low.status_code == 400 and "부족" in low.json()["detail"]
    zero = _book(client, member, ("2026-12-13", 5))  # 04~08시는 0토큰이지만 토큰 1개 이상 필요
    assert zero.status_code == 400 and "1개 이상" in zero.json()["detail"]
    _give(client, admin, username, 1)
    ok = _book(client, member, ("2026-12-13", 5), ("2026-12-13", 6))
    assert ok.status_code == 200 and ok.json()["spent"] == 0 and _balance(client, member) == 1
    # 한 요청이 전부 성공하거나 전부 실패 (부족하면 아무것도 저장되지 않음)
    fail = _book(client, member, ("2026-12-13", 7), ("2026-12-13", 20))
    assert fail.status_code == 400
    assert len(client.get("/bookings/mine", headers=member).json()) == 2


def test_dawn_permission(client, admin, make_user, token_mode):
    username, member = make_user()
    _give(client, admin, username, 10)
    assert client.put(f"/admin/users/{username}/dawn", headers=admin, json={"allowed": False}).status_code == 200
    assert client.get("/bookings/config", headers=member).json()["dawn_allowed"] is False
    blocked = _book(client, member, ("2026-12-14", 2))
    assert blocked.status_code == 400 and "새벽" in blocked.json()["detail"]
    assert _book(client, member, ("2026-12-14", 9)).status_code == 200  # 새벽이 아닌 시간은 가능
    client.put(f"/admin/users/{username}/dawn", headers=admin, json={"allowed": True})
    assert _book(client, member, ("2026-12-14", 2)).status_code == 200
    users = {u["username"]: u for u in client.get("/admin/users", headers=admin).json()}
    assert users[username]["dawn_allowed"] is True


def test_conflict_past_and_range(client, admin, make_user, token_mode, fixed_now):
    u1, m1 = make_user()
    u2, m2 = make_user()
    _give(client, admin, u1, 30)
    _give(client, admin, u2, 30)
    assert _book(client, m1, ("2026-12-15", 14)).status_code == 200
    dup = _book(client, m2, ("2026-12-15", 14))
    assert dup.status_code == 400 and "이미 예약" in dup.json()["detail"]
    assert _book(client, m1, ("2026-12-10", 11)).status_code == 400  # 지난 시간
    assert _book(client, m1, ("2026-12-10", 12)).status_code == 400  # 시작 시각이 지금 → 불가
    assert _book(client, m1, ("2026-12-10", 13)).status_code == 200
    # 다음 달은 오픈 전이라 불가, 오픈 이후에는 다음 달 전체 가능
    early = _book(client, m2, ("2027-01-05", 14))
    assert early.status_code == 400 and "아직 예약할 수 없는" in early.json()["detail"]
    fixed_now["now"] = datetime(2026, 12, 31, 20, 59, tzinfo=KST)
    assert _book(client, m2, ("2027-01-05", 14)).status_code == 400
    fixed_now["now"] = datetime(2026, 12, 31, 21, 1, tzinfo=KST)
    cfg = client.get("/bookings/config", headers=m2).json()
    assert cfg["next_month_open"] is True and cfg["bookable_until"] == "2027-01-31"
    assert _book(client, m2, ("2027-01-05", 14)).status_code == 200
    assert _book(client, m2, ("2027-02-01", 14)).status_code == 400
    # 입력 검증
    assert _book(client, m2, ("2027-01-06", 30)).status_code == 422
    assert client.post("/bookings", headers=m2, json={"slots": [{"date": "2027-13-01", "hour": 9}]}).status_code == 400


def test_cancel_default_policy_full_refund(client, admin, make_user, token_mode, fixed_now):
    u1, m1 = make_user()
    u2, m2 = make_user()
    _give(client, admin, u1, 20)
    assert _book(client, m1, ("2026-12-16", 18), ("2026-12-16", 19)).status_code == 200
    assert _balance(client, m1) == 12
    mine = client.get("/bookings/mine", headers=m1).json()
    booking_ids = [b["id"] for b in mine if b["date"] == "2026-12-16"]
    # 다른 회원은 취소할 수 없다
    assert client.post("/bookings/cancel", headers=m2, json={"ids": booking_ids}).status_code == 400
    r = client.post("/bookings/cancel", headers=m1, json={"ids": booking_ids})
    assert r.status_code == 200 and r.json()["refunded"] == 8 and _balance(client, m1) == 20
    assert client.post("/bookings/cancel", headers=m1, json={"ids": booking_ids}).status_code == 400  # 이미 취소
    # 취소한 칸은 다른 회원이 바로 예약할 수 있다
    _give(client, admin, u2, 5)
    assert _book(client, m2, ("2026-12-16", 18)).status_code == 200
    # 이미 시작한 예약은 취소 불가
    assert _book(client, m1, ("2026-12-10", 15)).status_code == 200
    started = [b["id"] for b in client.get("/bookings/mine", headers=m1).json() if b["date"] == "2026-12-10"]
    fixed_now["now"] = datetime(2026, 12, 10, 15, 30, tzinfo=KST)
    late = client.post("/bookings/cancel", headers=m1, json={"ids": started})
    assert late.status_code == 400 and "시작" in late.json()["detail"]


def test_refund_tiers(client, admin, make_user, token_mode, fixed_now):
    username, member = make_user()
    _give(client, admin, username, 60)
    tiers = [{"hours_before": 168, "percent": 100}, {"hours_before": 24, "percent": 50}, {"hours_before": 3, "percent": 25}]
    assert client.put("/admin/booking-settings", headers=admin, json={"refund_tiers": tiers}).status_code == 200
    # 현재 12/10 12:00 기준 남은 시간: 12/20 16시=244h(100%), 12/11 16시=28h(50%), 12/10 16시=4h(25% 내림), 12/10 14시=2h(불가)
    cases = [("2026-12-20", 16, 4, 4), ("2026-12-11", 16, 4, 2), ("2026-12-10", 16, 4, 1)]
    for day, hour, cost, expected in cases:
        before = _balance(client, member)
        assert _book(client, member, (day, hour)).status_code == 200
        booking_id = [b["id"] for b in client.get("/bookings/mine", headers=member).json() if b["date"] == day and b["hour"] == hour][0]
        r = client.post("/bookings/cancel", headers=member, json={"ids": [booking_id]})
        assert r.status_code == 200 and r.json()["refunded"] == expected, (day, hour, r.text)
        assert _balance(client, member) == before - cost + expected
    assert _book(client, member, ("2026-12-10", 14)).status_code == 200
    booking_id = [b["id"] for b in client.get("/bookings/mine", headers=member).json() if b["hour"] == 14 and b["date"] == "2026-12-10"][0]
    late = client.post("/bookings/cancel", headers=member, json={"ids": [booking_id]})
    assert late.status_code == 400 and "시간이 지났" in late.json()["detail"]
    # 관리자는 정책과 무관하게 전액/무환불로 취소할 수 있다
    before = _balance(client, member)
    r = client.post(f"/admin/bookings/{booking_id}/cancel", headers=admin, json={"refund": True})
    assert r.status_code == 200 and r.json()["refunded"] == 2 and _balance(client, member) == before + 2


def test_admin_force_booking_and_list(client, admin, make_user, token_mode):
    username, member = make_user("강제회원")
    # 토큰이 없어도, 아직 열리지 않은 날짜(범위 밖)·새벽·지난 시간 아닌 한 등록되고 토큰은 건드리지 않는다
    r = client.post("/admin/bookings", headers=admin, json={"username": username, "slots": [{"date": "2027-03-01", "hour": 2}]})
    assert r.status_code == 200, r.text
    assert _balance(client, member) == 0
    rows = client.get("/admin/bookings", headers=admin, params={"date_filter": "2027-03-01"}).json()
    assert rows[0]["username"] == username and rows[0]["cost"] == 0 and rows[0]["status"] == "active"
    # 지난 시간은 관리자도 불가
    assert client.post("/admin/bookings", headers=admin, json={"username": username, "slots": [{"date": "2026-12-01", "hour": 9}]}).status_code == 400
    # 관리자 본인 예약은 토큰 없이 가능(미리보기)
    assert _book(client, admin, ("2026-12-22", 18)).status_code == 200
    # 회원은 관리자 API 불가
    assert client.get("/admin/bookings", headers=member).status_code == 403
    assert client.post(f"/admin/bookings/{rows[0]['id']}/cancel", headers=member, json={}).status_code == 403


def test_settings_validation(client, admin):
    bad_gap = [{"start": 0, "end": 12, "cost": 1}, {"start": 13, "end": 24, "cost": 2}]
    assert client.put("/admin/booking-settings", headers=admin, json={"price_bands": bad_gap}).status_code == 400
    bad_short = [{"start": 0, "end": 20, "cost": 1}]
    assert client.put("/admin/booking-settings", headers=admin, json={"price_bands": bad_short}).status_code == 400
    ok_bands = [{"start": 0, "end": 12, "cost": 0}, {"start": 12, "end": 24, "cost": 3}]
    assert client.put("/admin/booking-settings", headers=admin, json={"price_bands": ok_bands}).status_code == 200
    assert client.get("/admin/booking-settings", headers=admin).json()["price_bands"] == ok_bands
    # 원래 가격표로 복구
    default = [
        {"start": 0, "end": 4, "cost": 1}, {"start": 4, "end": 8, "cost": 0}, {"start": 8, "end": 12, "cost": 1},
        {"start": 12, "end": 16, "cost": 2}, {"start": 16, "end": 24, "cost": 4},
    ]
    assert client.put("/admin/booking-settings", headers=admin, json={"price_bands": default}).status_code == 200
    assert client.put("/admin/booking-settings", headers=admin, json={"refund_tiers": []}).status_code == 400
    assert client.put("/admin/booking-settings", headers=admin, json={"refund_tiers": [{"hours_before": 5, "percent": 120}]}).status_code == 400
    dup = [{"hours_before": 24, "percent": 50}, {"hours_before": 24, "percent": 25}]
    assert client.put("/admin/booking-settings", headers=admin, json={"refund_tiers": dup}).status_code == 400
    assert client.put("/admin/booking-settings", headers=admin, json={}).status_code == 400


def test_websocket_requires_login(client, make_user):
    """예약 현황(회원 이름 포함)을 로그인하지 않은 연결에 보내지 않는다."""
    from starlette.websockets import WebSocketDisconnect

    client.cookies.clear()  # 앞선 로그인으로 공유 클라이언트에 남은 세션 쿠키
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()

    _username, headers = make_user()
    token = headers["Authorization"].split()[1]
    with client.websocket_connect("/ws", cookies={"session": token}) as ws:
        assert ws.receive_json()["type"] == "RESERVATION_UPDATE"


def test_payment_guide_hidden_from_anonymous(client, admin, make_user):
    r = client.put("/admin/settings/payment-guide", json={"payment_guide": "은행 123-456"}, headers=admin)
    assert r.status_code == 200, r.text
    client.cookies.clear()
    assert client.get("/settings").json()["payment_guide"] is None
    _u, headers = make_user()
    assert client.get("/settings", headers=headers).json()["payment_guide"] == "은행 123-456"
    client.cookies.clear()


def test_security_headers(client):
    r = client.get("/settings")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"]


def test_register_rate_limit(client, monkeypatch):
    import main

    monkeypatch.setattr(main, "_REGISTER_MAX_PER_IP", 10)
    main._register_attempts.clear()
    codes = []
    for i in range(12):
        r = client.post("/register", json={"username": f"rl{i}", "password": "password1", "name": "제한", "phone": f"0102000{i:04d}"})
        codes.append(r.status_code)
    main._register_attempts.clear()
    assert codes[:10] == [200] * 10
    assert codes[10:] == [429, 429]


def test_account_wide_login_throttle(client):
    import main

    main._login_failures.clear()
    for i in range(40):
        main._record_login_failure(type("R", (), {"headers": {"x-forwarded-for": f"9.9.9.{i}"}, "client": None})(), "victim")
    r = client.post("/login", json={"username": "victim", "password": "x"}, headers={"x-forwarded-for": "1.2.3.4"})
    main._login_failures.clear()
    assert r.status_code == 429


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}
