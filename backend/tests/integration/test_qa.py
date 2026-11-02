from datetime import UTC, datetime

API = "/api/v1"


def new_run(client, auth, case_ids, name="Smoke run"):
    r = client.post(f"{API}/qa/test-runs", json={"name": name, "test_case_ids": case_ids}, headers=auth("qa"))
    assert r.status_code == 201, r.text
    return r.json()


def record(client, auth, run, result, **body):
    return client.patch(f"{API}/qa/test-runs/{run['id']}/results/{result['id']}", json=body, headers=auth("qa"))


def test_create_test_case_with_steps(client, auth):
    r = client.post(f"{API}/qa/test-cases", headers=auth("qa"), json={
        "title": "Logout clears session", "module": "auth", "expected_result": "Login page shown",
        "steps": [{"action": "Click avatar → Sign out", "expected": "Redirected to login"}]})
    assert r.status_code == 201
    tc = r.json()
    assert tc["case_code"].startswith("TC-") and tc["steps"][0]["step_number"] == 1
    assert client.post(f"{API}/qa/test-cases", headers=auth("qa"), json={
        "title": "No steps", "module": "auth", "expected_result": "x", "steps": []}).status_code == 422


def test_tc025_results_and_pass_rate(client, auth):
    run = new_run(client, auth, [1, 2, 3])
    assert run["stats"]["progress"] == 0 and run["stats"]["pass_rate"] is None
    r1, r2, r3 = run["results"]
    assert record(client, auth, run, r2, status="failed").status_code == 422  # actual result required
    record(client, auth, run, r1, status="passed", duration_ms=1200)
    record(client, auth, run, r2, status="failed", actual_result="Error banner instead of dashboard")
    out = record(client, auth, run, r3, status="blocked", actual_result="Env down").json()
    assert out["stats"] == {"total": 3, "passed": 1, "failed": 1, "blocked": 1, "not_run": 0, "executed": 3,
                            "pass_rate": 33.3, "progress": 100.0}
    summary = client.get(f"{API}/dashboard/summary", headers=auth("qa")).json()["latest_test_execution"]
    assert summary["source"] == "manual" and summary["pass_rate"] == 33.3


def test_completed_run_is_locked(client, auth):
    run = new_run(client, auth, [4])
    client.post(f"{API}/qa/test-runs/{run['id']}/complete", headers=auth("qa"))
    r = record(client, auth, run, run["results"][0], status="passed")
    assert r.status_code == 409 and r.json()["error"]["code"] == "RUN_COMPLETED"


def test_run_rejects_unknown_cases(client, auth):
    r = client.post(f"{API}/qa/test-runs", json={"name": "Bad", "test_case_ids": [1, 99999]}, headers=auth("qa"))
    assert r.status_code == 422


def test_bug_from_failed_result_and_verification_rules(client, auth):
    run = new_run(client, auth, [5])
    res = run["results"][0]
    body = {"title": "Approve allowed for support role", "description": "403 expected", "environment": "local",
            "steps_to_reproduce": "Call approve with support token", "expected_behavior": "403",
            "actual_behavior": "200", "severity": "critical", "priority": "p1", "source_result_id": res["id"]}
    assert client.post(f"{API}/qa/bugs", json=body, headers=auth("qa")).status_code == 422  # result not failed
    record(client, auth, run, res, status="failed", actual_result="200 returned")
    bug = client.post(f"{API}/qa/bugs", json=body, headers=auth("qa")).json()
    detail = client.get(f"{API}/qa/test-runs/{run['id']}", headers=auth("qa")).json()
    assert detail["results"][0]["linked_bug_codes"] == [bug["bug_code"]]
    url = f"{API}/qa/bugs/{bug['id']}"
    assert client.patch(url, json={"status": "verified"}, headers=auth("qa")).status_code == 422  # no root cause
    assert client.patch(url, json={"status": "verified", "root_cause": "Missing dependency"},
                        headers=auth("qa")).status_code == 422  # no regression case
    r = client.patch(url, json={"status": "verified", "root_cause": "Missing dependency", "regression_case_id": 5},
                     headers=auth("qa"))
    assert r.json()["status"] == "verified" and r.json()["regression_case_code"] == "TC-005"


def test_support_can_create_but_not_edit_bug(client, auth):
    body = {"title": "Search slow", "description": "Takes 8s", "environment": "prod", "steps_to_reproduce": "Search 'a'",
            "expected_behavior": "<1s", "actual_behavior": "8 seconds", "severity": "minor", "priority": "p3"}
    bug = client.post(f"{API}/qa/bugs", json=body, headers=auth("support"))
    assert bug.status_code == 201
    assert client.patch(f"{API}/qa/bugs/{bug.json()['id']}", json={"status": "confirmed"},
                        headers=auth("support")).status_code == 403


def test_automation_ingest_and_coverage(client, auth):
    new_case = client.post(f"{API}/qa/test-cases", headers=auth("qa"), json={
        "title": "Coverage link check", "module": "qa", "expected_result": "Linked", "steps": [{"action": "Upload report"}]}).json()
    code = new_case["case_code"]
    before = client.get(f"{API}/qa/metrics", headers=auth("qa")).json()["coverage"]["covered_cases"]
    body = {"framework": "pytest", "suite_name": "unit-test-ingest", "started_at": datetime.now(UTC).isoformat(),
            "duration_ms": 900, "results": [
                {"test_name": "test_coverage_link", "status": "passed", "duration_ms": 10, "case_code": code},
                {"test_name": "test_other", "status": "failed", "duration_ms": 5, "error_message": "AssertionError"},
                {"test_name": "test_skip", "status": "skipped", "duration_ms": 0}]}
    resp = client.post(f"{API}/qa/automation-runs", json=body, headers=auth("qa"))
    assert resp.status_code == 201, resp.text
    run = resp.json()
    assert (run["total"], run["passed"], run["failed"], run["skipped"]) == (3, 1, 1, 1)
    detail = client.get(f"{API}/qa/automation-runs/{run['id']}", headers=auth("qa")).json()
    assert detail["results"][0]["case_code"] == code
    m = client.get(f"{API}/qa/metrics", headers=auth("qa")).json()
    assert m["coverage"]["covered_cases"] == before + 1  # the new case becomes covered only once a report links it
    bad = {**body, "results": [{"test_name": "x", "status": "flaky", "duration_ms": 1}]}
    assert client.post(f"{API}/qa/automation-runs", json=bad, headers=auth("qa")).status_code == 422


def test_last_status_on_test_cases(client, auth):
    run = new_run(client, auth, [6])
    record(client, auth, run, run["results"][0], status="passed")
    case = client.get(f"{API}/qa/test-cases/6", headers=auth("qa")).json()
    assert case["last_status"] == "passed"
