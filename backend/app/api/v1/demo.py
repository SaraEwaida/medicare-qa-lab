from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.patients import search_filter
from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.core.security import require
from app.db.session import get_db
from app.demo.bugs import CATALOG, KEYS, bug_active, ensure_flags
from app.demo.sandbox import reset_sandbox
from app.models import BugReport, DemoBugFlag, Patient, Prescription, RefillRequest, User
from app.services import refills as refill_svc
from app.services.audit import audit

router = APIRouter(prefix="/demo", tags=["Bug Lab (controlled defects)"])


@router.get("/bugs")
def list_demo_bugs(_: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    flags = {f.key: f for f in db.scalars(select(DemoBugFlag))}
    docs = {b.demo_bug_key: b for b in db.scalars(select(BugReport).where(BugReport.demo_bug_key.is_not(None)))}
    return {"master_switch": get_settings().demo_bugs_enabled, "bugs": [
        {"key": b.key, "title": b.title, "description": b.description,
         "is_enabled": bool(flags.get(b.key) and flags[b.key].is_enabled),
         "updated_at": flags[b.key].updated_at if b.key in flags else None,
         "bug_report": {"id": docs[b.key].id, "bug_code": docs[b.key].bug_code, "status": docs[b.key].status.value}
         if b.key in docs else None} for b in CATALOG]}


@router.post("/bugs/{key}/toggle")
def toggle_demo_bug(key: str, enabled: bool = Query(...), user: User = Depends(require("demo:manage")),
                    db: Session = Depends(get_db)):
    if key not in KEYS:
        raise not_found("Demo bug")
    if not get_settings().demo_bugs_enabled:
        raise AppError(409, "DEMO_DISABLED", "Bug Lab is disabled in this environment (DEMO_BUGS_ENABLED=false).")
    ensure_flags(db)
    flag = db.get(DemoBugFlag, key)
    flag.is_enabled, flag.updated_by = enabled, user.id
    audit(db, user, "update", "demo_bug_flag", key, {"is_enabled": enabled})
    db.commit()
    return {"key": key, "is_enabled": enabled}


@router.post("/sandbox/reset")
def sandbox_reset(user: User = Depends(require("demo:manage")), db: Session = Depends(get_db)):
    result = reset_sandbox(db)
    audit(db, user, "reset", "sandbox", None, result)
    db.commit()
    return result


@router.get("/sandbox/patients")
def sandbox_patients(request: Request, q: str | None = Query(None, max_length=60),
                     _: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    stmt = select(Patient).where(Patient.is_sandbox).order_by(Patient.id)
    if q and q.strip():
        # DEMO-BUG: search_case_sensitive — LIKE instead of ILIKE.
        stmt = stmt.where(search_filter(q, case_sensitive=bug_active(db, request, "search_case_sensitive", sandbox=True)))
    return [{"id": p.id, "patient_code": p.patient_code, "first_name": p.first_name, "last_name": p.last_name}
            for p in db.scalars(stmt)]


@router.get("/sandbox/prescriptions")
def sandbox_prescriptions(_: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    rxs = db.scalars(select(Prescription).where(Prescription.is_sandbox).options(
        joinedload(Prescription.patient), joinedload(Prescription.medication)).order_by(Prescription.id))
    out = []
    for rx in rxs:
        refills = db.scalars(select(RefillRequest).where(RefillRequest.prescription_id == rx.id)
                             .order_by(RefillRequest.requested_at.desc())).all()
        out.append({"id": rx.id, "rx_code": rx.rx_code, "patient": f"{rx.patient.first_name} {rx.patient.last_name}",
                    "medication": f"{rx.medication.name} {rx.medication.strength}", "status": rx.status.value,
                    "refills_authorized": rx.refills_authorized, "refills_remaining": rx.refills_remaining,
                    "refills": [refill_svc.serialize(db, r) for r in refills]})
    return out


@router.post("/sandbox/refills", status_code=201)
def sandbox_submit_refill(request: Request, prescription_id: int = Query(...),
                          user: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    """QA engineers can't submit real refills; in the sandbox they act on behalf of a pharmacist."""
    rx = db.get(Prescription, prescription_id)
    if rx is None or not rx.is_sandbox:
        raise not_found("Sandbox prescription")
    refill, _ = refill_svc.submit(db, user, prescription_id, "Bug Lab", request.headers.get("idempotency-key"), request)
    db.commit()
    return refill_svc.serialize(db, refill_svc.load_refill(db, refill.id, request))


@router.post("/sandbox/refills/{refill_id}/approve")
def sandbox_approve_refill(refill_id: int, request: Request, user: User = Depends(require("qa:read")),
                           db: Session = Depends(get_db)):
    refill = db.get(RefillRequest, refill_id)
    if refill is None or not refill.is_sandbox:
        raise not_found("Sandbox refill")
    return refill_svc.approve(db, user, refill_id, request)


@router.get("/sandbox/refills/{refill_id}")
def sandbox_read_refill(refill_id: int, request: Request, _: User = Depends(require("qa:read")),
                        db: Session = Depends(get_db)):
    refill = db.get(RefillRequest, refill_id)
    if refill is None or not refill.is_sandbox:
        raise not_found("Sandbox refill")
    return refill_svc.serialize(db, refill_svc.load_refill(db, refill_id, request))
