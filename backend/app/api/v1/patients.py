from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import PageParams, apply_sort, check_version, page_params, paginate
from app.core.errors import AppError, not_found
from app.core.redaction import mask_email, mask_phone
from app.core.security import require
from app.db.session import get_db
from app.models import Medication, Patient, PatientStatus, Prescription, PrescriptionStatus, User, UserRole
from app.schemas.common import Page
from app.schemas.pharmacy import MedicationOut, PatientCreate, PatientOut, PatientUpdate, PrescriptionOut
from app.services.audit import audit, diff

router = APIRouter(tags=["Patients"])

ACTIVE_RX = (PrescriptionStatus.active, PrescriptionStatus.refill_due, PrescriptionStatus.on_hold)
SORTS = {"patient_code": Patient.id, "last_name": func.lower(Patient.last_name), "created_at": Patient.created_at,
         "date_of_birth": Patient.date_of_birth, "status": Patient.status}


def search_filter(q: str, case_sensitive: bool = False):
    term = f"%{q.strip()}%"
    full = Patient.first_name + " " + Patient.last_name
    if case_sensitive:  # only reachable through the Bug Lab (see demo/bugs.py)
        return or_(Patient.patient_code.like(term), Patient.first_name.like(term), Patient.last_name.like(term),
                   full.like(term))
    return or_(Patient.patient_code.ilike(term), Patient.first_name.ilike(term), Patient.last_name.ilike(term),
               full.ilike(term), Patient.email.ilike(term), Patient.phone.ilike(term))


def active_rx_counts(db: Session, ids: list[int]) -> dict[int, int]:
    rows = db.execute(select(Prescription.patient_id, func.count()).where(
        Prescription.patient_id.in_(ids), Prescription.status.in_(ACTIVE_RX)).group_by(Prescription.patient_id))
    return dict(rows.all())


def to_out(db: Session, p: Patient, viewer: User, count: int | None = None) -> PatientOut:
    if count is None:
        count = active_rx_counts(db, [p.id]).get(p.id, 0)
    out = PatientOut.model_validate(p).model_copy(update={"active_prescriptions": count})
    if viewer.role != UserRole.pharmacist:
        # Minimum-necessary access: non-pharmacist roles see masked contact details only.
        out = out.model_copy(update={"email": mask_email(p.email), "phone": mask_phone(p.phone), "address": None,
                                     "allergies": None, "date_of_birth": None, "contact_masked": True})
    return out


def get_patient(db: Session, patient_id: int) -> Patient:
    p = db.get(Patient, patient_id)
    if p is None or p.is_sandbox:
        raise not_found("Patient")
    return p


@router.get("/patients", response_model=Page[PatientOut])
def list_patients(
    q: str | None = Query(None, max_length=100), status: PatientStatus | None = None,
    params: PageParams = Depends(page_params), user: User = Depends(require("patients:read")),
    db: Session = Depends(get_db),
):
    stmt = select(Patient).where(~Patient.is_sandbox)
    if q and q.strip():
        stmt = stmt.where(search_filter(q))
    if status:
        stmt = stmt.where(Patient.status == status)
    stmt = apply_sort(stmt, params.sort, SORTS, Patient.id.desc())
    items, total = paginate(db, stmt, params)
    counts = active_rx_counts(db, [p.id for p in items])
    return Page(items=[to_out(db, p, user, counts.get(p.id, 0)) for p in items], total=total, page=params.page, page_size=params.page_size)


@router.post("/patients", response_model=PatientOut, status_code=201)
def create_patient(body: PatientCreate, user: User = Depends(require("patients:write")), db: Session = Depends(get_db)):
    exists = db.scalar(select(Patient.patient_code).where(
        ~Patient.is_sandbox, func.lower(Patient.first_name) == body.first_name.lower(),
        func.lower(Patient.last_name) == body.last_name.lower(), Patient.date_of_birth == body.date_of_birth))
    if exists:
        raise AppError(409, "PATIENT_DUPLICATE", f"Patient already exists as {exists}.")
    p = Patient(**body.model_dump(), created_by=user.id)
    db.add(p)
    db.flush()
    audit(db, user, "create", "patient", p.id, body.model_dump(mode="json"))
    db.commit()
    db.refresh(p)
    return to_out(db, p, user)


@router.get("/patients/{patient_id}", response_model=PatientOut)
def read_patient(patient_id: int, user: User = Depends(require("patients:read")), db: Session = Depends(get_db)):
    return to_out(db, get_patient(db, patient_id), user)


