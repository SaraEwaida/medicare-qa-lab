from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import PageParams, page_params, paginate
from app.core.security import require
from app.db.session import get_db
from app.models import AppLog, AuditLog, User
from app.schemas.common import Page

router = APIRouter(tags=["Logs & diagnostics"])


def log_dict(l: AppLog) -> dict:
    return {"id": l.id, "ts": l.ts, "level": l.level, "request_id": l.request_id, "method": l.method, "path": l.path,
            "status_code": l.status_code, "duration_ms": l.duration_ms, "user_id": l.user_id, "user_role": l.user_role,
            "message": l.message, "context": l.context, "is_demo": l.is_demo}


def audit_dict(a: AuditLog) -> dict:
    return {"id": a.id, "ts": a.ts, "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id,
            "request_id": a.request_id, "changes": a.changes,
            "actor": {"id": a.actor.id, "full_name": a.actor.full_name, "role": a.actor.role.value} if a.actor else None}


@router.get("/logs", response_model=Page[dict])
def list_logs(
    request_id: str | None = Query(None, max_length=40), level: str | None = Query(None, pattern="^(INFO|WARNING|ERROR)$"),
    status_code: int | None = Query(None, ge=100, le=599), status_class: str | None = Query(None, pattern="^[2345]xx$"),
    path: str | None = Query(None, max_length=100), method: str | None = Query(None, max_length=8),
    demo: bool | None = None, since: datetime | None = None, until: datetime | None = None,
    params: PageParams = Depends(page_params), _: User = Depends(require("logs:read")), db: Session = Depends(get_db),
):
    stmt = select(AppLog).order_by(AppLog.ts.desc(), AppLog.id.desc())
    if request_id:
        stmt = stmt.where(AppLog.request_id == request_id.strip())
    if level:
        stmt = stmt.where(AppLog.level == level)
    if status_code:
        stmt = stmt.where(AppLog.status_code == status_code)
    if status_class:
        base = int(status_class[0]) * 100
        stmt = stmt.where(AppLog.status_code >= base, AppLog.status_code < base + 100)
    if path:
        stmt = stmt.where(AppLog.path.ilike(f"%{path}%"))
    if method:
        stmt = stmt.where(AppLog.method == method.upper())
    if demo is not None:
        stmt = stmt.where(AppLog.is_demo == demo)
    if since:
        stmt = stmt.where(AppLog.ts >= since)
    if until:
        stmt = stmt.where(AppLog.ts <= until)
    items, total = paginate(db, stmt, params)
    return Page(items=[log_dict(l) for l in items], total=total, page=params.page, page_size=params.page_size)


@router.get("/logs/requests/{request_id}")
def trace_request(request_id: str, _: User = Depends(require("logs:read")), db: Session = Depends(get_db)):
    """Everything known about one request: log lines + audit entries written while handling it."""
    logs = db.scalars(select(AppLog).where(AppLog.request_id == request_id).order_by(AppLog.ts)).all()
    audits = db.scalars(select(AuditLog).where(AuditLog.request_id == request_id)
                        .options(joinedload(AuditLog.actor)).order_by(AuditLog.ts)).all()
    return {"request_id": request_id, "found": bool(logs or audits),
            "logs": [log_dict(l) for l in logs], "audit": [audit_dict(a) for a in audits]}


