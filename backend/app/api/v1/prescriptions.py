from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import PageParams, apply_sort, check_version, page_params, paginate
from app.core.errors import AppError, not_found, unprocessable
from app.core.security import require
from app.db.session import get_db
from app.models import (
    Medication, Patient, PatientStatus, Prescription, PrescriptionStatus, RefillRequest, RefillStatus, User,
)
from app.schemas.common import Page
from app.schemas.pharmacy import (
    PrescriptionCreate, PrescriptionDetail, PrescriptionOut, PrescriptionStatusChange, PrescriptionUpdate,
    RefillCreate, RefillOut, RefillReject,
)
from app.services import refills as refill_svc
from app.services.audit import audit, diff

router = APIRouter(tags=["Prescriptions & refills"])

PS = PrescriptionStatus
RX_TRANSITIONS = {
    PS.active: {PS.on_hold, PS.cancelled, PS.completed},
    PS.refill_due: {PS.on_hold, PS.cancelled, PS.completed, PS.active},
    PS.on_hold: {PS.active, PS.cancelled},
    PS.completed: set(),
    PS.cancelled: set(),
}
RX_SORTS = {"rx_code": Prescription.id, "start_date": Prescription.start_date, "status": Prescription.status,
            "refills_remaining": Prescription.refills_remaining, "created_at": Prescription.created_at}


def _rx_query():
    return select(Prescription).options(joinedload(Prescription.patient), joinedload(Prescription.medication))


def get_rx(db: Session, rx_id: int) -> Prescription:
    rx = db.scalars(_rx_query().where(Prescription.id == rx_id)).first()
    if rx is None or rx.is_sandbox:
        raise not_found("Prescription")
    return rx


@router.get("/prescriptions", response_model=Page[PrescriptionOut])
def list_prescriptions(
    q: str | None = Query(None, max_length=100), status: PrescriptionStatus | None = None,
    patient_id: int | None = None, medication_id: int | None = None,
    params: PageParams = Depends(page_params), _: User = Depends(require("prescriptions:read")),
    db: Session = Depends(get_db),
):
    stmt = _rx_query().join(Prescription.patient).join(Prescription.medication).where(~Prescription.is_sandbox)
    if q and q.strip():
        t = f"%{q.strip()}%"
        stmt = stmt.where(or_(Prescription.rx_code.ilike(t), Medication.name.ilike(t), Patient.patient_code.ilike(t),
                              (Patient.first_name + " " + Patient.last_name).ilike(t)))
    if status:
        stmt = stmt.where(Prescription.status == status)
    if patient_id:
        stmt = stmt.where(Prescription.patient_id == patient_id)
    if medication_id:
        stmt = stmt.where(Prescription.medication_id == medication_id)
    stmt = apply_sort(stmt, params.sort, RX_SORTS, Prescription.id.desc())
    items, total = paginate(db, stmt, params)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.post("/prescriptions", response_model=PrescriptionDetail, status_code=201)
def create_prescription(body: PrescriptionCreate, user: User = Depends(require("prescriptions:write")),
                        db: Session = Depends(get_db)):
    patient = db.get(Patient, body.patient_id)
    if patient is None or patient.is_sandbox:
        raise unprocessable("Patient does not exist.", "patient_id", "INVALID_REFERENCE")
    if patient.status != PatientStatus.active:
        raise AppError(409, "PATIENT_INACTIVE", f"{patient.patient_code} is inactive; reactivate before prescribing.")
    med = db.get(Medication, body.medication_id)
    if med is None:
        raise unprocessable("Medication does not exist.", "medication_id", "INVALID_REFERENCE")
    if body.start_date < date(2000, 1, 1):
        raise unprocessable("Start date is too far in the past.", "start_date")
    dup = db.scalar(select(Prescription.rx_code).where(
        Prescription.patient_id == patient.id, Prescription.medication_id == med.id, ~Prescription.is_sandbox,
        Prescription.status.in_((PS.active, PS.refill_due, PS.on_hold))))
    if dup:
        raise AppError(409, "PRESCRIPTION_DUPLICATE",
                       f"{patient.patient_code} already has an active prescription for {med.name} ({dup}).")
    rx = Prescription(**body.model_dump(), refills_remaining=body.refills_authorized, created_by=user.id)
    db.add(rx)
    db.flush()
    audit(db, user, "create", "prescription", rx.id, {"patient": patient.patient_code, "medication": med.name,
                                                     "quantity": rx.quantity, "refills": rx.refills_authorized})
    db.commit()
    return get_rx(db, rx.id)


@router.get("/prescriptions/{rx_id}", response_model=PrescriptionDetail)
def read_prescription(rx_id: int, _: User = Depends(require("prescriptions:read")), db: Session = Depends(get_db)):
    return get_rx(db, rx_id)


