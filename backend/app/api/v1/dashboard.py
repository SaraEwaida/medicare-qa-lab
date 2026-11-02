from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.core.errors import unprocessable
from app.core.permissions import has_permission
from app.core.security import get_current_user, require
from app.db.session import get_db
from app.models import (
    BugReport, BugStatus, Patient, PatientStatus, Prescription, PrescriptionStatus, RefillRequest, RefillStatus,
    SupportTicket, TestCase, TestResultStatus, TestRun, TestRunResult, TicketPriority, TicketStatus, User,
)
from app.services.qa_metrics import latest_pass_rate, run_stats

router = APIRouter(tags=["Dashboard"])

OPEN_TICKETS = (TicketStatus.open, TicketStatus.investigating, TicketStatus.escalated)
ACTIVE_RX = (PrescriptionStatus.active, PrescriptionStatus.refill_due)


def _range(from_: date | None, to: date | None) -> tuple[date, date]:
    to = to or date.today()
    from_ = from_ or to - timedelta(days=29)
    if from_ > to:
        raise unprocessable("'from' must be on or before 'to'.", "from")
    if (to - from_).days > 366:
        raise unprocessable("Date range cannot exceed one year.", "from")
    return from_, to


@router.get("/dashboard/summary")
def summary(from_: date | None = Query(None, alias="from"), to: date | None = None,
            _: User = Depends(require("dashboard:read")), db: Session = Depends(get_db)):
    start, end = _range(from_, to)
    period = (end - start).days + 1
    s0 = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    e0 = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    p0 = s0 - timedelta(days=period)

    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    def created_in(model, col, a, b, *where):
        return count(model, col >= a, col < b, *where)

    real_patients = ~Patient.is_sandbox
    return {
        "range": {"from": start, "to": end},
        "active_patients": {
            "value": count(Patient, real_patients, Patient.status == PatientStatus.active),
            "new_in_range": created_in(Patient, Patient.created_at, s0, e0, real_patients),
            "new_prev_range": created_in(Patient, Patient.created_at, p0, s0, real_patients)},
        "active_prescriptions": {
            "value": count(Prescription, ~Prescription.is_sandbox, Prescription.status.in_(ACTIVE_RX)),
            "new_in_range": created_in(Prescription, Prescription.created_at, s0, e0, ~Prescription.is_sandbox),
            "new_prev_range": created_in(Prescription, Prescription.created_at, p0, s0, ~Prescription.is_sandbox)},
        "pending_refills": {
            "value": count(RefillRequest, ~RefillRequest.is_sandbox, RefillRequest.status == RefillStatus.pending),
            "new_in_range": created_in(RefillRequest, RefillRequest.requested_at, s0, e0, ~RefillRequest.is_sandbox),
            "new_prev_range": created_in(RefillRequest, RefillRequest.requested_at, p0, s0, ~RefillRequest.is_sandbox)},
        "open_tickets": {
            "value": count(SupportTicket, SupportTicket.status.in_(OPEN_TICKETS)),
            "new_in_range": created_in(SupportTicket, SupportTicket.created_at, s0, e0),
            "new_prev_range": created_in(SupportTicket, SupportTicket.created_at, p0, s0)},
        "latest_test_execution": latest_pass_rate(db),
    }


