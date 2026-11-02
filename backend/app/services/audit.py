from typing import Any

from sqlalchemy.orm import Session

from app.core.redaction import redact
from app.core.request_context import get_request_id
from app.models import AuditLog, User


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict]:
    """Field-level change set; values are redacted when written."""
    return {k: {"from": before.get(k), "to": v} for k, v in after.items() if before.get(k) != v}


def audit(db: Session, actor: User | None, action: str, entity_type: str, entity_id: Any,
          changes: dict | None = None) -> None:
    db.add(AuditLog(
        actor_id=actor.id if actor else None, action=action, entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        request_id=get_request_id(), changes=_redact_changes(changes or {}),
    ))


def _redact_changes(changes: dict) -> dict:
    out = {}
    for field, value in changes.items():
        if isinstance(value, dict) and set(value) == {"from", "to"}:
            red = redact({field: value["from"]})[field], redact({field: value["to"]})[field]
            out[field] = {"from": _jsonable(red[0]), "to": _jsonable(red[1])}
        else:
            out[field] = _jsonable(redact({field: value})[field])
    return out


def _jsonable(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool, list, dict)):
        return v
    return str(v)
