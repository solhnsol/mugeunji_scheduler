"""공지·이용 안내: 공개 범위, 초안, 관리자 작성, 에이전트 API 키."""


def _agent(key):
    return {"Authorization": f"Bearer {key}"}


def test_admin_crud_and_visibility(client, admin, make_user):
    _, member = make_user()
    r = client.post("/admin/notices", headers=admin, json={
        "title": "회원 공지", "body": "**안녕**", "visibility": "members", "published": True,
    })
    assert r.status_code == 200, r.text
    members_id = r.json()["id"]
    pub = client.post("/admin/notices", headers=admin, json={
        "title": "공개 공지", "body": "누구나", "visibility": "public", "published": True, "pinned": True,
    }).json()
    draft = client.post("/admin/notices", headers=admin, json={"title": "초안", "body": "x"}).json()
    assert draft["published"] is False and draft["published_at"] is None

    client.cookies.clear()  # 로그인 쿠키가 남아 있으면 비로그인 방문자가 아니다
    anon = client.get("/api/notices").json()
    assert [n["title"] for n in anon] == ["공개 공지"]
    assert client.get(f"/api/notices/{members_id}").status_code == 404  # 회원 전용은 로그인 전에 안 보임
    assert client.get(f"/api/notices/{draft['id']}").status_code == 404

    titles = [n["title"] for n in client.get("/api/notices", headers=member).json()]
    assert titles[0] == "공개 공지" and "회원 공지" in titles and "초안" not in titles  # 고정글이 먼저
    assert client.get(f"/api/notices/{members_id}", headers=member).json()["body"] == "**안녕**"

    # 공개로 바꾸면 공개 시각이 생기고, 삭제하면 사라진다
    up = client.put(f"/admin/notices/{draft['id']}", headers=admin, json={"published": True, "visibility": "public"})
    assert up.status_code == 200 and up.json()["published_at"]
    assert client.delete(f"/admin/notices/{draft['id']}", headers=admin).status_code == 200
    assert client.get(f"/admin/notices/{draft['id']}", headers=admin).status_code == 404
    # 정리
    for n in (members_id, pub["id"]):
        client.delete(f"/admin/notices/{n}", headers=admin)


def test_validation_and_permissions(client, admin, make_user):
    _, member = make_user()
    assert client.post("/admin/notices", headers=member, json={"title": "x"}).status_code == 403
    assert client.post("/admin/notices", headers=admin, json={"title": "", "body": ""}).status_code == 422
    assert client.post("/admin/notices", headers=admin, json={"title": "t", "category": "bad"}).status_code == 422
    assert client.get("/admin/notices", headers=member).status_code == 403


def test_agent_api_key(client, admin):
    client.cookies.clear()
    assert client.get("/api/agent/notices").status_code == 401
    assert client.get("/api/agent/notices", headers=_agent("ntc_wrong")).status_code == 401
    assert client.get("/admin/notice-api-key", headers=admin).json()["has_key"] in (False, True)
    key = client.post("/admin/notice-api-key", headers=admin).json()["api_key"]
    assert key.startswith("ntc_") and client.get("/admin/notice-api-key", headers=admin).json()["has_key"] is True
    # 에이전트 키로는 공지만 다룰 수 있고, 다른 관리자 API는 못 쓴다
    assert client.get("/admin/users", headers=_agent(key)).status_code in (401, 403)
    created = client.post("/api/agent/notices", headers=_agent(key), json={"title": "에이전트 글", "body": "초안"})
    assert created.status_code == 200
    notice = created.json()
    assert notice["published"] is False and notice["created_by"] == "agent"
    assert "에이전트 글" not in [n["title"] for n in client.get("/api/notices").json()]
    pub = client.put(f"/api/agent/notices/{notice['id']}", headers=_agent(key), json={"published": True, "visibility": "public"})
    assert pub.status_code == 200 and pub.json()["published"] is True
    assert "에이전트 글" in [n["title"] for n in client.get("/api/notices").json()]
    # 키를 새로 만들면 이전 키는 즉시 못 쓴다
    new_key = client.post("/admin/notice-api-key", headers=admin).json()["api_key"]
    assert client.get("/api/agent/notices", headers=_agent(key)).status_code == 401
    assert client.get("/api/agent/notices", headers=_agent(new_key)).status_code == 200
    assert client.delete(f"/api/agent/notices/{notice['id']}", headers=_agent(new_key)).status_code == 200
    assert client.delete("/admin/notice-api-key", headers=admin).status_code == 200
    assert client.get("/api/agent/notices", headers=_agent(new_key)).status_code == 401