@router.patch("/prescriptions/{rx_id}", response_model=PrescriptionDetail)
def update_prescription(rx_id: int, body: PrescriptionUpdate, user: User = Depends(require("prescriptions:write")),
                        db: Session = Depends(get_db)):
    rx = get_rx(db, rx_id)
    check_version(rx.updated_at, body.updated_at, "prescription")
    if rx.status in (PS.completed, PS.cancelled):
        raise AppError(409, "PRESCRIPTION_CLOSED", f"{rx.rx_code} is {rx.status.value} and can no longer be edited.")
    changes = body.model_dump(exclude_unset=True, exclude={"updated_at"})
    if "end_date" in changes and changes["end_date"] and changes["end_date"] < rx.start_date:
        raise unprocessable("end_date must be on or after start_date.", "end_date")
    before = {k: getattr(rx, k) for k in changes}
    for k, v in changes.items():
        setattr(rx, k, v)
    audit(db, user, "update", "prescription", rx.id, diff(before, changes))
    db.commit()
    db.expire_all()
    return get_rx(db, rx_id)


@router.post("/prescriptions/{rx_id}/status", response_model=PrescriptionDetail)
def change_prescription_status(rx_id: int, body: PrescriptionStatusChange,
                               user: User = Depends(require("prescriptions:write")), db: Session = Depends(get_db)):
    rx = get_rx(db, rx_id)
    if body.status not in RX_TRANSITIONS[rx.status]:
        raise AppError(409, "INVALID_TRANSITION",
                       f"Cannot change {rx.rx_code} from '{rx.status.value}' to '{body.status.value}'.")
    if body.status == PS.cancelled and not body.reason:
        raise unprocessable("A reason is required to cancel a prescription.", "reason")
    if body.status in (PS.cancelled, PS.completed):
        # Close any pending refill requests so they cannot be approved later.
        for r in db.scalars(select(RefillRequest).where(RefillRequest.prescription_id == rx.id,
                                                        RefillRequest.status == RefillStatus.pending)):
            r.status, r.reviewed_by = RefillStatus.cancelled, user.id
            r.reviewed_at = datetime.now(UTC)
    audit(db, user, "status_change", "prescription", rx.id,
          {"status": {"from": rx.status.value, "to": body.status.value}, "reason": body.reason})
    rx.status = body.status
    db.commit()
    db.expire_all()
    return get_rx(db, rx_id)


# ---------------- Refill requests ----------------
REFILL_SORTS = {"requested_at": RefillRequest.requested_at, "status": RefillRequest.status}


@router.get("/refill-requests", response_model=Page[RefillOut])
def list_refills(
    status: RefillStatus | None = None, prescription_id: int | None = None,
    q: str | None = Query(None, max_length=100),
    params: PageParams = Depends(page_params), _: User = Depends(require("refills:read")),
    db: Session = Depends(get_db),
):
    stmt = (select(RefillRequest).join(RefillRequest.prescription).join(Prescription.patient)
            .join(Prescription.medication).where(~RefillRequest.is_sandbox)
            .options(joinedload(RefillRequest.prescription).joinedload(Prescription.patient),
                     joinedload(RefillRequest.prescription).joinedload(Prescription.medication)))
    if status:
        stmt = stmt.where(RefillRequest.status == status)
    if prescription_id:
        stmt = stmt.where(RefillRequest.prescription_id == prescription_id)
    if q and q.strip():
        t = f"%{q.strip()}%"
        stmt = stmt.where(or_(Prescription.rx_code.ilike(t), Medication.name.ilike(t), Patient.patient_code.ilike(t),
                              (Patient.first_name + " " + Patient.last_name).ilike(t)))
    stmt = apply_sort(stmt, params.sort, REFILL_SORTS, RefillRequest.requested_at.desc())
    items, total = paginate(db, stmt, params)
    return Page(items=[refill_svc.serialize(db, r) for r in items], total=total, page=params.page,
                page_size=params.page_size)


@router.post("/refill-requests", response_model=RefillOut, status_code=201)
def submit_refill(body: RefillCreate, request: Request, response: Response,
                  idempotency_key: str | None = Header(None, max_length=64),
                  user: User = Depends(require("refills:submit")), db: Session = Depends(get_db)):
    refill, created = refill_svc.submit(db, user, body.prescription_id, body.notes, idempotency_key, request)
    db.commit()
    if not created:
        response.headers["Idempotent-Replay"] = "true"
    return refill_svc.serialize(db, refill_svc.load_refill(db, refill.id, request))


@router.post("/refill-requests/{refill_id}/approve", response_model=RefillOut)
def approve_refill(refill_id: int, request: Request, user: User = Depends(require("refills:review")),
                   db: Session = Depends(get_db)):
    return refill_svc.approve(db, user, refill_id, request)


@router.post("/refill-requests/{refill_id}/reject", response_model=RefillOut)
def reject_refill(refill_id: int, body: RefillReject, request: Request,
                  user: User = Depends(require("refills:review")), db: Session = Depends(get_db)):
    return refill_svc.reject(db, user, refill_id, body.reason, request)


@router.post("/refill-requests/{refill_id}/dispense", response_model=RefillOut)
def dispense_refill(refill_id: int, request: Request, user: User = Depends(require("refills:review")),
                    db: Session = Depends(get_db)):
    return refill_svc.dispense(db, user, refill_id, request)


@router.post("/refill-requests/{refill_id}/cancel", response_model=RefillOut)
def cancel_refill(refill_id: int, request: Request, user: User = Depends(require("refills:submit")),
                  db: Session = Depends(get_db)):
    return refill_svc.cancel(db, user, refill_id, request)
