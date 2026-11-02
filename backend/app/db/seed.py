"""Synthetic seed data. Run: python -m app.db.seed [--reset]

Idempotent: base data is only created when the users table is empty. Bug Lab flags, sandbox data and committed
automation reports are (re)applied on every run. Uses a fixed random seed so every environment looks the same.
"""

import argparse
import json
import random
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db import seed_data as D
from app.db.session import SessionLocal
from app.demo.bugs import ensure_flags
from app.demo.sandbox import reset_sandbox
from app.models import (
    AutomationResult, AutomationRun, BugReport, Medication, Patient, Prescription, RefillRequest, SupportTicket,
    TestCase, TestCaseStep, TicketEvent, TicketNote, User,
)

REPORTS_DIR = Path(__file__).parent / "reports"
NOW = datetime.now(UTC)


def _ago(days: float, rng: random.Random) -> datetime:
    return NOW - timedelta(days=days, hours=rng.randint(0, 9), minutes=rng.randint(0, 59))


def seed_users(db: Session) -> dict[str, User]:
    pw = hash_password(D.DEMO_PASSWORD)
    users = {}
    for email, name, role in D.USERS:
        u = User(email=email, full_name=name, role=role, password_hash=pw)
        db.add(u)
        users[email.split("@")[0]] = u
    db.flush()
    return users


def seed_pharmacy(db: Session, rng: random.Random, users: dict[str, User]) -> None:
    meds = [Medication(name=n, strength=s, form=f, is_controlled=c) for n, s, f, c in D.MEDICATIONS]
    db.add_all(meds)
    db.flush()
    pharmacists = [users["pharmacist"].id, users["pharmacist2"].id]

    # Patients spread over the last ~6 months.
    seen = set()
    patients = []
    # A fixed, well-known patient used in documented test cases.
    fixed = [("John", "Turner", date(1985, 6, 14)), ("Maria", "Said", date(1990, 11, 3)), ("Ali", "Nasser", date(1978, 2, 20))]
    while len(patients) < 240:
        if fixed:
            first, last, dob = fixed.pop(0)
        else:
            first, last = rng.choice(D.FIRST_NAMES), rng.choice(D.LAST_NAMES)
            dob = date(1940, 1, 1) + timedelta(days=rng.randint(0, 365 * 65))
        if (first.lower(), last.lower(), dob) in seen:
            continue
        seen.add((first.lower(), last.lower(), dob))
        created = _ago(rng.uniform(1, 180), rng)
        p = Patient(first_name=first, last_name=last, date_of_birth=dob,
                    email=f"{first.lower()}.{last.lower()}{rng.randint(1, 99)}@example.com" if rng.random() < 0.85 else None,
                    phone=f"+970 59 {rng.randint(100, 999)} {rng.randint(1000, 9999)}",
                    address=f"{rng.randint(1, 250)} {rng.choice(D.STREETS)}, {rng.choice(D.CITIES)}",
                    allergies=rng.choice(D.ALLERGIES), created_by=rng.choice(pharmacists),
                    created_at=created, updated_at=created)
        patients.append(p)
    db.add_all(patients)
    db.flush()

    statuses = ["active"] * 60 + ["refill_due"] * 10 + ["on_hold"] * 5 + ["completed"] * 15 + ["cancelled"] * 10
    for p in patients:
        n = rng.choices([0, 1, 2, 3, 4], weights=[8, 30, 32, 20, 10])[0]
        for med in rng.sample(meds, n):
            status = rng.choice(statuses)
            authorized = rng.randint(0, 6)
            used = rng.randint(0, authorized)
            created = max(p.created_at, _ago(rng.uniform(1, 120), rng))
            rx = Prescription(
                patient_id=p.id, medication_id=med.id, prescriber_name=rng.choice(D.PRESCRIBERS),
                dosage_instructions=rng.choice(D.DOSAGES), quantity=rng.choice([30, 30, 60, 90, 14, 1]),
                refills_authorized=authorized, refills_remaining=authorized - used, start_date=created.date(),
                end_date=created.date() + timedelta(days=rng.choice([90, 180, 365])) if rng.random() < 0.5 else None,
                status=status, created_by=rng.choice(pharmacists), created_at=created, updated_at=created)
            db.add(rx)
            db.flush()
            # Approved/dispensed refills exactly match refills used, so the DB consistency check holds.
            t = created
            for _ in range(used):
                t = min(t + timedelta(days=rng.randint(20, 35)), NOW - timedelta(hours=2))
                db.add(RefillRequest(prescription_id=rx.id, status=rng.choice(["approved", "dispensed", "dispensed"]),
                                     requested_by=rng.choice(pharmacists), requested_at=t,
                                     reviewed_by=rng.choice(pharmacists), reviewed_at=t + timedelta(hours=rng.randint(1, 20))))
            if rng.random() < 0.15:
                t2 = _ago(rng.uniform(1, 60), rng)
                db.add(RefillRequest(prescription_id=rx.id, status="rejected", requested_by=rng.choice(pharmacists),
                                     requested_at=t2, reviewed_by=rng.choice(pharmacists), reviewed_at=t2 + timedelta(hours=3),
                                     rejection_reason=rng.choice(["Prescriber requested hold", "Too early to refill",
                                                                  "Insurance authorization required"])))
            if status in ("active", "refill_due") and rx.refills_remaining >= 1 and rng.random() < 0.18:
                db.add(RefillRequest(prescription_id=rx.id, status="pending", requested_by=rng.choice(pharmacists),
                                     requested_at=_ago(rng.uniform(0, 6), rng),
                                     notes=rng.choice([None, "Patient called in", "Requested via clinic portal"])))
    db.flush()
    # Patients with no remaining open prescriptions may be inactive.
    for p in rng.sample(patients[3:], 18):
        open_rx = db.scalar(select(func.count()).select_from(Prescription).where(
            Prescription.patient_id == p.id, Prescription.status.in_(["active", "refill_due", "on_hold"])))
        if not open_rx:
            p.status = "inactive"


