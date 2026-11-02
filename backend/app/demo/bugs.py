"""Controlled defect injection for the Bug Lab.

A defect only fires when ALL of these hold:
  1. settings.demo_bugs_enabled is true (environment master switch),
  2. the defect's row in demo_bug_flags is enabled,
  3. the request carries an X-Demo-Session header (sent only by the Bug Lab UI), and
  4. the data being touched is sandbox data (is_sandbox = true).

Normal application paths therefore can never hit an injected defect, even if a flag is left on.
Every injection point is marked with `# DEMO-BUG:` so it can be found with grep.
"""

from dataclasses import dataclass

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import DemoBugFlag


@dataclass(frozen=True)
class DemoBug:
    key: str
    title: str
    description: str


CATALOG: tuple[DemoBug, ...] = (
    DemoBug("refill_status_stale", "Refill status fails to refresh after approval",
            "Approving a sandbox refill returns HTTP 200 but the response body still shows status 'pending'. "
            "The database is updated correctly, so the UI shows stale state until a manual reload."),
    DemoBug("refill_boundary_422", "Valid refill rejected with a validation error",
            "Submitting a refill for a prescription with exactly 1 refill remaining returns 422 "
            "NO_REFILLS_REMAINING. Off-by-one boundary check."),
    DemoBug("search_case_sensitive", "Patient search misses results with different letter case",
            "Searching sandbox patients for 'nora' returns nothing although 'Nora Haddad' exists. "
            "Search uses a case-sensitive comparison."),
    DemoBug("refill_double_submit", "Duplicate refill requests are created on double-click",
            "Rapidly submitting the same sandbox refill twice creates two pending requests. "
            "The duplicate check and the idempotency key are both bypassed."),
)
KEYS = {b.key for b in CATALOG}


def demo_session(request: Request | None) -> bool:
    return bool(request is not None and request.headers.get("x-demo-session"))


def bug_active(db: Session, request: Request | None, key: str, *, sandbox: bool) -> bool:
    if not (get_settings().demo_bugs_enabled and sandbox and demo_session(request)):
        return False
    flag = db.get(DemoBugFlag, key)
    return bool(flag and flag.is_enabled)


def ensure_flags(db: Session) -> None:
    """Insert catalog entries that are missing (idempotent)."""
    for bug in CATALOG:
        flag = db.get(DemoBugFlag, bug.key)
        if flag is None:
            db.add(DemoBugFlag(key=bug.key, title=bug.title, description=bug.description, is_enabled=False))
        else:
            flag.title, flag.description = bug.title, bug.description
