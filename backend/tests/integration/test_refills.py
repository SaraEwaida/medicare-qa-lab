from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.models import RefillRequest

API = "/api/v1"


def submit(client, auth, rx_id, **headers):
    return client.post(f"{API}/refill-requests", json={"prescription_id": rx_id}, headers=auth(**headers))


def test_tc017_approve_updates_status_and_decrements(client, auth, make_rx):
    rx = make_rx(refills=2)
    refill = submit(client, auth, rx["id"]).json()
    assert refill["status"] == "pending" and refill["refills_remaining"] == 2
    r = client.post(f"{API}/refill-requests/{refill['id']}/approve", headers=auth())
    assert r.status_code == 200
    assert r.json()["status"] == "approved" and r.json()["refills_remaining"] == 1
    assert r.json()["reviewed_by"] == "Maya Pharmacist"
    assert client.get(f"{API}/prescriptions/{rx['id']}", headers=auth()).json()["refills_remaining"] == 1


def test_tc018_duplicate_pending_refill_rejected(client, auth, make_rx, db):
    rx = make_rx()
    assert submit(client, auth, rx["id"]).status_code == 201
    r = submit(client, auth, rx["id"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "REFILL_DUPLICATE"
    assert db.scalar(select(func.count()).select_from(RefillRequest).where(
        RefillRequest.prescription_id == rx["id"], RefillRequest.status == "pending")) == 1


def test_tc018_idempotency_key_replays_original(client, auth, make_rx):
    rx = make_rx()
    a = submit(client, auth, rx["id"], **{"Idempotency-Key": "key-" + rx["rx_code"]})
    b = submit(client, auth, rx["id"], **{"Idempotency-Key": "key-" + rx["rx_code"]})
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] == b.json()["id"] and b.headers.get("Idempotent-Replay") == "true"


def test_concurrent_double_submit_creates_one_row(client, auth, make_rx, db):
    rx = make_rx()
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = sorted(f.result().status_code for f in [pool.submit(submit, client, auth, rx["id"]) for _ in range(2)])
    assert codes == [201, 409]
    assert db.scalar(select(func.count()).select_from(RefillRequest).where(
        RefillRequest.prescription_id == rx["id"])) == 1


def test_tc019_boundary_one_remaining_ok_zero_rejected(client, auth, make_rx):
    one = make_rx(refills=1)
    r = submit(client, auth, one["id"])
    assert r.status_code == 201
    client.post(f"{API}/refill-requests/{r.json()['id']}/approve", headers=auth())
    r = submit(client, auth, one["id"])  # now 0 remaining
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_REFILLS_REMAINING"
    zero = make_rx(refills=0)
    assert submit(client, auth, zero["id"]).status_code == 422


def test_tc020_reject_requires_reason(client, auth, make_rx):
    rx = make_rx()
    refill = submit(client, auth, rx["id"]).json()
    url = f"{API}/refill-requests/{refill['id']}/reject"
    assert client.post(url, json={"reason": ""}, headers=auth()).status_code == 422
    r = client.post(url, json={"reason": "Prescriber requested hold"}, headers=auth())
    assert r.json()["status"] == "rejected" and r.json()["rejection_reason"] == "Prescriber requested hold"


def test_invalid_refill_transitions(client, auth, make_rx):
    rx = make_rx()
    refill = submit(client, auth, rx["id"]).json()
    base = f"{API}/refill-requests/{refill['id']}"
    assert client.post(f"{base}/dispense", headers=auth()).status_code == 409  # pending -> dispensed
    client.post(f"{base}/approve", headers=auth())
    assert client.post(f"{base}/approve", headers=auth()).json()["error"]["code"] == "INVALID_TRANSITION"
    assert client.post(f"{base}/dispense", headers=auth()).json()["status"] == "dispensed"


def test_on_hold_prescription_rejects_refill(client, auth, make_rx):
    rx = make_rx()
    client.post(f"{API}/prescriptions/{rx['id']}/status", json={"status": "on_hold"}, headers=auth())
    r = submit(client, auth, rx["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "PRESCRIPTION_NOT_ACTIVE"


def test_refill_queue_filter(client, auth):
    items = client.get(f"{API}/refill-requests", params={"status": "pending", "page_size": 50}, headers=auth()).json()["items"]
    assert items and all(i["status"] == "pending" for i in items)
