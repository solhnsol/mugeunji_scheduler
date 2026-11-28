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


def test_deposit_notify_korean_roundtrip(client, admin, monkeypatch):
    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    body = '{"title":"20원 입금","body":"테스트"}'
    r = client.post("/api/deposit-notify", content=body.encode("utf-8"), headers={"X-Deposit-Token": "s3cret", "Content-Type": "application/json"})
    assert r.status_code == 200
    row = client.get("/admin/deposit-notifications", headers=admin).json()[0]
    assert row["raw_body"] == body and row["raw_hex"] == body.encode("utf-8").hex()


def _notice(client, amount, who):
    import json
    body = json.dumps({"title": f"{amount:,}원 입금", "body": f"{who} → 내 묵은지 작업실 모임통장"}, ensure_ascii=False)
    r = client.post("/api/deposit-notify", content=body.encode(), headers={"X-Deposit-Token": "s3cret", "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()["result"]


def test_auto_confirm(client, admin, make_user, monkeypatch):
    from tests.test_tokens import _add_pack, _enable
    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    _enable(client, admin)
    pack = _add_pack(client, admin, "입금테스트", 12345, 7)
    _, member = make_user("정자동")
    client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    pid = client.get("/tokens/me", headers=member).json()["purchases"][0]["id"]

    assert _notice(client, 12345, "다른사람") == "no_match"
    assert _notice(client, 99999, "정자동") == "no_match"
    assert _notice(client, 12345, "정자동") == f"confirmed:{pid}"
    assert client.get("/tokens/me", headers=member).json()["balance"] == 7
    assert _notice(client, 12345, "정자동") == "no_match"  # 이미 확인됨, 중복 지급 없음
    assert client.post("/api/deposit-notify", content="그냥 글", headers={"X-Deposit-Token": "s3cret"}).json()["result"] == "unparsed"


def test_ambiguous_shows_notice_to_admin(client, admin, make_user, monkeypatch):
    from tests.test_tokens import _add_pack, _enable
    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    _enable(client, admin)
    pack = _add_pack(client, admin, "대조테스트", 23456, 5)
    _, member = make_user("김동명")
    client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    pid = client.get("/tokens/me", headers=member).json()["purchases"][0]["id"]

    assert _notice(client, 23456, "가족이름") == "no_match"  # 이름이 달라 자동 처리 안 됨
    pending = client.get("/admin/token-purchases", headers=admin, params={"status_filter": "pending"}).json()
    mine = next(p for p in pending if p["id"] == pid)
    assert [d["depositor"] for d in mine["deposits"]] == ["가족이름"]

    assert client.post(f"/admin/token-purchases/{pid}/confirm", headers=admin).status_code == 200
    assert _notice(client, 23456, "가족이름") == "no_match"
    # 수동 확인 때 알림 하나가 처리됨으로 표시돼, 남은 건 새로 온 알림 1건뿐
    assert client.get("/admin/deposit-notifications", headers=admin).json()[1]["result"] == f"no_match>manual:{pid}"  # 원래 자동 처리 결과는 남긴다


def test_same_name_gets_distinct_deposit_name(client, admin, make_user, monkeypatch):
    from tests.test_tokens import _add_pack, _enable
    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    _enable(client, admin)
    pack = _add_pack(client, admin, "동명테스트", 34567, 9)
    _, first = make_user("박동명")
    _, second = make_user("박동명")
    r1 = client.post("/tokens/purchases", headers=first, json={"pack_id": pack["id"]})
    assert "'" not in r1.json()["message"]  # 먼저 요청한 회원은 이름 그대로
    r2 = client.post("/tokens/purchases", headers=second, json={"pack_id": pack["id"]})
    dn = client.get("/tokens/me", headers=second).json()["purchases"][0]["deposit_name"]
    assert dn.startswith("박동명") and dn != "박동명" and dn in r2.json()["message"]
    assert client.get("/tokens/me", headers=first).json()["purchases"][0]["deposit_name"] is None

    assert _notice(client, 34567, dn).startswith("confirmed:")      # 두 번째 회원만 확인됨
    assert client.get("/tokens/me", headers=second).json()["balance"] == 9
    assert client.get("/tokens/me", headers=first).json()["balance"] == 0
    assert _notice(client, 34567, "박동명").startswith("confirmed:")  # 이름 그대로 입금하면 첫 번째 회원


def test_same_name_different_amount_needs_no_deposit_name(client, admin, make_user):
    from tests.test_tokens import _add_pack, _enable
    _enable(client, admin)
    a, b = _add_pack(client, admin, "금액A", 45671, 1), _add_pack(client, admin, "금액B", 45672, 1)
    _, first = make_user("이동명")
    _, second = make_user("이동명")
    client.post("/tokens/purchases", headers=first, json={"pack_id": a["id"]})
    client.post("/tokens/purchases", headers=second, json={"pack_id": b["id"]})
    assert client.get("/tokens/me", headers=second).json()["purchases"][0]["deposit_name"] is None


def test_same_member_repeat_requests_and_name_forms(client, admin, make_user, monkeypatch):
    import unicodedata
    from tests.test_tokens import _add_pack, _enable
    monkeypatch.setenv("DEPOSIT_WEBHOOK_TOKEN", "s3cret")
    _enable(client, admin)
    pack = _add_pack(client, admin, "반복테스트", 56789, 3)
    _, member = make_user("최반복")
    for _i in range(2):  # 같은 회원이 같은 상품을 두 번 요청
        client.post("/tokens/purchases", headers=member, json={"pack_id": pack["id"]})
    first_id = min(p["id"] for p in client.get("/tokens/me", headers=member).json()["purchases"])
    # 한글 자모 분리(NFD) + 앞뒤 공백으로 와도 같은 이름으로 본다
    assert _notice(client, 56789, " \u200b" + unicodedata.normalize("NFD", "최반복")) == f"confirmed:{first_id}"
    assert client.get("/tokens/me", headers=member).json()["balance"] == 3


def test_parse_real_toss_notification():
    from src.tokens import parse_deposit
    body = bytes.fromhex(
        "7b227469746c65223a2233322c303030ec9b9020ec9e85eab888222c22626f6479223a22eca095ed959cec869420e2869220eb82b420ebacb5ec9d80eca78020ec9e91ec9785ec8ba420ebaaa8ec9e84ed86b5ec9ea5227d"
    ).decode("utf-8")
    assert parse_deposit(body) == (32000, "정한솔")  # 실제 수신 알림 (쉼표 금액 포함)
