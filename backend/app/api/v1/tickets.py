from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import PageParams, apply_sort, page_params, paginate
from app.core.errors import AppError, not_found, unprocessable
from app.core.permissions import has_permission
from app.core.security import get_current_user, require
from app.db.session import get_db
from app.models import (
    BugReport, Patient, Prescription, SupportTicket, TicketCategory, TicketNote, TicketPriority, TicketStatus, User,
)
from app.schemas.common import Page
from app.schemas.qa import BugOut
from app.schemas.support import (
    ConvertToBug, NoteCreate, NoteOut, TicketAssign, TicketCreate, TicketDetail, TicketOut, TicketStatusChange,
    TicketUpdate,
)
from app.services.audit import audit, diff
from app.services.tickets import add_event, change_status

router = APIRouter(tags=["Support tickets"])

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
SORTS = {"created_at": SupportTicket.created_at, "updated_at": SupportTicket.updated_at,
         "priority": SupportTicket.priority, "status": SupportTicket.status, "ticket_code": SupportTicket.id}


def _can_see_all(user: User) -> bool:
    return has_permission(user.role, "tickets:read_all")


def load_ticket(db: Session, ticket_id: int, user: User) -> SupportTicket:
    t = db.scalars(select(SupportTicket).where(SupportTicket.id == ticket_id).options(
        joinedload(SupportTicket.assignee), joinedload(SupportTicket.creator))).first()
    # Users without read_all only see tickets they created; others get 404 (no existence leak).
    if t is None or (not _can_see_all(user) and t.created_by != user.id):
        raise not_found("Ticket")
    return t


def detail(db: Session, t: SupportTicket, user: User) -> TicketDetail:
    show_internal = has_permission(user.role, "tickets:notes_read")
    notes = [n for n in t.notes if show_internal or not n.is_internal]
    bugs = db.scalars(select(BugReport).where(BugReport.source_ticket_id == t.id)).all()
    out = TicketDetail.model_validate(t).model_copy(update={
        "notes": [NoteOut.model_validate(n) for n in notes],
        "linked_bugs": [{"id": b.id, "bug_code": b.bug_code, "title": b.title, "status": b.status.value} for b in bugs],
    })
    if not show_internal:
        out = out.model_copy(update={"diagnostic_notes": None})
    return out


