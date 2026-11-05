"""작업실 맥미니용 사용 구간 API."""
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 12, 26, 12, 30, tzinfo=KST)


def _ts(day, hour):
    return int(datetime(2026, 12, day, hour, tzinfo=KST).timestamp())


def test_device_schedule(client, admin, make_user, monkeypatch):
    monkeypatch.setattr("src.booking.now_kst", lambda: NOW)
    monkeypatch.setattr("main.now_kst", lambda: NOW)
    monkeypatch.setenv("DEVICE_API_KEY", "dev-key")
    url, key = "/api/device/schedule", {"Authorization": "Bearer dev-key"}

    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get(url, headers=admin).status_code == 401  # 로그인 토큰으로는 못 쓴다

    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"})
    try:
        u1, m1 = make_user()
        u2, m2 = make_user()
        for u in (u1, u2):
            client.post("/admin/tokens/adjust", headers=admin, json={"username": u, "tokens": 50, "memo": "테스트"})
        assert client.post("/bookings", headers=m1, json={"slots": [{"date": "2026-12-27", "hour": h} for h in (10, 11)]}).status_code == 200
        assert client.post("/bookings", headers=m2, json={"slots": [{"date": "2026-12-27", "hour": 12}]}).status_code == 200
        assert client.post("/bookings", headers=m2, json={"slots": [{"date": "2026-12-30", "hour": 12}]}).status_code == 200

        r = client.get(url, headers=key)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
        # 같은 사람이 이어 쓰면 한 구간, 다른 사람이 바로 이어 쓰면 따로(앞사람 화면이 넘어가지 않게). 48시간 밖은 뺀다
        assert f"{_ts(27, 10)} {_ts(27, 12)}\n{_ts(27, 12)} {_ts(27, 13)}\n" in r.text  # DB는 다른 테스트와 공유
        assert str(_ts(30, 12)) not in r.text
        assert u1 not in r.text and u2 not in r.text
    finally:
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})


def test_device_schedule_off_without_key(client, monkeypatch):
    monkeypatch.delenv("DEVICE_API_KEY", raising=False)
    assert client.get("/api/device/schedule", headers={"Authorization": "Bearer "}).status_code == 401