@router.patch("/patients/{patient_id}", response_model=PatientOut)
def update_patient(patient_id: int, body: PatientUpdate, user: User = Depends(require("patients:write")),
                   db: Session = Depends(get_db)):
    p = get_patient(db, patient_id)
    check_version(p.updated_at, body.updated_at, "patient")
    changes = body.model_dump(exclude_unset=True, exclude={"updated_at"})
    before = {k: getattr(p, k) for k in changes}
    for k, v in changes.items():
        setattr(p, k, v)
    audit(db, user, "update", "patient", p.id, diff(before, changes))
    db.commit()
    db.refresh(p)
    return to_out(db, p, user)


@router.post("/patients/{patient_id}/deactivate", response_model=PatientOut)
def deactivate_patient(patient_id: int, user: User = Depends(require("patients:write")), db: Session = Depends(get_db)):
    p = get_patient(db, patient_id)
    if p.status == PatientStatus.inactive:
        raise AppError(409, "INVALID_TRANSITION", "Patient is already inactive.")
    active = db.scalar(select(func.count()).select_from(Prescription).where(
        Prescription.patient_id == p.id, Prescription.status.in_(ACTIVE_RX)))
    if active:
        raise AppError(409, "PATIENT_HAS_ACTIVE_RX",
                       f"Patient has {active} active prescription(s). Complete or cancel them first.")
    p.status = PatientStatus.inactive
    audit(db, user, "status_change", "patient", p.id, {"status": {"from": "active", "to": "inactive"}})
    db.commit()
    db.refresh(p)
    return to_out(db, p, user)


@router.post("/patients/{patient_id}/reactivate", response_model=PatientOut)
def reactivate_patient(patient_id: int, user: User = Depends(require("patients:write")), db: Session = Depends(get_db)):
    p = get_patient(db, patient_id)
    if p.status == PatientStatus.active:
        raise AppError(409, "INVALID_TRANSITION", "Patient is already active.")
    p.status = PatientStatus.active
    audit(db, user, "status_change", "patient", p.id, {"status": {"from": "inactive", "to": "active"}})
    db.commit()
    db.refresh(p)
    return to_out(db, p, user)


@router.get("/patients/{patient_id}/prescriptions", response_model=list[PrescriptionOut])
def patient_prescriptions(patient_id: int, _: User = Depends(require("prescriptions:read")),
                          db: Session = Depends(get_db)):
    get_patient(db, patient_id)
    return db.scalars(select(Prescription).where(Prescription.patient_id == patient_id)
                      .options(joinedload(Prescription.patient), joinedload(Prescription.medication))
                      .order_by(Prescription.start_date.desc())).all()


@router.get("/patients/{patient_id}/medication-history")
def medication_history(patient_id: int, _: User = Depends(require("prescriptions:read")),
                       db: Session = Depends(get_db)):
    """Chronological timeline of prescription and refill events."""
    get_patient(db, patient_id)
    events = []
    rxs = db.scalars(select(Prescription).where(Prescription.patient_id == patient_id)
                     .options(joinedload(Prescription.medication), joinedload(Prescription.refills))).unique().all()
    for rx in rxs:
        med = f"{rx.medication.name} {rx.medication.strength}"
        events.append({"at": rx.created_at, "type": "prescribed", "rx_code": rx.rx_code, "medication": med,
                       "detail": f"{rx.dosage_instructions} · qty {rx.quantity} · {rx.refills_authorized} refills"})
        for r in rx.refills:
            events.append({"at": r.requested_at, "type": "refill_requested", "rx_code": rx.rx_code, "medication": med,
                           "detail": "Refill requested"})
            if r.reviewed_at:
                events.append({"at": r.reviewed_at, "type": f"refill_{r.status.value}", "rx_code": rx.rx_code,
                               "medication": med, "detail": r.rejection_reason or f"Refill {r.status.value}"})
    events.sort(key=lambda e: e["at"], reverse=True)
    return events


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(q: str | None = Query(None, max_length=60), _: User = Depends(require("prescriptions:read")),
                     db: Session = Depends(get_db)):
    stmt = select(Medication).order_by(Medication.name, Medication.strength)
    if q:
        stmt = stmt.where(Medication.name.ilike(f"%{q}%"))
    return db.scalars(stmt.limit(100)).all()
