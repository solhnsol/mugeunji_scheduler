"""오류 신고 저장·권한·제한, 월별 이용 통계."""
from datetime import timedelta

from src.automation_config import now_kst


def test_report_flow(client, admin, make_user):
    _, member = make_user()
    body = {"category": "charge", "message": "입금했어요", "page": "/tokens", "context": {"ua": "x", "logs": [{"m": "boom"}]}}
    client.cookies.clear()  # 로그인 쿠키가 남아 있으면 비로그인이 아니다
    assert client.post("/error-reports", json=body).status_code in (401, 403)
    assert client.post("/error-reports", headers=member, json={**body, "category": "nope"}).status_code == 400
    assert client.post("/error-reports", headers=member, json={**body, "message": "  "}).status_code == 400
    assert client.post("/error-reports", headers=member, json=body).status_code == 200

    assert client.get("/admin/error-reports", headers=member).status_code == 403
    data = client.get("/admin/error-reports", headers=admin).json()
    item = next(i for i in data["items"] if i["message"] == "입금했어요")
    assert item["urgent"] is True and item["context"]["logs"][0]["m"] == "boom" and data["open_count"] >= 1

    assert client.post(f"/admin/error-reports/{item['id']}/status?done=true", headers=admin).status_code == 200
    assert all(i["id"] != item["id"] for i in client.get("/admin/error-reports", headers=admin).json()["items"])
    assert client.post("/admin/error-reports/99999/status?done=true", headers=admin).status_code == 404


def test_report_rate_limit(client, make_user):
    _, member = make_user()
    body = {"category": "bug", "message": "이상해요"}
    codes = [client.post("/error-reports", headers=member, json=body).status_code for _ in range(6)]
    assert codes == [200] * 5 + [400]


def test_booking_stats(client, admin, make_user):
    username, member = make_user()
    client.post("/admin/tokens/grant", headers=admin, json={"usernames": [username], "tokens": 50, "memo": "t"})
    day = (now_kst() + timedelta(days=2)).date()
    slots = [{"date": day.isoformat(), "hour": h} for h in (10, 11)]
    client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "token"})
    try:
        r = client.post("/bookings", headers=member, json={"slots": slots})
        assert r.status_code == 200, r.text
    finally:
        client.put("/admin/booking-settings", headers=admin, json={"reservation_mode": "legacy"})
    stats = client.get(f"/admin/booking-stats?month={day.strftime('%Y-%m')}", headers=admin).json()
    assert stats["booked_hours"] >= 2 and stats["by_hour"][10] >= 1 and stats["tokens_used"] >= 2
    assert stats["capacity_hours"] % 24 == 0 and day.strftime("%Y-%m") in stats["months"]
    assert client.get("/admin/booking-stats?month=bad", headers=admin).status_code == 400
    assert client.get("/admin/booking-stats", headers=member).status_code == 403
