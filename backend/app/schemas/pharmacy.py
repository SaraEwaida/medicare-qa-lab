from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.enums import PatientStatus, PrescriptionStatus, RefillStatus
from app.schemas.common import ORM, text

PHONE_PATTERN = r"^\+?[0-9 ()-]{7,20}$"


def _check_dob(v: date | None) -> date | None:
    if v is None:
        return v
    if v > date.today():
        raise ValueError("Date of birth cannot be in the future.")
    if v <= date(1900, 1, 1):
        raise ValueError("Date of birth must be after 1900-01-01.")
    return v


class PatientCreate(BaseModel):
    first_name: text(1, 60)
    last_name: text(1, 60)
    date_of_birth: date
    email: EmailStr | None = None
    phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    address: text(0, 200) | None = None
    allergies: text(0, 1000) | None = None

    @field_validator("date_of_birth")
    @classmethod
    def dob_range(cls, v):
        return _check_dob(v)

    @field_validator("email", "phone", "address", "allergies", mode="before")
    @classmethod
    def blank_to_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class PatientUpdate(BaseModel):
    first_name: text(1, 60) | None = None
    last_name: text(1, 60) | None = None
    date_of_birth: date | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    address: text(0, 200) | None = None
    allergies: text(0, 1000) | None = None
    updated_at: datetime = Field(description="Value from the last read; used for optimistic concurrency.")

    @field_validator("date_of_birth")
    @classmethod
    def dob_range(cls, v):
        return _check_dob(v)

    @field_validator("email", "phone", "address", "allergies", mode="before")
    @classmethod
    def blank_to_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class PatientOut(ORM):
    id: int
    patient_code: str
    first_name: str
    last_name: str
    date_of_birth: date | None
    email: str | None
    phone: str | None
    address: str | None
    allergies: str | None
    status: PatientStatus
    created_at: datetime
    updated_at: datetime
    active_prescriptions: int = 0
    contact_masked: bool = False


class PatientRef(ORM):
    id: int
    patient_code: str
    first_name: str
    last_name: str


class MedicationOut(ORM):
    id: int
    name: str
    strength: str
    form: str
    is_controlled: bool


class PrescriptionCreate(BaseModel):
    patient_id: int
    medication_id: int
    prescriber_name: text(3, 120)
    dosage_instructions: text(3, 255)
    quantity: int = Field(ge=1, le=1000)
    refills_authorized: int = Field(ge=0, le=12)
    start_date: date
    end_date: date | None = None

    @model_validator(mode="after")
    def dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date.")
        return self


class PrescriptionUpdate(BaseModel):
    prescriber_name: text(3, 120) | None = None
    dosage_instructions: text(3, 255) | None = None
    end_date: date | None = None
    updated_at: datetime


class PrescriptionStatusChange(BaseModel):
    status: PrescriptionStatus
    reason: text(0, 255) | None = None


class RefillBrief(ORM):
    id: int
    status: RefillStatus
    requested_at: datetime
    reviewed_at: datetime | None
    rejection_reason: str | None
    notes: str | None


class PrescriptionOut(ORM):
    id: int
    rx_code: str
    patient: PatientRef
    medication: MedicationOut
    prescriber_name: str
    dosage_instructions: str
    quantity: int
    refills_authorized: int
    refills_remaining: int
    start_date: date
    end_date: date | None
    status: PrescriptionStatus
    created_at: datetime
    updated_at: datetime


class PrescriptionDetail(PrescriptionOut):
    refills: list[RefillBrief] = []


class RefillCreate(BaseModel):
    prescription_id: int
    notes: text(0, 500) | None = None


class RefillReject(BaseModel):
    reason: text(3, 255)


class RefillOut(ORM):
    id: int
    prescription_id: int
    rx_code: str
    patient: PatientRef
    medication: str
    status: RefillStatus
    refills_remaining: int
    requested_at: datetime
    requested_by: str | None
    reviewed_at: datetime | None
    reviewed_by: str | None
    rejection_reason: str | None
    notes: str | None