@router.get("/dashboard/prescription-activity")
def activity(from_: date | None = Query(None, alias="from"), to: date | None = None,
             granularity: str = Query("day", pattern="^(day|week)$"),
             _: User = Depends(require("dashboard:read")), db: Session = Depends(get_db)):
    start, end = _range(from_, to)
    rows = db.execute(text("""
        WITH buckets AS (
            SELECT generate_series(date_trunc(:g, CAST(:s AS date)), CAST(:e AS date), CAST(:step AS interval))::date AS b)
        SELECT b AS bucket,
          (SELECT count(*) FROM prescriptions p WHERE NOT p.is_sandbox
             AND date_trunc(:g, p.created_at)::date = b AND p.created_at::date BETWEEN :s AND :e) AS new_prescriptions,
          (SELECT count(*) FROM refill_requests r WHERE NOT r.is_sandbox
             AND date_trunc(:g, r.requested_at)::date = b AND r.requested_at::date BETWEEN :s AND :e) AS refills,
          (SELECT count(*) FROM refill_requests r WHERE NOT r.is_sandbox AND r.status IN ('approved','dispensed')
             AND date_trunc(:g, r.reviewed_at)::date = b AND r.reviewed_at::date BETWEEN :s AND :e) AS approved_refills
        FROM buckets ORDER BY b"""), {"g": granularity, "s": start, "e": end,
                                      "step": "1 day" if granularity == "day" else "1 week"}).mappings().all()
    by_status = db.execute(select(Prescription.status, func.count()).where(~Prescription.is_sandbox)
                           .group_by(Prescription.status)).all()
    return {"series": [dict(r) for r in rows], "by_status": {k.value: v for k, v in by_status}}


@router.get("/dashboard/recent")
def recent(user: User = Depends(require("dashboard:read")), db: Session = Depends(get_db)):
    tq = select(SupportTicket).options(joinedload(SupportTicket.assignee)).order_by(SupportTicket.created_at.desc()).limit(5)
    if not has_permission(user.role, "tickets:read_all"):
        tq = tq.where(SupportTicket.created_by == user.id)
    tickets = [{"id": t.id, "ticket_code": t.ticket_code, "subject": t.subject, "priority": t.priority.value,
                "status": t.status.value, "created_at": t.created_at} for t in db.scalars(tq)]
    out = {"tickets": tickets, "bugs": None, "latest_run": None, "refills": None}
    if has_permission(user.role, "qa:read"):
        bugs = db.scalars(select(BugReport).where(BugReport.status.in_(
            [BugStatus.new, BugStatus.confirmed, BugStatus.in_progress])).order_by(BugReport.created_at.desc()).limit(5))
        out["bugs"] = [{"id": b.id, "bug_code": b.bug_code, "title": b.title, "severity": b.severity.value,
                        "priority": b.priority.value, "status": b.status.value} for b in bugs]
        run = db.scalars(select(TestRun).order_by(TestRun.started_at.desc()).limit(1)).first()
        if run:
            out["latest_run"] = {"id": run.id, "name": run.name, "started_at": run.started_at, **run_stats(run.results)}
    if has_permission(user.role, "refills:review"):
        refills = db.scalars(select(RefillRequest).where(~RefillRequest.is_sandbox,
                                                         RefillRequest.status == RefillStatus.pending)
                             .options(joinedload(RefillRequest.prescription).joinedload(Prescription.medication),
                                      joinedload(RefillRequest.prescription).joinedload(Prescription.patient))
                             .order_by(RefillRequest.requested_at).limit(5))
        out["refills"] = [{"id": r.id, "rx_code": r.prescription.rx_code, "requested_at": r.requested_at,
                           "medication": r.prescription.medication.name,
                           "patient": f"{r.prescription.patient.first_name} {r.prescription.patient.last_name}"}
                          for r in refills]
    return out


