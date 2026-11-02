"""Refill request workflow: pending -> approved -> dispensed, pending -> rejected | cancelled."""

from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.errors import AppError, conflict, not_found, unprocessable
from app.demo.bugs import bug_active, demo_session
from app.models import Prescription, PrescriptionStatus, RefillRequest, RefillStatus, User
from app.services.audit import audit

SUBMITTABLE_RX = {PrescriptionStatus.active, PrescriptionStatus.refill_due}


def load_refill(db: Session, refill_id: int, request: Request | None, lock: bool = False) -> RefillRequest:
    stmt = select(RefillRequest).where(RefillRequest.id == refill_id).options(
        joinedload(RefillRequest.prescription).joinedload(Prescription.patient),
        joinedload(RefillRequest.prescription).joinedload(Prescription.medication))
    if lock:
        stmt = stmt.with_for_update(of=RefillRequest)
    refill = db.scalars(stmt).unique().one_or_none()
    # Sandbox rows are only reachable from the Bug Lab (X-Demo-Session).
    if refill is None or (refill.is_sandbox and not demo_session(request)):
        raise not_found("Refill request")
    return refill


def submit(db: Session, user: User, prescription_id: int, notes: str | None, idempotency_key: str | None,
           request: Request | None) -> tuple[RefillRequest, bool]:
    """Returns (refill, created). created=False means an idempotent replay."""
    rx = db.scalars(select(Prescription).where(Prescription.id == prescription_id).with_for_update()).one_or_none()
    if rx is None or (rx.is_sandbox and not demo_session(request)):
        raise not_found("Prescription")

    # DEMO-BUG: refill_double_submit — idempotency + duplicate check skipped on sandbox data.
    double_submit_bug = bug_active(db, request, "refill_double_submit", sandbox=rx.is_sandbox)

    if idempotency_key and not double_submit_bug:
        existing = db.scalars(select(RefillRequest).where(RefillRequest.idempotency_key == idempotency_key)).first()
        if existing:
            if existing.prescription_id != rx.id:
                raise conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different request.")
            return existing, False

    if rx.status not in SUBMITTABLE_RX:
        raise unprocessable(f"Prescription {rx.rx_code} is {rx.status.value}; refills can only be requested for "
                            "active prescriptions.", "prescription_id", "PRESCRIPTION_NOT_ACTIVE")
    if rx.patient.status.value != "active":
        raise unprocessable("Patient is inactive.", "prescription_id", "PATIENT_INACTIVE")

    # DEMO-BUG: refill_boundary_422 — off-by-one: `> 1` instead of `>= 1`.
    if bug_active(db, request, "refill_boundary_422", sandbox=rx.is_sandbox):
        has_refills = rx.refills_remaining > 1
    else:
        has_refills = rx.refills_remaining >= 1
    if not has_refills:
        raise unprocessable(f"No refills remaining on {rx.rx_code}.", "prescription_id", "NO_REFILLS_REMAINING")

    if not double_submit_bug:
        pending = db.scalars(select(RefillRequest.id).where(
            RefillRequest.prescription_id == rx.id, RefillRequest.status == RefillStatus.pending)).first()
        if pending:
            raise conflict("REFILL_DUPLICATE", f"A pending refill request already exists for {rx.rx_code}.")

    refill = RefillRequest(prescription_id=rx.id, requested_by=user.id, notes=notes,
                           idempotency_key=None if double_submit_bug else idempotency_key, is_sandbox=rx.is_sandbox)
    db.add(refill)
    db.flush()
    audit(db, user, "create", "refill_request", refill.id, {"prescription": rx.rx_code, "status": "pending"})
    return refill, True


def _transition(refill: RefillRequest, allowed_from: set[RefillStatus], to: RefillStatus) -> None:
    if refill.status not in allowed_from:
        raise AppError(409, "INVALID_TRANSITION",
                       f"Cannot change a refill request from '{refill.status.value}' to '{to.value}'.")


