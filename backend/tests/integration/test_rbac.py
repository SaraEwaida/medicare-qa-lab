import pytest
from sqlalchemy import select

from app.models import AuditLog

API = "/api/v1"


def test_tc005_support_cannot_approve_refill(client, auth, make_rx, db):
    rx = make_rx(refills=2)
    refill = client.post(f"{API}/refill-requests", json={"prescription_id": rx["id"]}, headers=auth()).json()
    r = client.post(f"{API}/refill-requests/{refill['id']}/approve", headers=auth("support"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert client.get(f"{API}/prescriptions/{rx['id']}", headers=auth()).json()["refills"][0]["status"] == "pending"
    denied = db.scalars(select(AuditLog).where(AuditLog.action == "permission_denied",
                                               AuditLog.request_id == r.headers["X-Request-ID"])).first()
    assert denied is not None and denied.entity_id == "refills:review"


@pytest.mark.parametrize("user,method,path,body", [
    ("support", "post", "/patients", {"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01"}),
    ("qa", "post", "/prescriptions", {}),
    ("pharmacist", "get", "/logs", None),
    ("pharmacist", "get", "/qa/test-cases", None),
    ("pharmacist", "post", "/demo/sandbox/reset", None),
    ("support", "post", "/demo/sandbox/reset", None),
    ("support", "post", "/qa/test-cases", {}),
    ("qa", "post", "/tickets/1/status", {"status": "investigating"}),
])
def test_role_restrictions_return_403(client, auth, user, method, path, body):
    r = getattr(client, method)(f"{API}{path}", headers=auth(user), **({"json": body} if body is not None else {}))
    assert r.status_code == 403, r.text


def test_tc013_non_pharmacist_sees_masked_patient(client, auth, make_patient):
    p = make_patient(email="layla.masked@example.com", phone="+970 59 123 4567", address="1 Main St")
    for user in ("support", "qa"):
        out = client.get(f"{API}/patients/{p['id']}", headers=auth(user)).json()
        assert out["email"] == "l***@example.com" and out["phone"] == "***-***-4567"
        assert out["address"] is None and out["date_of_birth"] is None and out["contact_masked"] is True
    full = client.get(f"{API}/patients/{p['id']}", headers=auth()).json()
    assert full["email"] == "layla.masked@example.com" and full["contact_masked"] is False


def test_pharmacist_global_search_cannot_see_bugs(client, auth):
    r = client.get(f"{API}/search", params={"q": "refill"}, headers=auth())
    assert all(item["type"] != "bug" for item in r.json()["results"])
