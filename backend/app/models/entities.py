"""SQLAlchemy models. The Alembic migration in alembic/versions is generated from these."""

from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Integer,
    Sequence, SmallInteger, String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import (
    AutomationFramework, BugSeverity, BugStatus, PatientStatus, PrescriptionStatus, Priority, RefillStatus,
    TestResultStatus, TestType, TicketCategory, TicketPriority, TicketStatus, UserRole,
)


def enum_col(enum_cls: type[StrEnum], name: str) -> SAEnum:
    """Store enums as VARCHAR + named CHECK constraint (easier migrations than native PG enums)."""
    return SAEnum(
        enum_cls, native_enum=False, create_constraint=True, length=30, name=name,
        values_callable=lambda e: [m.value for m in e], validate_strings=True,
    )


def ts_created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def ts_updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


# Business identifier sequences (created explicitly in the migration).
patient_code_seq = Sequence("patient_code_seq", start=1001, metadata=Base.metadata)
rx_code_seq = Sequence("rx_code_seq", start=5001, metadata=Base.metadata)
ticket_code_seq = Sequence("ticket_code_seq", start=1001, metadata=Base.metadata)
test_code_seq = Sequence("test_code_seq", start=1, metadata=Base.metadata)
bug_code_seq = Sequence("bug_code_seq", start=1, metadata=Base.metadata)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)  # stored lower-case
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[UserRole] = mapped_column(enum_col(UserRole, "user_role"), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_code: Mapped[str] = mapped_column(
        String(12), unique=True, nullable=False, server_default=text("'P-' || nextval('patient_code_seq')"))
    first_name: Mapped[str] = mapped_column(String(60), nullable=False)
    last_name: Mapped[str] = mapped_column(String(60), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(200))
    allergies: Mapped[str | None] = mapped_column(Text)
    status: Mapped[PatientStatus] = mapped_column(
        enum_col(PatientStatus, "patient_status"), nullable=False, server_default=PatientStatus.active.value)
    is_sandbox: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()

    prescriptions: Mapped[list["Prescription"]] = relationship(back_populates="patient")

    __table_args__ = (
        CheckConstraint("length(trim(first_name)) > 0", name="first_name_not_blank"),
        CheckConstraint("length(trim(last_name)) > 0", name="last_name_not_blank"),
        CheckConstraint("date_of_birth > DATE '1900-01-01' AND date_of_birth <= CURRENT_DATE", name="dob_range"),
        CheckConstraint(r"phone IS NULL OR phone ~ '^\+?[0-9 ()-]{7,20}$'", name="phone_format"),
        Index("uq_patient_identity", func.lower(text("first_name")), func.lower(text("last_name")), "date_of_birth",
              unique=True, postgresql_where=text("NOT is_sandbox")),
        Index("ix_patients_name", func.lower(text("last_name")), func.lower(text("first_name"))),
        Index("ix_patients_status", "status"),
    )


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    strength: Mapped[str] = mapped_column(String(40), nullable=False)
    form: Mapped[str] = mapped_column(String(40), nullable=False)
    is_controlled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    __table_args__ = (UniqueConstraint("name", "strength", "form", name="uq_medication_identity"),)


class Prescription(Base):
    __tablename__ = "prescriptions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rx_code: Mapped[str] = mapped_column(
        String(12), unique=True, nullable=False, server_default=text("'RX-' || nextval('rx_code_seq')"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False, index=True)
    medication_id: Mapped[int] = mapped_column(ForeignKey("medications.id", ondelete="RESTRICT"), nullable=False)
    prescriber_name: Mapped[str] = mapped_column(String(120), nullable=False)
    dosage_instructions: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    refills_authorized: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    refills_remaining: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[PrescriptionStatus] = mapped_column(
        enum_col(PrescriptionStatus, "prescription_status"), nullable=False,
        server_default=PrescriptionStatus.active.value, index=True)
    is_sandbox: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()

    patient: Mapped[Patient] = relationship(back_populates="prescriptions")
    medication: Mapped[Medication] = relationship()
    refills: Mapped[list["RefillRequest"]] = relationship(
        back_populates="prescription", order_by="RefillRequest.requested_at.desc()")

    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 1000", name="quantity_range"),
        CheckConstraint("refills_authorized BETWEEN 0 AND 12", name="refills_authorized_range"),
        CheckConstraint("refills_remaining BETWEEN 0 AND refills_authorized", name="refills_remaining_range"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="end_after_start"),
        Index("uq_active_rx_per_med", "patient_id", "medication_id", unique=True,
              postgresql_where=text("status IN ('active', 'refill_due', 'on_hold') AND NOT is_sandbox")),
    )


