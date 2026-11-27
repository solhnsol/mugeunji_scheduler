def _reg(client, n, answer=None):
    body = {"username": f"quiz{n}", "password": "password1", "name": "퀴즈", "phone": f"0109876{n:04d}"}
    if answer is not None:
        body["quiz_answer"] = answer
    return client.post("/register", json=body)


def test_signup_quiz(client, admin):
    import main

    main._register_attempts.clear()  # 같은 IP 가입 제한을 비운다
    assert client.get("/signup-quiz").json() == {"question": ""}
    assert _reg(client, 1).status_code == 200  # 퀴즈가 꺼져 있으면 그대로 가입

    r = client.put("/admin/signup-quiz", json={"question": "총무 이름은?", "answer": "함승후"}, headers=admin)
    assert r.status_code == 200
    assert client.get("/signup-quiz").json() == {"question": "총무 이름은?"}  # 정답은 내려가지 않는다

    assert _reg(client, 2, "김철수").status_code == 400
    assert _reg(client, 2).status_code == 400
    assert _reg(client, 2, " 함 승후 ").status_code == 200

    assert client.put("/admin/signup-quiz", json={"question": "혼자", "answer": ""}, headers=admin).status_code == 400
    client.put("/admin/signup-quiz", json={"question": "", "answer": ""}, headers=admin)
    assert _reg(client, 3).status_code == 200