def seed_tickets(db: Session, rng: random.Random, users: dict[str, User]) -> None:
    support = [users["support"], users["support2"]]
    reporters = ["Al-Shifa Clinic front desk", "Downtown Pharmacy (Maya)", "Riverside Family Practice",
                 "City Pharmacy — night shift", "Leen Odeh (pharmacist)", "North Clinic IT"]
    patient_ids = list(db.scalars(select(Patient.id).where(~Patient.is_sandbox).limit(50)))
    for i, (subject, category, priority, description, status) in enumerate(D.TICKETS):
        created = _ago(rng.uniform(0.2, 40), rng)
        creator = users["pharmacist"] if i % 3 == 0 else rng.choice(support)
        assignee = None if status == "open" and i % 2 == 0 else rng.choice(support)
        t = SupportTicket(
            subject=subject, description=description, category=category, priority=priority, status=status,
            reporter_name=rng.choice(reporters), reporter_email=f"helpdesk{rng.randint(1, 9)}@clinic.example.com",
            browser=rng.choice(["Chrome 130", "Safari 18", "Edge 130", "Firefox 132", "Chrome Mobile 130"]),
            os=rng.choice(["Windows 11", "macOS 15", "iPadOS 18", "Android 15"]), app_version=rng.choice(["1.0.0", "0.9.4"]),
            related_request_id="req_" + "".join(rng.choices("0123456789abcdef", k=16)) if rng.random() < 0.6 else None,
            diagnostic_notes="Console shows a failed XHR to /api/v1/refill-requests (HTTP 4xx). HAR file attached by customer."
            if category == "refill" else None,
            patient_id=rng.choice(patient_ids) if category == "patient_data" else None,
            assignee_id=assignee.id if assignee else None, created_by=creator.id,
            resolution=D.RESOLUTIONS.get(subject) if status in ("resolved", "closed") else None,
            resolved_at=created + timedelta(hours=rng.randint(2, 30)) if status in ("resolved", "closed") else None,
            closed_at=created + timedelta(hours=rng.randint(31, 60)) if status == "closed" else None,
            created_at=created, updated_at=created)
        db.add(t)
        db.flush()
        db.add(TicketEvent(ticket_id=t.id, actor_id=creator.id, event_type="created", to_value="open", created_at=created))
        path = {"open": [], "investigating": ["investigating"], "escalated": ["investigating", "escalated"],
                "resolved": ["investigating", "resolved"], "closed": ["investigating", "resolved", "closed"]}[status]
        prev, ts = "open", created
        actor = assignee or support[0]
        if assignee:
            ts += timedelta(minutes=rng.randint(5, 90))
            db.add(TicketEvent(ticket_id=t.id, actor_id=actor.id, event_type="assigned", to_value=actor.full_name, created_at=ts))
        for step in path:
            ts += timedelta(hours=rng.randint(1, 8))
            db.add(TicketEvent(ticket_id=t.id, actor_id=actor.id, event_type="escalated" if step == "escalated"
                               else "status_changed", from_value=prev, to_value=step, created_at=ts))
            if step == "investigating":
                db.add(TicketNote(ticket_id=t.id, author_id=actor.id, is_internal=True, created_at=ts,
                                  body="Reproduced steps from the description. Checking request logs for the customer's "
                                       "request ID and comparing API response with database state."))
            if step == "escalated":
                db.add(TicketNote(ticket_id=t.id, author_id=actor.id, is_internal=True, created_at=ts,
                                  body="Escalating to engineering: reproducible, affects patient-facing workflow."))
            prev = step