class RefillRequest(Base):
    __tablename__ = "refill_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    prescription_id: Mapped[int] = mapped_column(
        ForeignKey("prescriptions.id", ondelete="RESTRICT"), nullable=False, index=True)
    status: Mapped[RefillStatus] = mapped_column(
        enum_col(RefillStatus, "refill_status"), nullable=False, server_default=RefillStatus.pending.value)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(String(500))
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    is_sandbox: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    prescription: Mapped[Prescription] = relationship(back_populates="refills")

    __table_args__ = (
        CheckConstraint("status <> 'rejected' OR rejection_reason IS NOT NULL", name="rejection_needs_reason"),
        CheckConstraint("(status = 'pending') = (reviewed_at IS NULL)", name="pending_not_reviewed"),
        Index("uq_one_pending_refill", "prescription_id", unique=True,
              postgresql_where=text("status = 'pending' AND NOT is_sandbox")),
        Index("ix_refills_status_requested", "status", "requested_at"),
    )


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_code: Mapped[str] = mapped_column(
        String(12), unique=True, nullable=False, server_default=text("'SUP-' || nextval('ticket_code_seq')"))
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[TicketCategory] = mapped_column(enum_col(TicketCategory, "ticket_category"), nullable=False)
    priority: Mapped[TicketPriority] = mapped_column(
        enum_col(TicketPriority, "ticket_priority"), nullable=False, server_default=TicketPriority.medium.value)
    status: Mapped[TicketStatus] = mapped_column(
        enum_col(TicketStatus, "ticket_status"), nullable=False, server_default=TicketStatus.open.value)
    reporter_name: Mapped[str] = mapped_column(String(120), nullable=False)
    reporter_email: Mapped[str | None] = mapped_column(String(254))
    browser: Mapped[str | None] = mapped_column(String(80))
    os: Mapped[str | None] = mapped_column(String(80))
    app_version: Mapped[str | None] = mapped_column(String(20))
    related_request_id: Mapped[str | None] = mapped_column(String(40))
    diagnostic_notes: Mapped[str | None] = mapped_column(Text)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id", ondelete="SET NULL"))
    prescription_id: Mapped[int | None] = mapped_column(ForeignKey("prescriptions.id", ondelete="SET NULL"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()

    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    creator: Mapped[User | None] = relationship(foreign_keys=[created_by])
    notes: Mapped[list["TicketNote"]] = relationship(back_populates="ticket", order_by="TicketNote.created_at")
    events: Mapped[list["TicketEvent"]] = relationship(back_populates="ticket", order_by="TicketEvent.created_at")

    __table_args__ = (
        CheckConstraint("length(trim(subject)) >= 5", name="subject_min_length"),
        CheckConstraint("status NOT IN ('resolved', 'closed') OR resolution IS NOT NULL", name="resolution_required"),
        Index("ix_tickets_status_priority", "status", "priority"),
    )


class TicketNote(Base):
    __tablename__ = "ticket_notes"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = ts_created()

    ticket: Mapped[SupportTicket] = relationship(back_populates="notes")
    author: Mapped[User] = relationship()
    __table_args__ = (CheckConstraint("length(trim(body)) > 0", name="body_not_blank"),)


class TicketEvent(Base):
    __tablename__ = "ticket_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    from_value: Mapped[str | None] = mapped_column(String(60))
    to_value: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = ts_created()

    ticket: Mapped[SupportTicket] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship()


class TestCase(Base):
    __tablename__ = "test_cases"
    __test__ = False  # not a pytest class
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_code: Mapped[str] = mapped_column(
        String(12), unique=True, nullable=False,
        server_default=text("'TC-' || lpad(nextval('test_code_seq')::text, 3, '0')"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    type: Mapped[TestType] = mapped_column(
        enum_col(TestType, "test_type"), nullable=False, server_default=TestType.functional.value)
    priority: Mapped[Priority] = mapped_column(
        enum_col(Priority, "test_priority"), nullable=False, server_default=Priority.p2.value)
    preconditions: Mapped[str | None] = mapped_column(Text)
    expected_result: Mapped[str] = mapped_column(Text, nullable=False)
    is_automated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    automation_ref: Mapped[str | None] = mapped_column(String(200))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()

    steps: Mapped[list["TestCaseStep"]] = relationship(
        back_populates="test_case", order_by="TestCaseStep.step_number", cascade="all, delete-orphan")


class TestCaseStep(Base):
    __tablename__ = "test_case_steps"
    __test__ = False
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=False)
    step_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    expected: Mapped[str | None] = mapped_column(Text)
    test_case: Mapped[TestCase] = relationship(back_populates="steps")
    __table_args__ = (
        UniqueConstraint("test_case_id", "step_number", name="uq_step_number"),
        CheckConstraint("step_number > 0", name="step_positive"),
    )


class TestRun(Base):
    __tablename__ = "test_runs"
    __test__ = False
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    run_type: Mapped[TestType] = mapped_column(
        enum_col(TestType, "run_type"), nullable=False, server_default=TestType.functional.value)
    environment: Mapped[str] = mapped_column(String(40), nullable=False, server_default="local")
    build_version: Mapped[str | None] = mapped_column(String(40))
    started_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = ts_created()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    starter: Mapped[User | None] = relationship()
    results: Mapped[list["TestRunResult"]] = relationship(back_populates="run", order_by="TestRunResult.id")


class TestRunResult(Base):
    __tablename__ = "test_run_results"
    __test__ = False
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    test_run_id: Mapped[int] = mapped_column(ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=False)
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_cases.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[TestResultStatus] = mapped_column(
        enum_col(TestResultStatus, "result_status"), nullable=False, server_default=TestResultStatus.not_run.value)
    actual_result: Mapped[str | None] = mapped_column(Text)
    executed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    run: Mapped[TestRun] = relationship(back_populates="results")
    test_case: Mapped[TestCase] = relationship()
    __table_args__ = (
        UniqueConstraint("test_run_id", "test_case_id", name="uq_run_case"),
        CheckConstraint("status <> 'failed' OR actual_result IS NOT NULL", name="failed_needs_actual"),
        CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="duration_positive"),
    )


class BugReport(Base):
    __tablename__ = "bug_reports"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bug_code: Mapped[str] = mapped_column(
        String(12), unique=True, nullable=False,
        server_default=text("'BUG-' || lpad(nextval('bug_code_seq')::text, 3, '0')"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    environment: Mapped[str] = mapped_column(String(120), nullable=False)
    preconditions: Mapped[str | None] = mapped_column(Text)
    steps_to_reproduce: Mapped[str] = mapped_column(Text, nullable=False)
    expected_behavior: Mapped[str] = mapped_column(Text, nullable=False)
    actual_behavior: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[BugSeverity] = mapped_column(enum_col(BugSeverity, "bug_severity"), nullable=False)
    priority: Mapped[Priority] = mapped_column(enum_col(Priority, "bug_priority"), nullable=False)
    status: Mapped[BugStatus] = mapped_column(
        enum_col(BugStatus, "bug_status"), nullable=False, server_default=BugStatus.new.value)
    root_cause: Mapped[str | None] = mapped_column(Text)
    fix_notes: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    source_ticket_id: Mapped[int | None] = mapped_column(ForeignKey("support_tickets.id", ondelete="SET NULL"))
    source_result_id: Mapped[int | None] = mapped_column(ForeignKey("test_run_results.id", ondelete="SET NULL"))
    regression_case_id: Mapped[int | None] = mapped_column(ForeignKey("test_cases.id", ondelete="SET NULL"))
    demo_bug_key: Mapped[str | None] = mapped_column(String(40))
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()

    source_ticket: Mapped[SupportTicket | None] = relationship()
    regression_case: Mapped[TestCase | None] = relationship()
    reporter: Mapped[User | None] = relationship(foreign_keys=[reported_by])
    __table_args__ = (
        CheckConstraint("status NOT IN ('verified', 'closed') OR root_cause IS NOT NULL", name="root_cause_required"),
        Index("ix_bugs_status_severity", "status", "severity"),
    )


class AutomationRun(Base):
    __tablename__ = "automation_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    framework: Mapped[AutomationFramework] = mapped_column(
        enum_col(AutomationFramework, "automation_framework"), nullable=False)
    suite_name: Mapped[str] = mapped_column(String(120), nullable=False)
    commit_sha: Mapped[str | None] = mapped_column(String(40))
    branch: Mapped[str | None] = mapped_column(String(120))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    passed: Mapped[int] = mapped_column(Integer, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, nullable=False)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts_created()

    results: Mapped[list["AutomationResult"]] = relationship(back_populates="run", order_by="AutomationResult.id")
    __table_args__ = (
        CheckConstraint("passed + failed + skipped = total", name="totals_add_up"),
        CheckConstraint("total >= 0 AND passed >= 0 AND failed >= 0 AND skipped >= 0 AND duration_ms >= 0",
                        name="non_negative"),
    )


class AutomationResult(Base):
    __tablename__ = "automation_results"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    automation_run_id: Mapped[int] = mapped_column(
        ForeignKey("automation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    test_name: Mapped[str] = mapped_column(String(300), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    test_case_id: Mapped[int | None] = mapped_column(ForeignKey("test_cases.id", ondelete="SET NULL"))

    run: Mapped[AutomationRun] = relationship(back_populates="results")
    test_case: Mapped[TestCase | None] = relationship()
    __table_args__ = (CheckConstraint("status IN ('passed', 'failed', 'skipped')", name="status_valid"),)


class DemoBugFlag(Base):
    __tablename__ = "demo_bug_flags"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = ts_updated()


class AppLog(Base):
    __tablename__ = "app_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(40), index=True)
    method: Mapped[str | None] = mapped_column(String(8))
    path: Mapped[str | None] = mapped_column(String(300))
    status_code: Mapped[int | None] = mapped_column(SmallInteger)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    user_role: Mapped[str | None] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    __table_args__ = (
        CheckConstraint("level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR')", name="level_valid"),
        Index("ix_app_logs_status_ts", "status_code", "ts"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(40))
    request_id: Mapped[str | None] = mapped_column(String(40))
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    actor: Mapped[User | None] = relationship()
    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id", "ts"),)
