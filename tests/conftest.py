import os
import sys
import tempfile

import pytest

# main.py가 import 시점에 환경 변수를 읽으므로, import 전에 테스트용 값을 넣는다.
_tmp = tempfile.mkdtemp()
os.environ["DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ["ADMIN_PASSWORD"] = "admin-pass-1"
os.environ["SECRET_KEY"] = "t" * 40
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(main.app) as c:
        yield c


def _login(client, username, password):
    r = client.post("/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    r = client.post("/admin/login", json={"username": "admin", "password": "admin-pass-1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def make_user(client):
    counter = {"n": 0}

    def _make(name="홍길동"):
        counter["n"] += 1
        username = f"user{counter['n']}"
        phone = f"0101000{counter['n']:04d}"
        r = client.post("/register", json={"username": username, "password": "password1", "name": name, "phone": phone})
        assert r.status_code == 200, r.text
        return username, _login(client, username, "password1")

    return _make
