"""Sandbox data used only by the Bug Lab. Every row has is_sandbox = true and is excluded from normal queries."""

from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Medication, Patient, Prescription, PrescriptionStatus, RefillRequest

SANDBOX_PATIENTS = [
    # first, last, dob
    ("Nora", "Haddad", date(1984, 3, 12)),
    ("Omar", "Khalil", date(1979, 11, 2)),
    ("Lina", "Nasser", date(1992, 6, 25)),
    ("Sami", "Barakat", date(1968, 1, 9)),
    ("Dana", "Saleh", date(2001, 9, 14)),
    ("Noor", "Hamdan", date(1990, 4, 30)),
]

# (patient index, medication name, refills_authorized, refills_remaining)
SANDBOX_RX = [
    (0, "Lisinopril", 5, 3),
    (1, "Metformin", 3, 1),  # exactly one refill left: boundary case for refill_boundary_422
    (2, "Atorvastatin", 4, 4),
    (3, "Levothyroxine", 6, 2),
    (4, "Amoxicillin", 2, 2),
    (5, "Omeprazole", 3, 1),
]


def reset_sandbox(db: Session) -> dict:
    sandbox_rx_ids = select(Prescription.id).where(Prescription.is_sandbox)
    db.execute(delete(RefillRequest).where(RefillRequest.prescription_id.in_(sandbox_rx_ids)))
    db.execute(delete(Prescription).where(Prescription.is_sandbox))
    db.execute(delete(Patient).where(Patient.is_sandbox))
    db.flush()

    patients = []
    for i, (first, last, dob) in enumerate(SANDBOX_PATIENTS):
        p = Patient(first_name=first, last_name=last, date_of_birth=dob, is_sandbox=True,
                    email=f"{first.lower()}.{last.lower()}@sandbox.example.com", phone=f"+970 59 000 00{i:02d}")
        db.add(p)
        patients.append(p)
    db.flush()

    meds = {m.name: m for m in db.scalars(select(Medication))}
    count = 0
    for idx, med_name, auth, remaining in SANDBOX_RX:
        med = meds.get(med_name)
        if med is None:
            continue
        db.add(Prescription(patient_id=patients[idx].id, medication_id=med.id, prescriber_name="Dr. Sandbox (fictional)",
                            dosage_instructions="1 tablet daily", quantity=30, refills_authorized=auth,
                            refills_remaining=remaining, start_date=date.today() - timedelta(days=60),
                            status=PrescriptionStatus.active, is_sandbox=True))
        count += 1
    db.flush()
    return {"patients": len(patients), "prescriptions": count}
