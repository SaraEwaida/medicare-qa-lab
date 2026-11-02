from enum import StrEnum


class UserRole(StrEnum):
    pharmacist = "pharmacist"
    support_engineer = "support_engineer"
    qa_engineer = "qa_engineer"


class PatientStatus(StrEnum):
    active = "active"
    inactive = "inactive"


class PrescriptionStatus(StrEnum):
    active = "active"
    refill_due = "refill_due"
    on_hold = "on_hold"
    completed = "completed"
    cancelled = "cancelled"


class RefillStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    dispensed = "dispensed"
    cancelled = "cancelled"


class TicketCategory(StrEnum):
    login_access = "login_access"
    prescription = "prescription"
    refill = "refill"
    patient_data = "patient_data"
    performance = "performance"
    integration = "integration"
    other = "other"


class TicketPriority(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TicketStatus(StrEnum):
    open = "open"
    investigating = "investigating"
    escalated = "escalated"
    resolved = "resolved"
    closed = "closed"


class TestResultStatus(StrEnum):
    not_run = "not_run"
    passed = "passed"
    failed = "failed"
    blocked = "blocked"


class TestType(StrEnum):
    functional = "functional"
    regression = "regression"
    smoke = "smoke"
    api = "api"
    security = "security"
    usability = "usability"


class BugSeverity(StrEnum):
    critical = "critical"
    major = "major"
    minor = "minor"
    trivial = "trivial"


class Priority(StrEnum):
    p1 = "p1"
    p2 = "p2"
    p3 = "p3"
    p4 = "p4"


class BugStatus(StrEnum):
    new = "new"
    confirmed = "confirmed"
    in_progress = "in_progress"
    fixed = "fixed"
    verified = "verified"
    closed = "closed"
    wont_fix = "wont_fix"


class AutomationFramework(StrEnum):
    playwright = "playwright"
    pytest = "pytest"
    newman = "newman"
