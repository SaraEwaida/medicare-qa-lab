from datetime import date, timedelta

from sqlalchemy import select

from app.models import AuditLog, Patient

API = "/api/v1"


def test_tc007_create_patient(client, auth, make_patient):
    p = make_patient()
    assert p["patient_code"].startswith("P-") and p["status"] == "active"


def test_tc008_future_dob_rejected_today_accepted(client, auth, make_patient):
    tomorrow = str(date.today() + timedelta(days=1))
    r = client.post(f"{API}/patients", headers=auth(),
                    json={"first_name": "Future", "last_name": "Kid", "date_of_birth": tomorrow})
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "date_of_birth"
    assert make_patient(date_of_birth=str(date.today()))["date_of_birth"] == str(date.today())


def test_tc009_duplicate_patient_case_insensitive(client, auth, db):
    before = db.query(Patient).count()
    r = client.post(f"{API}/patients", headers=auth(),
                    json={"first_name": "john", "last_name": "TURNER", "date_of_birth": "1985-06-14"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "PATIENT_DUPLICATE" and "P-1001" in r.json()["error"]["message"]
    assert db.query(Patient).count() == before


def test_tc010_search_is_case_insensitive(client, auth, make_patient):
    p = make_patient(first_name="Zephyrina")
    for q in ("zephyrina", "ZEPHYRINA", "Zephy"):
        items = client.get(f"{API}/patients", params={"q": q}, headers=auth()).json()["items"]
        assert any(i["id"] == p["id"] for i in items), q


def test_search_by_full_name_and_code(client, auth, make_patient):
    p = make_patient()
    for q in (f"{p['first_name']} {p['last_name']}", p["patient_code"]):
        items = client.get(f"{API}/patients", params={"q": q}, headers=auth()).json()["items"]
        assert [i["id"] for i in items] == [p["id"]]


def test_tc011_edit_writes_redacted_audit(client, auth, make_patient, db):
    p = make_patient(phone="+970 59 111 2222")
    r = client.patch(f"{API}/patients/{p['id']}", headers=auth(),
                     json={"phone": "+970 59 333 4444", "updated_at": p["updated_at"]})
    assert r.status_code == 200 and r.json()["phone"] == "+970 59 333 4444"
    entry = db.scalars(select(AuditLog).where(AuditLog.entity_type == "patient", AuditLog.entity_id == str(p["id"]),
                                              AuditLog.action == "update")).first()
    assert entry.changes == {"phone": {"from": "[REDACTED]", "to": "[REDACTED]"}}


def test_tc012_stale_write_conflict(client, auth, make_patient):
    p = make_patient()
    first = client.patch(f"{API}/patients/{p['id']}", headers=auth(),
                         json={"address": "Tab A", "updated_at": p["updated_at"]})
    assert first.status_code == 200
    second = client.patch(f"{API}/patients/{p['id']}", headers=auth(),
                          json={"address": "Tab B", "updated_at": p["updated_at"]})
    assert second.status_code == 409 and second.json()["error"]["code"] == "STALE_WRITE"
    assert client.get(f"{API}/patients/{p['id']}", headers=auth()).json()["address"] == "Tab A"


def test_deactivate_blocked_with_active_prescription(client, auth, make_rx):
    rx = make_rx()
    r = client.post(f"{API}/patients/{rx['patient']['id']}/deactivate", headers=auth())
    assert r.status_code == 409 and r.json()["error"]["code"] == "PATIENT_HAS_ACTIVE_RX"


def test_deactivate_and_reactivate(client, auth, make_patient):
    p = make_patient()
    assert client.post(f"{API}/patients/{p['id']}/deactivate", headers=auth()).json()["status"] == "inactive"
    assert client.post(f"{API}/patients/{p['id']}/deactivate", headers=auth()).status_code == 409
    assert client.post(f"{API}/patients/{p['id']}/reactivate", headers=auth()).json()["status"] == "active"


def test_invalid_sort_and_pagination_bounds(client, auth):
    assert client.get(f"{API}/patients", params={"sort": "password"}, headers=auth()).status_code == 422
    assert client.get(f"{API}/patients", params={"page_size": 101}, headers=auth()).status_code == 422
    r = client.get(f"{API}/patients", params={"page_size": 5, "page": 2}, headers=auth()).json()
    assert len(r["items"]) == 5 and r["page"] == 2 and r["total"] >= 240


def test_validation_envelope_lists_fields(client, auth):
    r = client.post(f"{API}/patients", headers=auth(),
                    json={"first_name": "", "last_name": "X", "date_of_birth": "1990-01-01", "email": "not-an-email",
                          "phone": "abc"})
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"first_name", "email", "phone"} <= fields
    assert r.json()["error"]["request_id"] == r.headers["X-Request-ID"]


def test_sandbox_patients_hidden_from_normal_api(client, auth, db):
    sandbox = db.scalars(select(Patient).where(Patient.is_sandbox)).first()
    assert client.get(f"{API}/patients/{sandbox.id}", headers=auth()).status_code == 404
    items = client.get(f"{API}/patients", params={"q": "Nora Haddad"}, headers=auth()).json()["items"]
    assert all(i["id"] != sandbox.id for i in items)
