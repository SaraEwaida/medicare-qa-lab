"""Bug Lab: each defect reproduces in the sandbox, and never leaks into normal application paths."""

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.demo.bugs import KEYS
from app.models import Prescription, RefillRequest

API = "/api/v1"
DEMO = {"X-Demo-Session": "pytest"}


@pytest.fixture
def bugs(client, auth):
    def set_all(enabled: bool):
        for key in KEYS:
            assert client.post(f"{API}/demo/bugs/{key}/toggle", params={"enabled": enabled}, headers=auth("qa")).status_code == 200
    client.post(f"{API}/demo/sandbox/reset", headers=auth("qa"))
    set_all(True)
    yield
    set_all(False)
    client.post(f"{API}/demo/sandbox/reset", headers=auth("qa"))


def sandbox_rx(client, auth, med: str) -> dict:
    return next(r for r in client.get(f"{API}/demo/sandbox/prescriptions", headers=auth("qa")).json()
                if r["medication"].startswith(med))


def test_bug_reproduces_refill_status_stale(client, auth, bugs):
    rx = sandbox_rx(client, auth, "Lisinopril")
    refill = client.post(f"{API}/demo/sandbox/refills", params={"prescription_id": rx["id"]}, headers=auth("qa", **DEMO)).json()
    r = client.post(f"{API}/demo/sandbox/refills/{refill['id']}/approve", headers=auth("qa", **DEMO))
    assert r.status_code == 200 and r.json()["status"] == "pending"  # stale response
    actual = client.get(f"{API}/demo/sandbox/refills/{refill['id']}", headers=auth("qa", **DEMO)).json()
    assert actual["status"] == "approved"  # database is correct


def test_bug_reproduces_boundary_422(client, auth, bugs):
    rx = sandbox_rx(client, auth, "Metformin")
    assert rx["refills_remaining"] == 1
    r = client.post(f"{API}/demo/sandbox/refills", params={"prescription_id": rx["id"]}, headers=auth("qa", **DEMO))
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_REFILLS_REMAINING"


def test_bug_reproduces_case_sensitive_search(client, auth, bugs):
    url = f"{API}/demo/sandbox/patients"
    assert len(client.get(url, params={"q": "Nora"}, headers=auth("qa", **DEMO)).json()) == 1
    assert client.get(url, params={"q": "nora"}, headers=auth("qa", **DEMO)).json() == []


def test_bug_reproduces_double_submit(client, auth, bugs, db):
    rx = sandbox_rx(client, auth, "Atorvastatin")
    h = auth("qa", **DEMO, **{"Idempotency-Key": "same-key"})
    a = client.post(f"{API}/demo/sandbox/refills", params={"prescription_id": rx["id"]}, headers=h)
    b = client.post(f"{API}/demo/sandbox/refills", params={"prescription_id": rx["id"]}, headers=h)
    assert a.status_code == b.status_code == 201 and a.json()["id"] != b.json()["id"]
    assert db.scalar(select(func.count()).select_from(RefillRequest).where(
        RefillRequest.prescription_id == rx["id"], RefillRequest.status == "pending")) == 2


def test_tc029_enabled_bugs_do_not_affect_normal_paths(client, auth, bugs, make_rx, make_patient):
    # Even with the demo header, real (non-sandbox) data follows correct behavior.
    for headers in (auth(), auth(**DEMO)):
        rx = make_rx(refills=1)
        refill = client.post(f"{API}/refill-requests", json={"prescription_id": rx["id"]}, headers=headers)
        assert refill.status_code == 201  # boundary bug inactive
        assert client.post(f"{API}/refill-requests", json={"prescription_id": rx["id"]},
                           headers=headers).status_code == 409  # double-submit bug inactive
        approved = client.post(f"{API}/refill-requests/{refill.json()['id']}/approve", headers=headers).json()
        assert approved["status"] == "approved"  # stale bug inactive
        p = make_patient(first_name="Casecheckname")
        found = client.get(f"{API}/patients", params={"q": "casecheckname"}, headers=headers).json()["items"]
        assert any(i["id"] == p["id"] for i in found)  # search bug inactive


def test_bugs_off_sandbox_behaves_correctly(client, auth):
    client.post(f"{API}/demo/sandbox/reset", headers=auth("qa"))
    for key in KEYS:
        client.post(f"{API}/demo/bugs/{key}/toggle", params={"enabled": False}, headers=auth("qa"))
    assert len(client.get(f"{API}/demo/sandbox/patients", params={"q": "nora"}, headers=auth("qa", **DEMO)).json()) == 1
    rx = sandbox_rx(client, auth, "Metformin")
    r = client.post(f"{API}/demo/sandbox/refills", params={"prescription_id": rx["id"]}, headers=auth("qa", **DEMO))
    assert r.status_code == 201
    assert client.post(f"{API}/demo/sandbox/refills/{r.json()['id']}/approve",
                       headers=auth("qa", **DEMO)).json()["status"] == "approved"


def test_sandbox_rows_unreachable_without_demo_header(client, auth, db):
    rx = db.scalars(select(Prescription).where(Prescription.is_sandbox)).first()
    r = client.post(f"{API}/refill-requests", json={"prescription_id": rx.id}, headers=auth())
    assert r.status_code == 404


def test_master_switch_blocks_bugs(client, auth, bugs, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_bugs_enabled", False)
    url = f"{API}/demo/sandbox/patients"
    assert len(client.get(url, params={"q": "nora"}, headers=auth("qa", **DEMO)).json()) == 1
    assert client.post(f"{API}/demo/bugs/search_case_sensitive/toggle", params={"enabled": True},
                       headers=auth("qa")).status_code == 409