@router.get("/logs/stats")
def log_stats(_: User = Depends(require("logs:read")), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status_code >= 500) AS server_errors,
               count(*) FILTER (WHERE status_code BETWEEN 400 AND 499) AS client_errors,
               count(*) FILTER (WHERE status_code = 422) AS validation_failures,
               coalesce(round(avg(duration_ms)), 0) AS avg_ms,
               coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_ms
        FROM app_logs WHERE ts > now() - interval '24 hours'""")).mappings().one()
    top_errors = db.execute(text("""
        SELECT path, status_code, count(*) AS n FROM app_logs
        WHERE ts > now() - interval '24 hours' AND status_code >= 400
        GROUP BY path, status_code ORDER BY n DESC LIMIT 5""")).mappings().all()
    return {"last_24h": dict(rows), "top_errors": [dict(r) for r in top_errors]}


@router.get("/audit", response_model=Page[dict])
def list_audit(
    entity_type: str | None = Query(None, max_length=40), entity_id: str | None = Query(None, max_length=40),
    action: str | None = Query(None, max_length=40), actor_id: int | None = None,
    params: PageParams = Depends(page_params), _: User = Depends(require("logs:read")), db: Session = Depends(get_db),
):
    stmt = select(AuditLog).options(joinedload(AuditLog.actor)).order_by(AuditLog.ts.desc(), AuditLog.id.desc())
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    items, total = paginate(db, stmt, params)
    return Page(items=[audit_dict(a) for a in items], total=total, page=params.page, page_size=params.page_size)


# Read-only consistency checks. Each query returns the rows that VIOLATE the rule; 0 rows = pass.
DB_CHECKS = [
    {"key": "one_pending_refill", "title": "At most one pending refill per prescription",
     "sql": "SELECT prescription_id, count(*) AS pending FROM refill_requests "
            "WHERE status = 'pending' AND NOT is_sandbox GROUP BY prescription_id HAVING count(*) > 1"},
    {"key": "refill_counter_consistency", "title": "refills_remaining = authorized − approved/dispensed refills",
     "sql": "SELECT p.rx_code, p.refills_authorized, p.refills_remaining, count(r.id) AS used FROM prescriptions p "
            "LEFT JOIN refill_requests r ON r.prescription_id = p.id AND r.status IN ('approved','dispensed') "
            "WHERE NOT p.is_sandbox GROUP BY p.id "
            "HAVING p.refills_remaining <> p.refills_authorized - count(r.id)"},
    {"key": "inactive_patient_active_rx", "title": "Inactive patients have no active prescriptions",
     "sql": "SELECT pa.patient_code, p.rx_code, p.status FROM prescriptions p JOIN patients pa ON pa.id = p.patient_id "
            "WHERE pa.status = 'inactive' AND p.status IN ('active','refill_due','on_hold')"},
    {"key": "resolved_tickets_have_resolution", "title": "Resolved/closed tickets record a resolution",
     "sql": "SELECT ticket_code, status FROM support_tickets "
            "WHERE status IN ('resolved','closed') AND coalesce(trim(resolution), '') = ''"},
    {"key": "duplicate_patients", "title": "No duplicate patients (name + date of birth)",
     "sql": "SELECT lower(first_name) AS first, lower(last_name) AS last, date_of_birth, count(*) FROM patients "
            "WHERE NOT is_sandbox GROUP BY 1, 2, 3 HAVING count(*) > 1"},
    {"key": "failed_results_documented", "title": "Failed test results have an actual result",
     "sql": "SELECT id, test_run_id FROM test_run_results WHERE status = 'failed' "
            "AND coalesce(trim(actual_result), '') = ''"},
    {"key": "orphan_refills", "title": "Every refill belongs to an existing prescription",
     "sql": "SELECT r.id FROM refill_requests r LEFT JOIN prescriptions p ON p.id = r.prescription_id WHERE p.id IS NULL"},
]


@router.get("/diagnostics/db-checks")
def db_checks(_: User = Depends(require("logs:read")), db: Session = Depends(get_db)):
    out = []
    db.rollback()  # start a fresh transaction so it can be marked read-only
    db.execute(text("SET TRANSACTION READ ONLY"))
    for check in DB_CHECKS:
        rows = db.execute(text(check["sql"] + " LIMIT 20")).mappings().all()
        out.append({**check, "passed": len(rows) == 0, "violations": [
            {k: (str(v) if not isinstance(v, (int, float, str, type(None))) else v) for k, v in r.items()} for r in rows]})
    db.rollback()
    return out
