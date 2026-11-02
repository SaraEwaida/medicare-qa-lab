"""Integration tests run against a real PostgreSQL test database (never the dev database).

TEST_DATABASE_URL defaults to postgresql+psycopg://medicare:medicare@localhost:5432/medicare_test.
The schema is migrated with Alembic and seeded once per session; tests create their own records where they mutate.
"""

import os
import uuid
from datetime import date

import pytest

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import login_limiter  # noqa: E402
from app.db import seed  # noqa: E402
from app.db.seed_data import DEMO_PASSWORD  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

API = "/api/v1"


@pytest.fixture(scope="session", autouse=True)
def database():
    assert "test" in os.environ["DATABASE_URL"], "Refusing to run tests against a non-test database."
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))
    command.upgrade(cfg, "head")
    seed.run(reset=True)
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    login_limiter.reset()
    yield


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


def _token(client: TestClient, user: str) -> str:
    r = client.post(f"{API}/auth/login", json={"email": f"{user}@medicare.example.com", "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def tokens(client):
    login_limiter.reset()
    return {u: _token(client, u) for u in ("pharmacist", "support", "qa")}


@pytest.fixture
def auth(tokens):
    def headers(user: str = "pharmacist", **extra) -> dict:
        return {"Authorization": f"Bearer {tokens[user]}", **extra}
    return headers


def unique_name() -> str:
    return "T" + uuid.uuid4().hex[:8]


@pytest.fixture
def make_patient(client, auth):
    def _make(**overrides) -> dict:
        body = {"first_name": unique_name(), "last_name": unique_name(), "date_of_birth": "1980-05-05",
                "phone": "+970 59 555 0101", "email": "test.patient@example.com", **overrides}
        r = client.post(f"{API}/patients", json=body, headers=auth())
        assert r.status_code == 201, r.text
        return r.json()
    return _make


@pytest.fixture
def make_rx(client, auth, make_patient):
    def _make(refills: int = 3, medication_id: int = 1, patient_id: int | None = None, quantity: int = 30) -> dict:
        pid = patient_id or make_patient()["id"]
        r = client.post(f"{API}/prescriptions", headers=auth(), json={
            "patient_id": pid, "medication_id": medication_id, "prescriber_name": "Dr. Test Fictional",
            "dosage_instructions": "1 tablet daily", "quantity": quantity, "refills_authorized": refills,
            "start_date": str(date.today())})
        assert r.status_code == 201, r.text
        return r.json()
    return _make
