"""입금 알림 수신: 토큰 확인, 원문 그대로 저장."""
import os


def test_deposit_notify(client, admin, monkeypatch):
    body = "토스뱅크 입금 10,000원 홍길동"
    monkeypatch.delenv("DEPOSIT_WEBHOOK_TOKEN", raising=False)
    assert client.post("/api/deposit-notify", content=body).status_code == 503  # 설정 전에는 꺼짐

    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    assert client.post("/api/deposit-notify", content=body).status_code == 401
    assert client.post("/api/deposit-notify", content=body, headers={"X-Deposit-Token": "bad"}).status_code == 401

    r = client.post("/api/deposit-notify", content=body.encode(), headers={"X-Deposit-Token": "s3cret", "Content-Type": "text/plain"})
    assert r.status_code == 200, r.text
    rows = client.get("/admin/deposit-notifications", headers=admin).json()
    assert rows[0]["raw_body"] == body and rows[0]["id"] == r.json()["id"]