@router.get("/tickets", response_model=Page[TicketOut])
def list_tickets(
    q: str | None = Query(None, max_length=100), status: list[TicketStatus] | None = Query(None),
    priority: TicketPriority | None = None, category: TicketCategory | None = None,
    assignee_id: int | None = None, unassigned: bool = False,
    params: PageParams = Depends(page_params), user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    stmt = select(SupportTicket).options(joinedload(SupportTicket.assignee))
    if not _can_see_all(user):
        stmt = stmt.where(SupportTicket.created_by == user.id)
    if q and q.strip():
        t = f"%{q.strip()}%"
        stmt = stmt.where(or_(SupportTicket.ticket_code.ilike(t), SupportTicket.subject.ilike(t),
                              SupportTicket.reporter_name.ilike(t), SupportTicket.related_request_id.ilike(t)))
    if status:
        stmt = stmt.where(SupportTicket.status.in_(status))
    if priority:
        stmt = stmt.where(SupportTicket.priority == priority)
    if category:
        stmt = stmt.where(SupportTicket.category == category)
    if assignee_id:
        stmt = stmt.where(SupportTicket.assignee_id == assignee_id)
    if unassigned:
        stmt = stmt.where(SupportTicket.assignee_id.is_(None))
    stmt = apply_sort(stmt, params.sort, SORTS, SupportTicket.created_at.desc())
    items, total = paginate(db, stmt, params)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.post("/tickets", response_model=TicketDetail, status_code=201)
def create_ticket(body: TicketCreate, user: User = Depends(require("tickets:create")), db: Session = Depends(get_db)):
    if body.patient_id is not None:
        p = db.get(Patient, body.patient_id)
        if p is None or p.is_sandbox:
            raise unprocessable("Patient does not exist.", "patient_id", "INVALID_REFERENCE")
    if body.prescription_id is not None:
        rx = db.get(Prescription, body.prescription_id)
        if rx is None or rx.is_sandbox:
            raise unprocessable("Prescription does not exist.", "prescription_id", "INVALID_REFERENCE")
    t = SupportTicket(**body.model_dump(), created_by=user.id)
    db.add(t)
    db.flush()
    add_event(db, t, user, "created", None, TicketStatus.open.value)
    audit(db, user, "create", "support_ticket", t.ticket_code,
          {"category": body.category.value, "priority": body.priority.value})
    db.commit()
    return detail(db, load_ticket(db, t.id, user), user)


@router.get("/tickets/{ticket_id}", response_model=TicketDetail)
def read_ticket(ticket_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return detail(db, load_ticket(db, ticket_id, user), user)


@router.patch("/tickets/{ticket_id}", response_model=TicketDetail)
def update_ticket(ticket_id: int, body: TicketUpdate, user: User = Depends(require("tickets:manage")),
                  db: Session = Depends(get_db)):
    t = load_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise AppError(409, "TICKET_CLOSED", "Closed tickets cannot be edited.")
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(t, k) for k in changes}
    for k, v in changes.items():
        setattr(t, k, v)
    if "priority" in changes and before["priority"] != changes["priority"]:
        add_event(db, t, user, "priority_changed", before["priority"].value, changes["priority"].value)
    audit(db, user, "update", "support_ticket", t.ticket_code, diff(
        {k: str(v) for k, v in before.items()}, {k: str(v) for k, v in changes.items()}))
    db.commit()
    return detail(db, load_ticket(db, ticket_id, user), user)


@router.post("/tickets/{ticket_id}/assign", response_model=TicketDetail)
def assign_ticket(ticket_id: int, body: TicketAssign, user: User = Depends(require("tickets:manage")),
                  db: Session = Depends(get_db)):
    t = load_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise AppError(409, "TICKET_CLOSED", "Closed tickets cannot be reassigned.")
    new = None
    if body.assignee_id is not None:
        new = db.get(User, body.assignee_id)
        if new is None or not new.is_active or not has_permission(new.role, "tickets:read_all"):
            raise unprocessable("Assignee must be an active support or QA engineer.", "assignee_id")
    old_name = t.assignee.full_name if t.assignee else None
    t.assignee_id = new.id if new else None
    add_event(db, t, user, "assigned", old_name, new.full_name if new else None)
    audit(db, user, "update", "support_ticket", t.ticket_code, {"assignee": {"from": old_name, "to": new and new.full_name}})
    db.commit()
    db.expire_all()
    return detail(db, load_ticket(db, ticket_id, user), user)


@router.post("/tickets/{ticket_id}/status", response_model=TicketDetail)
def ticket_status(ticket_id: int, body: TicketStatusChange, user: User = Depends(require("tickets:manage")),
                  db: Session = Depends(get_db)):
    t = load_ticket(db, ticket_id, user)
    change_status(db, user, t, body.status, body.note, body.resolution)
    db.commit()
    db.expire_all()
    return detail(db, load_ticket(db, ticket_id, user), user)


@router.post("/tickets/{ticket_id}/notes", response_model=NoteOut, status_code=201)
def add_note(ticket_id: int, body: NoteCreate, user: User = Depends(require("tickets:manage")),
             db: Session = Depends(get_db)):
    t = load_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise AppError(409, "TICKET_CLOSED", "Closed tickets cannot receive new notes.")
    note = TicketNote(ticket_id=t.id, author_id=user.id, body=body.body, is_internal=body.is_internal)
    db.add(note)
    add_event(db, t, user, "note_added", None, "internal" if body.is_internal else "public")
    db.commit()
    db.refresh(note)
    return note


@router.post("/tickets/{ticket_id}/convert-to-bug", response_model=BugOut, status_code=201)
def convert_to_bug(ticket_id: int, body: ConvertToBug, user: User = Depends(require("tickets:convert")),
                   db: Session = Depends(get_db)):
    """Turn a customer-reported issue into an engineering bug report, pre-filled from the ticket."""
    t = load_ticket(db, ticket_id, user)
    env = " / ".join(x for x in (t.browser, t.os, f"app {t.app_version}" if t.app_version else None) if x) or "Production"
    evidence = [{"type": "ticket", "ref": t.ticket_code}]
    if t.related_request_id:
        evidence.append({"type": "log", "request_id": t.related_request_id})
    bug = BugReport(
        title=body.title or t.subject,
        description=f"Reported by customer via {t.ticket_code}.\n\n{t.description}",
        environment=env[:120],
        preconditions=f"Ticket category: {t.category.value}",
        steps_to_reproduce=body.steps_to_reproduce or f"See {t.ticket_code} for customer-reported steps; "
                                                       "confirm reproduction in staging.",
        expected_behavior=body.expected_behavior or "To be confirmed during triage.",
        actual_behavior=body.actual_behavior or t.description[:2000],
        severity=body.severity, priority=body.priority, source_ticket_id=t.id, evidence=evidence,
        reported_by=user.id,
    )
    db.add(bug)
    db.flush()
    add_event(db, t, user, "converted_to_bug", None, bug.bug_code)
    audit(db, user, "create", "bug_report", bug.bug_code, {"source_ticket": t.ticket_code})
    db.commit()
    from app.api.v1.qa import bug_out
    return bug_out(db, bug)
