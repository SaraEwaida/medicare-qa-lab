"""Pure unit tests: no database or HTTP."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.permissions import has_permission, permissions_for
from app.core.redaction import REDACTED, mask_email, mask_phone, redact, redact_text
from app.models import TestResultStatus, TicketStatus, UserRole
from app.schemas.pharmacy import PatientCreate, PrescriptionCreate
from app.schemas.qa import ResultUpdate
from app.services.qa_metrics import run_stats
from app.services.tickets import TRANSITIONS


class R:  # minimal stand-in for TestRunResult
    def __init__(self, status):
        self.status = status


def test_redact_masks_sensitive_keys_recursively():
    data = {"first_name": "Nora", "nested": {"phone": "+970 59 123 4567", "ok": 1}, "list": [{"email": "a@b.com"}]}
    out = redact(data)
    assert out["first_name"] == REDACTED
    assert out["nested"] == {"phone": REDACTED, "ok": 1}
    assert out["list"][0]["email"] == REDACTED


def test_redact_text_scrubs_emails_phones_and_tokens():
    s = "user nora@example.com called +970 59 123 4567 with Bearer abc.def.ghi"
    out = redact_text(s)
    assert "nora@example.com" not in out and "4567" not in out and "abc.def" not in out


def test_redact_keeps_none_for_missing_sensitive_values():
    assert redact({"email": None}) == {"email": None}


def test_masking_helpers():
    assert mask_email("layla@example.com") == "l***@example.com"
    assert mask_phone("+970 59 123 4567") == "***-***-4567"
    assert mask_email(None) is None


@pytest.mark.parametrize("role,perm,allowed", [
    (UserRole.pharmacist, "refills:review", True),
    (UserRole.support_engineer, "refills:review", False),
    (UserRole.qa_engineer, "refills:review", False),
    (UserRole.support_engineer, "tickets:manage", True),
    (UserRole.qa_engineer, "tickets:manage", False),
    (UserRole.qa_engineer, "demo:manage", True),
    (UserRole.pharmacist, "logs:read", False),
    (UserRole.pharmacist, "unknown:permission", False),
])
def test_permission_matrix(role, perm, allowed):
    assert has_permission(role, perm) is allowed


def test_permissions_for_is_sorted_and_role_specific():
    p = permissions_for(UserRole.pharmacist)
    assert p == sorted(p) and "patients:write" in p and "qa:write" not in p


def test_ticket_transitions_closed_is_terminal_and_open_cannot_resolve():
    assert TRANSITIONS[TicketStatus.closed] == set()
    assert TicketStatus.resolved not in TRANSITIONS[TicketStatus.open]
    assert TicketStatus.investigating in TRANSITIONS[TicketStatus.resolved]  # reopen


def test_run_stats_pass_rate_excludes_not_run():
    s = run_stats([R(TestResultStatus.passed), R(TestResultStatus.failed), R(TestResultStatus.blocked),
                   R(TestResultStatus.not_run)])
    assert s["executed"] == 3 and s["pass_rate"] == 33.3 and s["progress"] == 75.0


def test_run_stats_empty_run():
    assert run_stats([])["pass_rate"] is None


def test_failed_result_requires_actual_result():
    with pytest.raises(ValidationError):
        ResultUpdate(status="failed")
    assert ResultUpdate(status="failed", actual_result="Error 500").status == TestResultStatus.failed


@pytest.mark.parametrize("dob,ok", [("2999-01-01", False), ("1899-12-31", False), ("1985-06-14", True)])
def test_patient_dob_validation(dob, ok):
    body = {"first_name": "A", "last_name": "B", "date_of_birth": dob}
    if ok:
        PatientCreate(**body)
    else:
        with pytest.raises(ValidationError):
            PatientCreate(**body)


@pytest.mark.parametrize("qty,ok", [(0, False), (1, True), (1000, True), (1001, False)])
def test_tc015_prescription_quantity_boundaries_schema(qty, ok):
    body = {"patient_id": 1, "medication_id": 1, "prescriber_name": "Dr. X", "dosage_instructions": "daily",
            "quantity": qty, "refills_authorized": 1, "start_date": "2026-01-01"}
    if ok:
        PrescriptionCreate(**body)
    else:
        with pytest.raises(ValidationError):
            PrescriptionCreate(**body)


def test_database_url_normalization():
    assert Settings(database_url="postgres://u:p@h/db").database_url.startswith("postgresql+psycopg://")
    assert Settings(database_url="postgresql://u:p@h/db").database_url.startswith("postgresql+psycopg://")