@router.get("/search")
def global_search(q: str = Query(..., min_length=2, max_length=100), user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    """Role-aware global search. Patients are only searchable by name for pharmacists."""
    t = f"%{q.strip()}%"
    out: list[dict] = []
    role = user.role
    if has_permission(role, "patients:write"):
        for p in db.scalars(select(Patient).where(~Patient.is_sandbox, or_(
                Patient.patient_code.ilike(t), (Patient.first_name + " " + Patient.last_name).ilike(t))).limit(5)):
            out.append({"type": "patient", "id": p.id, "code": p.patient_code, "title": f"{p.first_name} {p.last_name}",
                        "subtitle": p.status.value})
    elif has_permission(role, "patients:read"):
        for p in db.scalars(select(Patient).where(~Patient.is_sandbox, Patient.patient_code.ilike(t)).limit(5)):
            out.append({"type": "patient", "id": p.id, "code": p.patient_code, "title": p.patient_code,
                        "subtitle": "Patient"})
    for rx in db.scalars(select(Prescription).options(joinedload(Prescription.medication))
                         .where(~Prescription.is_sandbox, Prescription.rx_code.ilike(t)).limit(5)):
        out.append({"type": "prescription", "id": rx.id, "code": rx.rx_code,
                    "title": f"{rx.medication.name} {rx.medication.strength}", "subtitle": rx.status.value})
    tq = select(SupportTicket).where(or_(SupportTicket.ticket_code.ilike(t), SupportTicket.subject.ilike(t))).limit(5)
    if not has_permission(role, "tickets:read_all"):
        tq = tq.where(SupportTicket.created_by == user.id)
    for tk in db.scalars(tq):
        out.append({"type": "ticket", "id": tk.id, "code": tk.ticket_code, "title": tk.subject, "subtitle": tk.status.value})
    if has_permission(role, "qa:read"):
        for b in db.scalars(select(BugReport).where(or_(BugReport.bug_code.ilike(t), BugReport.title.ilike(t))).limit(5)):
            out.append({"type": "bug", "id": b.id, "code": b.bug_code, "title": b.title, "subtitle": b.status.value})
        for c in db.scalars(select(TestCase).where(~TestCase.is_archived, or_(
                TestCase.case_code.ilike(t), TestCase.title.ilike(t))).limit(5)):
            out.append({"type": "test_case", "id": c.id, "code": c.case_code, "title": c.title, "subtitle": c.module})
    return {"query": q, "results": out}


@router.get("/notifications")
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Derived from live data for the user's role (nothing is stored)."""
    items: list[dict] = []
    if has_permission(user.role, "refills:review"):
        n = db.scalar(select(func.count()).select_from(RefillRequest).where(
            ~RefillRequest.is_sandbox, RefillRequest.status == RefillStatus.pending)) or 0
        if n:
            items.append({"kind": "refills", "severity": "info", "title": f"{n} refill request(s) awaiting review",
                          "link": "/prescriptions?tab=refills"})
        due = db.scalar(select(func.count()).select_from(Prescription).where(
            ~Prescription.is_sandbox, Prescription.status == PrescriptionStatus.refill_due)) or 0
        if due:
            items.append({"kind": "refill_due", "severity": "info", "title": f"{due} prescription(s) marked refill due",
                          "link": "/prescriptions?status=refill_due"})
    if has_permission(user.role, "tickets:manage"):
        n = db.scalar(select(func.count()).select_from(SupportTicket).where(
            SupportTicket.status.in_(OPEN_TICKETS), SupportTicket.assignee_id.is_(None))) or 0
        if n:
            items.append({"kind": "unassigned", "severity": "warning", "title": f"{n} open ticket(s) unassigned",
                          "link": "/tickets?unassigned=true"})
        n = db.scalar(select(func.count()).select_from(SupportTicket).where(
            SupportTicket.status.in_(OPEN_TICKETS),
            SupportTicket.priority.in_([TicketPriority.high, TicketPriority.critical]))) or 0
        if n:
            items.append({"kind": "high_priority", "severity": "danger", "title": f"{n} high/critical ticket(s) open",
                          "link": "/tickets?priority=high"})
    if has_permission(user.role, "qa:write"):
        run = db.scalars(select(TestRun).order_by(TestRun.started_at.desc()).limit(1)).first()
        if run:
            failed = sum(1 for r in run.results if r.status == TestResultStatus.failed)
            if failed:
                items.append({"kind": "failed_tests", "severity": "danger",
                              "title": f"{failed} failed test(s) in '{run.name}'", "link": f"/qa/runs/{run.id}"})
        n = db.scalar(select(func.count()).select_from(BugReport).where(BugReport.status == BugStatus.new)) or 0
        if n:
            items.append({"kind": "new_bugs", "severity": "warning", "title": f"{n} new bug(s) awaiting triage",
                          "link": "/qa?tab=bugs"})
    return {"items": items, "count": len(items)}
