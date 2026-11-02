from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.errors import AppError, unprocessable
from app.models import SupportTicket, TicketEvent, TicketNote, TicketStatus, User
from app.services.audit import audit

T = TicketStatus
TRANSITIONS: dict[TicketStatus, set[TicketStatus]] = {
    T.open: {T.investigating, T.escalated},
    T.investigating: {T.escalated, T.resolved},
    T.escalated: {T.investigating, T.resolved},
    T.resolved: {T.closed, T.investigating},  # resolved -> investigating = reopen
    T.closed: set(),
}


def add_event(db: Session, ticket: SupportTicket, actor: User | None, event_type: str,
              from_value: str | None = None, to_value: str | None = None) -> None:
    db.add(TicketEvent(ticket_id=ticket.id, actor_id=actor.id if actor else None, event_type=event_type,
                       from_value=from_value, to_value=to_value))


def change_status(db: Session, user: User, ticket: SupportTicket, to: TicketStatus,
                  note: str | None, resolution: str | None) -> None:
    current = ticket.status
    if to == current:
        raise AppError(409, "INVALID_TRANSITION", f"Ticket is already '{to.value}'.")
    if to not in TRANSITIONS[current]:
        allowed = ", ".join(sorted(s.value for s in TRANSITIONS[current])) or "none"
        raise AppError(409, "INVALID_TRANSITION",
                       f"Cannot move a ticket from '{current.value}' to '{to.value}'. Allowed: {allowed}.")
    if to == T.escalated and not note:
        raise unprocessable("An escalation note is required.", "note")
    if to == T.resolved and not (resolution or ticket.resolution):
        raise unprocessable("A resolution is required to resolve a ticket.", "resolution")

    now = datetime.now(UTC)
    if to == T.resolved:
        ticket.resolution = resolution or ticket.resolution
        ticket.resolved_at = now
    if to == T.closed:
        ticket.closed_at = now
    if to == T.investigating and current == T.resolved:
        ticket.resolved_at = None
    if to == T.investigating and ticket.assignee_id is None:
        ticket.assignee_id = user.id
        add_event(db, ticket, user, "assigned", None, user.full_name)
    ticket.status = to
    add_event(db, ticket, user, "escalated" if to == T.escalated else "status_changed", current.value, to.value)
    if note:
        db.add(TicketNote(ticket_id=ticket.id, author_id=user.id, body=note, is_internal=True))
    audit(db, user, "status_change", "support_ticket", ticket.ticket_code, {"status": {"from": current.value, "to": to.value}})