def seed_test_cases(db: Session, users: dict[str, User]) -> dict[str, TestCase]:
    out = {}
    for tc in D.TEST_CASES:
        case = TestCase(title=tc["title"], module=tc["module"], type=tc["type"], priority=tc["priority"],
                        preconditions=tc["preconditions"], expected_result=tc["expected"],
                        is_automated=bool(tc["automation"]), automation_ref=tc["automation"],
                        created_by=users["qa"].id)
        case.steps = [TestCaseStep(step_number=i, action=a, expected=e) for i, (a, e) in enumerate(tc["steps"], 1)]
        db.add(case)
        db.flush()
        out[case.case_code] = case
    return out


DEMO_BUG_REPORTS = [
    {"key": "refill_status_stale", "regression": "TC-017", "severity": "major", "priority": "p1",
     "title": "Refill approval returns stale 'pending' status in API response",
     "description": "After approving a refill, the UI keeps showing 'Pending'. The approve endpoint responds 200 but "
                    "the response body carries the pre-update state. Database state is correct.",
     "preconditions": "Bug Lab: 'refill_status_stale' enabled. Sandbox reset. Sandbox prescription with ≥1 refill.",
     "steps": "1. Bug Lab → Sandbox prescriptions → Request refill on Lisinopril (Nora Haddad).\n"
              "2. Click Approve on the new pending refill.\n3. Observe the status badge and the API response "
              "(Network tab or Logs Explorer).\n4. Click 'Reload from server'.",
     "expected": "Response body status = 'approved' and refills_remaining decremented; UI updates immediately.",
     "actual": "HTTP 200 with status 'pending' and the old refills_remaining. After reload, the UI shows 'approved'.",
     "root_cause": "services/refills.py approve(): the response was serialized from a snapshot captured before the "
                   "status change and before the counter decrement, instead of re-reading the row after commit.",
     "fix_notes": "Serialize the refill after commit (re-load the row). Injection point marked `# DEMO-BUG: "
                  "refill_status_stale`. Regression covered by TC-017 and e2e/tests/refills.spec.ts."},
    {"key": "refill_boundary_422", "regression": "TC-019", "severity": "major", "priority": "p2",
     "title": "Refill rejected with 422 when exactly 1 refill remains",
     "description": "A valid refill request is rejected with NO_REFILLS_REMAINING when the prescription has exactly "
                    "one refill left. Classic off-by-one boundary defect.",
     "preconditions": "Bug Lab: 'refill_boundary_422' enabled. Sandbox prescription with refills_remaining = 1 "
                      "(Metformin, Omar Khalil).",
     "steps": "1. Bug Lab → Sandbox prescriptions → find Metformin (1 of 3 remaining).\n2. Click Request refill.\n"
              "3. Observe the error message and the 422 entry in Logs Explorer.",
     "expected": "201 Created; refill is Pending.",
     "actual": "422 NO_REFILLS_REMAINING: 'No refills remaining on RX-xxxx'.",
     "root_cause": "services/refills.py submit(): availability check used `refills_remaining > 1` instead of `>= 1`.",
     "fix_notes": "Use `>= 1`. Boundary tests added for 0, 1 and 2 remaining (TC-019, test_refills.py)."},
    {"key": "search_case_sensitive", "regression": "TC-010", "severity": "minor", "priority": "p3",
     "title": "Patient search misses matches typed in a different letter case",
     "description": "Searching 'nora' returns no results although 'Nora Haddad' exists. Support ticket reported the "
                    "same symptom ('Search does not find patient by lowercase name').",
     "preconditions": "Bug Lab: 'search_case_sensitive' enabled. Sandbox reset.",
     "steps": "1. Bug Lab → Sandbox patient search.\n2. Search 'Nora' → 1 result.\n3. Search 'nora' → 0 results.",
     "expected": "Both searches return Nora Haddad.",
     "actual": "Lowercase search returns no results.",
     "root_cause": "api/v1/patients.py search_filter(): LIKE used instead of ILIKE when the case_sensitive path is taken.",
     "fix_notes": "Always use ILIKE. Regression covered by TC-010 and e2e/tests/patients.spec.ts."},
    {"key": "refill_double_submit", "regression": "TC-018", "severity": "critical", "priority": "p1",
     "title": "Double-clicking Submit creates duplicate refill requests",
     "description": "Two pending refill requests are created for the same prescription when Submit is clicked twice "
                    "quickly. Risk of dispensing medication twice.",
     "preconditions": "Bug Lab: 'refill_double_submit' enabled. Sandbox reset.",
     "steps": "1. Bug Lab → Sandbox prescriptions → Atorvastatin (Lina Nasser).\n2. Click 'Submit twice' "
              "(sends two requests with the same Idempotency-Key).\n3. Observe two pending refills.\n"
              "4. Run Database checks: sandbox rows are excluded, so verify with SQL: SELECT prescription_id, count(*) "
              "FROM refill_requests WHERE status='pending' GROUP BY 1 HAVING count(*) > 1;",
     "expected": "Second request returns the original refill (Idempotent-Replay) or 409 REFILL_DUPLICATE; one row.",
     "actual": "Both requests return 201; two pending rows exist.",
     "root_cause": "services/refills.py submit(): idempotency-key lookup and pending-duplicate check were skipped; "
                   "the DB partial unique index does not cover sandbox rows, so nothing stopped the insert.",
     "fix_notes": "Restore both checks; keep the partial unique index as defense in depth. Regression: TC-018, "
                  "test_refills.py::test_duplicate_pending_refill_rejected."},
]