def approve(db: Session, user: User, refill_id: int, request: Request | None) -> dict:
    refill = load_refill(db, refill_id, request, lock=True)
    _transition(refill, {RefillStatus.pending}, RefillStatus.approved)
    rx = db.scalars(select(Prescription).where(Prescription.id == refill.prescription_id).with_for_update()).one()
    if rx.refills_remaining < 1:
        raise unprocessable(f"No refills remaining on {rx.rx_code}.", "prescription_id", "NO_REFILLS_REMAINING")

    # DEMO-BUG: refill_status_stale — response is serialized from a snapshot taken *before* the update.
    stale = bug_active(db, request, "refill_status_stale", sandbox=refill.is_sandbox)
    snapshot = serialize(db, refill) if stale else None

    refill.status = RefillStatus.approved
    refill.reviewed_by = user.id
    refill.reviewed_at = datetime.now(UTC)
    rx.refills_remaining -= 1
    if rx.status == PrescriptionStatus.refill_due:
        rx.status = PrescriptionStatus.active
    audit(db, user, "status_change", "refill_request", refill.id,
          {"status": {"from": "pending", "to": "approved"},
           "refills_remaining": {"from": rx.refills_remaining + 1, "to": rx.refills_remaining}})
    db.commit()
    return snapshot if stale else serialize(db, load_refill(db, refill_id, request))


def reject(db: Session, user: User, refill_id: int, reason: str, request: Request | None) -> dict:
    refill = load_refill(db, refill_id, request, lock=True)
    _transition(refill, {RefillStatus.pending}, RefillStatus.rejected)
    refill.status, refill.rejection_reason = RefillStatus.rejected, reason
    refill.reviewed_by, refill.reviewed_at = user.id, datetime.now(UTC)
    audit(db, user, "status_change", "refill_request", refill.id, {"status": {"from": "pending", "to": "rejected"}})
    db.commit()
    return serialize(db, load_refill(db, refill_id, request))


def dispense(db: Session, user: User, refill_id: int, request: Request | None) -> dict:
    refill = load_refill(db, refill_id, request, lock=True)
    _transition(refill, {RefillStatus.approved}, RefillStatus.dispensed)
    refill.status = RefillStatus.dispensed
    audit(db, user, "status_change", "refill_request", refill.id, {"status": {"from": "approved", "to": "dispensed"}})
    db.commit()
    return serialize(db, load_refill(db, refill_id, request))


def cancel(db: Session, user: User, refill_id: int, request: Request | None) -> dict:
    refill = load_refill(db, refill_id, request, lock=True)
    _transition(refill, {RefillStatus.pending}, RefillStatus.cancelled)
    refill.status = RefillStatus.cancelled
    refill.reviewed_by, refill.reviewed_at = user.id, datetime.now(UTC)
    audit(db, user, "status_change", "refill_request", refill.id, {"status": {"from": "pending", "to": "cancelled"}})
    db.commit()
    return serialize(db, load_refill(db, refill_id, request))


def serialize(db: Session, r: RefillRequest) -> dict:
    rx = r.prescription
    ids = [i for i in (r.requested_by, r.reviewed_by) if i]
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    return {
        "id": r.id, "prescription_id": rx.id, "rx_code": rx.rx_code,
        "patient": {"id": rx.patient.id, "patient_code": rx.patient.patient_code,
                    "first_name": rx.patient.first_name, "last_name": rx.patient.last_name},
        "medication": f"{rx.medication.name} {rx.medication.strength}",
        "status": r.status.value, "refills_remaining": rx.refills_remaining,
        "requested_at": r.requested_at, "requested_by": names.get(r.requested_by),
        "reviewed_at": r.reviewed_at, "reviewed_by": names.get(r.reviewed_by),
        "rejection_reason": r.rejection_reason, "notes": r.notes,
    }
