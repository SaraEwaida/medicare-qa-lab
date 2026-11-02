API = "/api/v1"

TICKET = {"subject": "Refill button spins forever", "description": "Spinner then error banner on refill submit.",
          "category": "refill", "priority": "high", "reporter_name": "Downtown Pharmacy", "browser": "Chrome 130",
          "os": "Windows 11", "app_version": "1.0.0", "related_request_id": "req_abc123def4567890",
          "diagnostic_notes": "HAR attached. Patient phone +970 59 123 4567 visible in screenshot."}


def create(client, auth, user="support", **kw):
    r = client.post(f"{API}/tickets", json={**TICKET, **kw}, headers=auth(user))
    assert r.status_code == 201, r.text
    return r.json()


def status(client, auth, tid, **body):
    return client.post(f"{API}/tickets/{tid}/status", json=body, headers=auth("support"))


def test_tc021_create_ticket_with_diagnostics(client, auth):
    t = create(client, auth)
    assert t["ticket_code"].startswith("SUP-") and t["status"] == "open"
    assert t["browser"] == "Chrome 130" and t["related_request_id"] == "req_abc123def4567890"
    assert [e["event_type"] for e in t["events"]] == ["created"]


def test_ticket_validation(client, auth):
    r = client.post(f"{API}/tickets", json={**TICKET, "subject": "Hi", "category": "nonsense"}, headers=auth("support"))
    assert r.status_code == 422
    assert {"subject", "category"} <= {d["field"] for d in r.json()["error"]["details"]}


def test_tc022_workflow_enforces_transitions(client, auth):
    t = create(client, auth)
    r = status(client, auth, t["id"], status="resolved")
    assert r.status_code == 409 and r.json()["error"]["code"] == "INVALID_TRANSITION"
    r = status(client, auth, t["id"], status="investigating")
    assert r.json()["status"] == "investigating" and r.json()["assignee"]["full_name"] == "Sam Support"  # auto-assign
    assert status(client, auth, t["id"], status="escalated").status_code == 422  # note required
    assert status(client, auth, t["id"], status="escalated", note="Needs engineering").json()["status"] == "escalated"
    assert status(client, auth, t["id"], status="resolved").status_code == 422  # resolution required
    r = status(client, auth, t["id"], status="resolved", resolution="Fixed by clearing cache")
    assert r.json()["resolved_at"] is not None
    r = status(client, auth, t["id"], status="closed")
    assert r.json()["status"] == "closed" and r.json()["closed_at"]
    assert status(client, auth, t["id"], status="investigating").status_code == 409  # closed is terminal
    types = [e["event_type"] for e in r.json()["events"]]
    assert types.count("status_changed") == 3 and "escalated" in types


def test_reopen_resolved_ticket(client, auth):
    t = create(client, auth)
    status(client, auth, t["id"], status="investigating")
    status(client, auth, t["id"], status="resolved", resolution="Done")
    r = status(client, auth, t["id"], status="investigating")
    assert r.json()["status"] == "investigating" and r.json()["resolved_at"] is None


def test_tc023_internal_notes_hidden_from_pharmacist(client, auth):
    t = create(client, auth, user="pharmacist")
    client.post(f"{API}/tickets/{t['id']}/notes", json={"body": "Internal: suspect cache bug"}, headers=auth("support"))
    client.post(f"{API}/tickets/{t['id']}/notes", json={"body": "We are looking into it.", "is_internal": False},
                headers=auth("support"))
    as_pharm = client.get(f"{API}/tickets/{t['id']}", headers=auth()).json()
    assert [n["body"] for n in as_pharm["notes"]] == ["We are looking into it."]
    assert as_pharm["diagnostic_notes"] is None
    as_support = client.get(f"{API}/tickets/{t['id']}", headers=auth("support")).json()
    assert len(as_support["notes"]) == 2 and as_support["diagnostic_notes"]


def test_pharmacist_only_sees_own_tickets(client, auth):
    other = create(client, auth, user="support")
    assert client.get(f"{API}/tickets/{other['id']}", headers=auth()).status_code == 404
    mine = create(client, auth, user="pharmacist")
    codes = [t["ticket_code"] for t in client.get(f"{API}/tickets", params={"page_size": 100}, headers=auth()).json()["items"]]
    assert mine["ticket_code"] in codes and other["ticket_code"] not in codes


def test_assign_validation(client, auth):
    t = create(client, auth)
    r = client.post(f"{API}/tickets/{t['id']}/assign", json={"assignee_id": 1}, headers=auth("support"))  # pharmacist
    assert r.status_code == 422
    r = client.post(f"{API}/tickets/{t['id']}/assign", json={"assignee_id": 4}, headers=auth("support"))
    assert r.json()["assignee"]["full_name"] == "Rami Haddad"


def test_tc024_convert_ticket_to_bug(client, auth):
    t = create(client, auth)
    r = client.post(f"{API}/tickets/{t['id']}/convert-to-bug", json={"severity": "major", "priority": "p2"},
                    headers=auth("support"))
    assert r.status_code == 201
    bug = r.json()
    assert bug["bug_code"].startswith("BUG-") and bug["source_ticket_code"] == t["ticket_code"]
    assert {"type": "log", "request_id": "req_abc123def4567890"} in bug["evidence"]
    assert "Chrome 130" in bug["environment"]
    detail = client.get(f"{API}/tickets/{t['id']}", headers=auth("support")).json()
    assert detail["linked_bugs"][0]["bug_code"] == bug["bug_code"]
    assert detail["events"][-1]["event_type"] == "converted_to_bug"


def test_filters(client, auth):
    r = client.get(f"{API}/tickets", params=[("status", "open"), ("status", "escalated")], headers=auth("support"))
    assert all(t["status"] in ("open", "escalated") for t in r.json()["items"])