def seed_demo_bug_reports(db: Session, users: dict[str, User], cases: dict[str, TestCase]) -> None:
    for b in DEMO_BUG_REPORTS:
        db.add(BugReport(
            title=b["title"], description=b["description"],
            environment="Bug Lab sandbox · MediCare QA Lab 1.0.0 · Chrome 130 / Windows 11",
            preconditions=b["preconditions"], steps_to_reproduce=b["steps"], expected_behavior=b["expected"],
            actual_behavior=b["actual"], severity=b["severity"], priority=b["priority"], status="fixed",
            root_cause=b["root_cause"], fix_notes=b["fix_notes"], demo_bug_key=b["key"],
            regression_case_id=cases[b["regression"]].id if b["regression"] in cases else None,
            evidence=[{"type": "doc", "ref": f"docs/bug-reports/{b['key']}.md"}], reported_by=users["qa"].id))


def load_automation_reports(db: Session) -> int:
    """Load committed reports produced by real test executions (see scripts/upload_test_report.py)."""
    if not REPORTS_DIR.exists():
        return 0
    qa = db.scalars(select(User).where(User.role == "qa_engineer").order_by(User.id)).first()
    case_ids = dict(db.execute(select(TestCase.case_code, TestCase.id)).all())
    loaded = 0
    for f in sorted(REPORTS_DIR.glob("*.json")):
        data = json.loads(f.read_text())
        started = datetime.fromisoformat(data["started_at"])
        exists = db.scalar(select(AutomationRun.id).where(AutomationRun.suite_name == data["suite_name"],
                                                          AutomationRun.started_at == started))
        if exists:
            continue
        counts = {"passed": 0, "failed": 0, "skipped": 0}
        for r in data["results"]:
            counts[r["status"]] += 1
        run = AutomationRun(framework=data["framework"], suite_name=data["suite_name"], commit_sha=data.get("commit_sha"),
                            branch=data.get("branch"), started_at=started, duration_ms=data["duration_ms"],
                            total=len(data["results"]), uploaded_by=qa.id if qa else None, **counts)
        db.add(run)
        db.flush()
        db.add_all(AutomationResult(automation_run_id=run.id, test_name=r["test_name"][:300], file_path=r.get("file_path"),
                                    status=r["status"], duration_ms=r["duration_ms"], error_message=r.get("error_message"),
                                    test_case_id=case_ids.get(r.get("case_code"))) for r in data["results"])
        loaded += 1
    return loaded


def reset_all(db: Session) -> None:
    tables = ["automation_results", "automation_runs", "bug_reports", "test_run_results", "test_runs", "test_case_steps",
              "test_cases", "ticket_events", "ticket_notes", "support_tickets", "refill_requests", "prescriptions",
              "medications", "patients", "demo_bug_flags", "audit_logs", "app_logs", "users"]
    db.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    for seq, start in [("patient_code_seq", 1001), ("rx_code_seq", 5001), ("ticket_code_seq", 1001),
                       ("test_code_seq", 1), ("bug_code_seq", 1)]:
        db.execute(text(f"ALTER SEQUENCE {seq} RESTART WITH {start}"))


def run(reset: bool = False) -> dict:
    rng = random.Random(20261101)
    with SessionLocal() as db:
        if reset:
            reset_all(db)
            db.commit()
        created = False
        if not db.scalar(select(func.count()).select_from(User)):
            users = seed_users(db)
            seed_pharmacy(db, rng, users)
            seed_tickets(db, rng, users)
            cases = seed_test_cases(db, users)
            seed_demo_bug_reports(db, users, cases)
            created = True
        ensure_flags(db)
        sandbox = reset_sandbox(db)
        db.commit()
        reports = load_automation_reports(db)
        db.commit()
        return {"base_data_created": created, "sandbox": sandbox, "automation_reports_loaded": reports}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Truncate all tables before seeding.")
    print(run(parser.parse_args().reset))
