import json

from sqlalchemy import select, text

from app.models import AppLog, AuditLog

API = "/api/v1"


def test_tc028_logs_contain_no_patient_pii(client, auth, make_patient, db):
    p = make_patient(first_name="Privatenameq", email="private.person@example.com", phone="+970 59 987 6543")
    r = client.get(f"{API}/patients", params={"q": "Privatenameq"}, headers=auth())
    rid = r.headers["X-Request-ID"]
    log = db.scalars(select(AppLog).where(AppLog.request_id == rid)).one()
    assert log.context["query"]["q"] == "[REDACTED]"
    dump = json.dumps([tuple(row) for row in db.execute(text("SELECT message, context::text FROM app_logs")).all()])
    dump += json.dumps([tuple(row) for row in db.execute(text("SELECT changes::text FROM audit_logs")).all()])
    for secret in ("Privatenameq", "private.person@example.com", "987 6543", p["last_name"]):
        assert secret not in dump


def test_request_log_fields(client, auth, db):
    r = client.post(f"{API}/patients", json={"first_name": ""}, headers=auth())
    log = db.scalars(select(AppLog).where(AppLog.request_id == r.headers["X-Request-ID"])).one()
    assert (log.level, log.method, log.status_code, log.user_role) == ("WARNING", "POST", 422, "pharmacist")
    assert "first_name" in log.context["invalid_fields"]
    assert log.duration_ms >= 0


def test_tc027_trace_by_request_id(client, auth):
    r = client.post(f"{API}/patients", json={"first_name": "Trace", "last_name": "Me", "date_of_birth": "1990-02-02"},
                    headers=auth())
    rid = r.headers["X-Request-ID"]
    trace = client.get(f"{API}/logs/requests/{rid}", headers=auth("support")).json()
    assert trace["found"] and trace["logs"][0]["status_code"] == 201
    assert trace["audit"][0]["action"] == "create" and trace["audit"][0]["changes"]["first_name"] == "[REDACTED]"


def test_logs_filters(client, auth):
    client.get(f"{API}/patients/999999", headers=auth())
    items = client.get(f"{API}/logs", params={"status_code": 404}, headers=auth("qa")).json()["items"]
    assert items and all(i["status_code"] == 404 for i in items)
    items = client.get(f"{API}/logs", params={"status_class": "4xx"}, headers=auth("qa")).json()["items"]
    assert all(400 <= i["status_code"] < 500 for i in items)


def test_login_failure_audited_without_password(client, db):
    client.post(f"{API}/auth/login", json={"email": "pharmacist@medicare.example.com", "password": "Sup3rSecret!"})
    entry = db.scalars(select(AuditLog).where(AuditLog.action == "login_failed").order_by(AuditLog.id.desc())).first()
    assert entry is not None and "Sup3rSecret" not in json.dumps(entry.changes)


def test_tc030_db_consistency_checks_pass(client, auth):
    checks = client.get(f"{API}/diagnostics/db-checks", headers=auth("qa")).json()
    failing = [c["key"] for c in checks if not c["passed"]]
    assert not failing, failing
