from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import BugSeverity, Priority, TicketCategory, TicketPriority, TicketStatus
from app.schemas.common import ORM, UserRef, text


class TicketCreate(BaseModel):
    subject: text(5, 160)
    description: text(10, 5000)
    category: TicketCategory
    priority: TicketPriority = TicketPriority.medium
    reporter_name: text(2, 120)
    reporter_email: EmailStr | None = None
    browser: text(0, 80) | None = None
    os: text(0, 80) | None = None
    app_version: text(0, 20) | None = None
    related_request_id: text(0, 40) | None = None
    diagnostic_notes: text(0, 5000) | None = None
    patient_id: int | None = None
    prescription_id: int | None = None


class TicketUpdate(BaseModel):
    priority: TicketPriority | None = None
    category: TicketCategory | None = None
    diagnostic_notes: text(0, 5000) | None = None
    related_request_id: text(0, 40) | None = None


class TicketAssign(BaseModel):
    assignee_id: int | None


class TicketStatusChange(BaseModel):
    status: TicketStatus
    note: text(0, 2000) | None = None
    resolution: text(0, 5000) | None = None


class NoteCreate(BaseModel):
    body: text(1, 5000)
    is_internal: bool = True


class NoteOut(ORM):
    id: int
    body: str
    is_internal: bool
    author: UserRef
    created_at: datetime


class EventOut(ORM):
    id: int
    event_type: str
    from_value: str | None
    to_value: str | None
    actor: UserRef | None
    created_at: datetime


class TicketOut(ORM):
    id: int
    ticket_code: str
    subject: str
    category: TicketCategory
    priority: TicketPriority
    status: TicketStatus
    reporter_name: str
    assignee: UserRef | None
    created_at: datetime
    updated_at: datetime


class TicketDetail(TicketOut):
    description: str
    reporter_email: str | None
    browser: str | None
    os: str | None
    app_version: str | None
    related_request_id: str | None
    diagnostic_notes: str | None
    patient_id: int | None
    prescription_id: int | None
    resolution: str | None
    resolved_at: datetime | None
    closed_at: datetime | None
    creator: UserRef | None
    notes: list[NoteOut] = []
    events: list[EventOut] = []
    linked_bugs: list[dict] = []


class ConvertToBug(BaseModel):
    title: text(5, 200) | None = None
    severity: BugSeverity = BugSeverity.major
    priority: Priority = Priority.p2
    steps_to_reproduce: text(5, 5000) | None = None
    expected_behavior: text(3, 2000) | None = None
    actual_behavior: text(3, 2000) | None = None


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class MeOut(UserOut):
    permissions: list[str]
