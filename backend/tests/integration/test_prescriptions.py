from datetime import date, timedelta

import pytest

API = "/api/v1"


def rx_body(patient_id, **kw):
    return {"patient_id": patient_id, "medication_id": 8, "prescriber_name": "Dr. Test", "dosage_instructions": "daily",
            "quantity": 30, "refills_authorized": 3, "start_date": str(date.today()), **kw}


def test_tc014_create_prescription_sets_remaining(make_rx):
    rx = make_rx(refills=3)
    assert rx["rx_code"].startswith("RX-") and rx["status"] == "active"
    assert rx["refills_remaining"] == rx["refills_authorized"] == 3


@pytest.mark.parametrize("qty,status", [(0, 422), (1, 201), (1000, 201), (1001, 422)])
def test_tc015_quantity_boundaries(client, auth, make_patient, qty, status):
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(make_patient()["id"], quantity=qty))
    assert r.status_code == status, r.text
    if status == 422:
        assert r.json()["error"]["details"][0]["field"] == "quantity"


@pytest.mark.parametrize("refills,status", [(-1, 422), (0, 201), (12, 201), (13, 422)])
def test_refill_count_boundaries(client, auth, make_patient, refills, status):
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(make_patient()["id"], refills_authorized=refills))
    assert r.status_code == status


def test_tc016_duplicate_active_prescription(client, auth, make_rx):
    rx = make_rx(medication_id=1)
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(rx["patient"]["id"], medication_id=1))
    assert r.status_code == 409 and r.json()["error"]["code"] == "PRESCRIPTION_DUPLICATE"
    assert rx["rx_code"] in r.json()["error"]["message"]


def test_end_date_before_start_rejected(client, auth, make_patient):
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(
        make_patient()["id"], end_date=str(date.today() - timedelta(days=1))))
    assert r.status_code == 422


def test_unknown_patient_or_medication(client, auth, make_patient):
    assert client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(999999)).status_code == 422
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(make_patient()["id"], medication_id=99999))
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REFERENCE"


def test_status_transitions(client, auth, make_rx):
    rx = make_rx()
    url = f"{API}/prescriptions/{rx['id']}/status"
    assert client.post(url, headers=auth(), json={"status": "cancelled"}).status_code == 422  # reason required
    assert client.post(url, headers=auth(), json={"status": "on_hold"}).json()["status"] == "on_hold"
    assert client.post(url, headers=auth(), json={"status": "completed"}).status_code == 409  # on_hold -> completed
    r = client.post(url, headers=auth(), json={"status": "cancelled", "reason": "Prescriber discontinued"})
    assert r.json()["status"] == "cancelled"
    assert client.post(url, headers=auth(), json={"status": "active"}).status_code == 409  # terminal


def test_cancel_closes_pending_refill(client, auth, make_rx):
    rx = make_rx()
    client.post(f"{API}/refill-requests", json={"prescription_id": rx["id"]}, headers=auth())
    client.post(f"{API}/prescriptions/{rx['id']}/status", headers=auth(), json={"status": "cancelled", "reason": "Stop"})
    assert client.get(f"{API}/prescriptions/{rx['id']}", headers=auth()).json()["refills"][0]["status"] == "cancelled"


def test_inactive_patient_cannot_receive_prescription(client, auth, make_patient):
    p = make_patient()
    client.post(f"{API}/patients/{p['id']}/deactivate", headers=auth())
    r = client.post(f"{API}/prescriptions", headers=auth(), json=rx_body(p["id"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "PATIENT_INACTIVE"


def test_list_filters(client, auth, make_rx):
    rx = make_rx()
    items = client.get(f"{API}/prescriptions", params={"q": rx["rx_code"]}, headers=auth()).json()["items"]
    assert [i["id"] for i in items] == [rx["id"]]
    items = client.get(f"{API}/prescriptions", params={"status": "active", "page_size": 100}, headers=auth()).json()["items"]
    assert all(i["status"] == "active" for i in items)
