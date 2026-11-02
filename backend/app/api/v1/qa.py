from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.v1.deps import PageParams, apply_sort, page_params, paginate
from app.core.errors import AppError, not_found, unprocessable
from app.core.security import require
from app.db.session import get_db
from app.models import (
    AutomationResult, AutomationRun, BugReport, BugSeverity, BugStatus, Priority, TestCase, TestCaseStep,
    TestResultStatus, TestRun, TestRunResult, TestType, User,
)
from app.schemas.common import Page
from app.schemas.qa import (
    AutomationRunDetail, AutomationRunIn, AutomationRunOut, BugIn, BugOut, BugUpdate, ResultOut, ResultUpdate,
    TestCaseIn, TestCaseOut, TestRunCreate, TestRunDetail, TestRunOut,
)
from app.services.audit import audit
from app.services.qa_metrics import metrics, run_stats

router = APIRouter(prefix="/qa", tags=["QA lab"])


# ---------------- Test cases ----------------
def last_statuses(db: Session, case_ids: list[int]) -> dict[int, TestResultStatus]:
    """Most recent executed status per test case."""
    if not case_ids:
        return {}
    sub = (select(TestRunResult.test_case_id, TestRunResult.status,
                  func.row_number().over(partition_by=TestRunResult.test_case_id,
                                         order_by=TestRunResult.executed_at.desc()).label("rn"))
           .where(TestRunResult.test_case_id.in_(case_ids), TestRunResult.executed_at.is_not(None)).subquery())
    return {cid: st for cid, st in db.execute(select(sub.c.test_case_id, sub.c.status).where(sub.c.rn == 1))}


def case_out(tc: TestCase, last: TestResultStatus | None = None) -> TestCaseOut:
    return TestCaseOut.model_validate(tc).model_copy(update={"last_status": last})


def get_case(db: Session, case_id: int) -> TestCase:
    tc = db.get(TestCase, case_id)
    if tc is None:
        raise not_found("Test case")
    return tc


@router.get("/test-cases", response_model=Page[TestCaseOut])
def list_cases(
    q: str | None = Query(None, max_length=100), module: str | None = None, type: TestType | None = None,
    automated: bool | None = None, include_archived: bool = False,
    params: PageParams = Depends(page_params), _: User = Depends(require("qa:read")), db: Session = Depends(get_db),
):
    stmt = select(TestCase).options(selectinload(TestCase.steps))
    if not include_archived:
        stmt = stmt.where(~TestCase.is_archived)
    if q and q.strip():
        t = f"%{q.strip()}%"
        stmt = stmt.where(or_(TestCase.case_code.ilike(t), TestCase.title.ilike(t)))
    if module:
        stmt = stmt.where(TestCase.module == module)
    if type:
        stmt = stmt.where(TestCase.type == type)
    if automated is not None:
        stmt = stmt.where(TestCase.is_automated == automated)
    stmt = apply_sort(stmt, params.sort, {"case_code": TestCase.id, "module": TestCase.module,
                                          "priority": TestCase.priority}, TestCase.id.asc())
    items, total = paginate(db, stmt, params)
    last = last_statuses(db, [c.id for c in items])
    return Page(items=[case_out(c, last.get(c.id)) for c in items], total=total, page=params.page,
                page_size=params.page_size)


@router.post("/test-cases", response_model=TestCaseOut, status_code=201)
def create_case(body: TestCaseIn, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    tc = TestCase(**body.model_dump(exclude={"steps"}), created_by=user.id)
    tc.steps = [TestCaseStep(step_number=i, action=s.action, expected=s.expected) for i, s in enumerate(body.steps, 1)]
    db.add(tc)
    db.flush()
    audit(db, user, "create", "test_case", tc.case_code)
    db.commit()
    return case_out(get_case(db, tc.id))


@router.get("/test-cases/{case_id}", response_model=TestCaseOut)
def read_case(case_id: int, _: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    tc = get_case(db, case_id)
    return case_out(tc, last_statuses(db, [tc.id]).get(tc.id))


@router.put("/test-cases/{case_id}", response_model=TestCaseOut)
def update_case(case_id: int, body: TestCaseIn, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    tc = get_case(db, case_id)
    for k, v in body.model_dump(exclude={"steps"}).items():
        setattr(tc, k, v)
    tc.steps.clear()
    db.flush()
    tc.steps = [TestCaseStep(step_number=i, action=s.action, expected=s.expected) for i, s in enumerate(body.steps, 1)]
    audit(db, user, "update", "test_case", tc.case_code)
    db.commit()
    return case_out(get_case(db, case_id))


@router.delete("/test-cases/{case_id}", status_code=204)
def archive_case(case_id: int, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    tc = get_case(db, case_id)
    tc.is_archived = True  # soft delete keeps historical run results intact
    audit(db, user, "delete", "test_case", tc.case_code, {"archived": True})
    db.commit()


# ---------------- Test runs ----------------
def run_out(run: TestRun) -> TestRunOut:
    return TestRunOut(id=run.id, name=run.name, run_type=run.run_type, environment=run.environment,
                      build_version=run.build_version, started_at=run.started_at, completed_at=run.completed_at,
                      starter=run.starter, stats=run_stats(run.results))


def run_detail(db: Session, run: TestRun) -> TestRunDetail:
    result_ids = [r.id for r in run.results]
    bug_links: dict[int, list[str]] = {}
    if result_ids:
        for rid, code in db.execute(select(BugReport.source_result_id, BugReport.bug_code)
                                    .where(BugReport.source_result_id.in_(result_ids))):
            bug_links.setdefault(rid, []).append(code)
    base = run_out(run)
    return TestRunDetail(**base.model_dump(), results=[
        ResultOut(id=r.id, test_case=case_out(r.test_case), status=r.status, actual_result=r.actual_result,
                  executed_at=r.executed_at, duration_ms=r.duration_ms, linked_bug_codes=bug_links.get(r.id, []))
        for r in run.results])


def get_run(db: Session, run_id: int) -> TestRun:
    run = db.scalars(select(TestRun).where(TestRun.id == run_id).options(
        selectinload(TestRun.results).selectinload(TestRunResult.test_case).selectinload(TestCase.steps))).first()
    if run is None:
        raise not_found("Test run")
    return run


@router.get("/test-runs", response_model=Page[TestRunOut])
def list_runs(params: PageParams = Depends(page_params), _: User = Depends(require("qa:read")),
              db: Session = Depends(get_db)):
    stmt = select(TestRun).options(selectinload(TestRun.results)).order_by(TestRun.started_at.desc())
    items, total = paginate(db, stmt, params)
    return Page(items=[run_out(r) for r in items], total=total, page=params.page, page_size=params.page_size)


@router.post("/test-runs", response_model=TestRunDetail, status_code=201)
def create_run(body: TestRunCreate, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(body.test_case_ids))
    found = set(db.scalars(select(TestCase.id).where(TestCase.id.in_(ids), ~TestCase.is_archived)))
    missing = [i for i in ids if i not in found]
    if missing:
        raise unprocessable(f"Unknown or archived test case IDs: {missing}", "test_case_ids")
    run = TestRun(name=body.name, run_type=body.run_type, environment=body.environment,
                  build_version=body.build_version, started_by=user.id)
    db.add(run)
    db.flush()
    db.add_all(TestRunResult(test_run_id=run.id, test_case_id=i) for i in ids)
    audit(db, user, "create", "test_run", run.id, {"cases": len(ids)})
    db.commit()
    return run_detail(db, get_run(db, run.id))


@router.get("/test-runs/{run_id}", response_model=TestRunDetail)
def read_run(run_id: int, _: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    return run_detail(db, get_run(db, run_id))


@router.patch("/test-runs/{run_id}/results/{result_id}", response_model=TestRunDetail)
def record_result(run_id: int, result_id: int, body: ResultUpdate, user: User = Depends(require("qa:write")),
                  db: Session = Depends(get_db)):
    run = get_run(db, run_id)
    if run.completed_at:
        raise AppError(409, "RUN_COMPLETED", "This test run is completed; results are locked.")
    result = next((r for r in run.results if r.id == result_id), None)
    if result is None:
        raise not_found("Test result")
    result.status = body.status
    result.actual_result = body.actual_result
    result.duration_ms = body.duration_ms
    result.executed_by = user.id if body.status != TestResultStatus.not_run else None
    result.executed_at = datetime.now(UTC) if body.status != TestResultStatus.not_run else None
    audit(db, user, "update", "test_result", result.id, {"status": body.status.value})
    db.commit()
    return run_detail(db, get_run(db, run_id))


@router.post("/test-runs/{run_id}/complete", response_model=TestRunDetail)
def complete_run(run_id: int, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    run = get_run(db, run_id)
    if run.completed_at:
        raise AppError(409, "RUN_COMPLETED", "Run already completed.")
    run.completed_at = datetime.now(UTC)
    audit(db, user, "status_change", "test_run", run.id, {"completed": True, **run_stats(run.results)})
    db.commit()
    return run_detail(db, get_run(db, run_id))


# ---------------- Bug reports ----------------
def bug_out(db: Session, b: BugReport) -> BugOut:
    db.refresh(b)
    out = BugOut.model_validate(b)
    return out.model_copy(update={
        "source_ticket_code": b.source_ticket.ticket_code if b.source_ticket else None,
        "regression_case_code": b.regression_case.case_code if b.regression_case else None})


def get_bug(db: Session, bug_id: int) -> BugReport:
    b = db.get(BugReport, bug_id)
    if b is None:
        raise not_found("Bug report")
    return b


@router.get("/bugs", response_model=Page[BugOut])
def list_bugs(
    q: str | None = Query(None, max_length=100), status: list[BugStatus] | None = Query(None),
    severity: BugSeverity | None = None, priority: Priority | None = None, open_only: bool = False,
    params: PageParams = Depends(page_params), _: User = Depends(require("qa:read")), db: Session = Depends(get_db),
):
    stmt = select(BugReport)
    if q and q.strip():
        t = f"%{q.strip()}%"
        stmt = stmt.where(or_(BugReport.bug_code.ilike(t), BugReport.title.ilike(t)))
    if status:
        stmt = stmt.where(BugReport.status.in_(status))
    if open_only:
        stmt = stmt.where(BugReport.status.in_([BugStatus.new, BugStatus.confirmed, BugStatus.in_progress,
                                                BugStatus.fixed]))
    if severity:
        stmt = stmt.where(BugReport.severity == severity)
    if priority:
        stmt = stmt.where(BugReport.priority == priority)
    stmt = apply_sort(stmt, params.sort, {"created_at": BugReport.created_at, "severity": BugReport.severity,
                                          "priority": BugReport.priority, "bug_code": BugReport.id},
                      BugReport.created_at.desc())
    items, total = paginate(db, stmt, params)
    return Page(items=[bug_out(db, b) for b in items], total=total, page=params.page, page_size=params.page_size)


@router.post("/bugs", response_model=BugOut, status_code=201)
def create_bug(body: BugIn, user: User = Depends(require("bugs:create")), db: Session = Depends(get_db)):
    if body.source_result_id is not None:
        res = db.get(TestRunResult, body.source_result_id)
        if res is None:
            raise unprocessable("Test result does not exist.", "source_result_id", "INVALID_REFERENCE")
        if res.status != TestResultStatus.failed:
            raise unprocessable("Bugs can only be linked to failed test results.", "source_result_id")
    if body.regression_case_id is not None and db.get(TestCase, body.regression_case_id) is None:
        raise unprocessable("Test case does not exist.", "regression_case_id", "INVALID_REFERENCE")
    b = BugReport(**body.model_dump(), reported_by=user.id)
    db.add(b)
    db.flush()
    audit(db, user, "create", "bug_report", b.bug_code, {"severity": b.severity.value, "priority": b.priority.value})
    db.commit()
    return bug_out(db, b)


@router.get("/bugs/{bug_id}", response_model=BugOut)
def read_bug(bug_id: int, _: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    return bug_out(db, get_bug(db, bug_id))


@router.patch("/bugs/{bug_id}", response_model=BugOut)
def update_bug(bug_id: int, body: BugUpdate, user: User = Depends(require("bugs:write")), db: Session = Depends(get_db)):
    b = get_bug(db, bug_id)
    changes = body.model_dump(exclude_unset=True)
    new_status = changes.get("status", b.status)
    root_cause = changes.get("root_cause", b.root_cause)
    if new_status in (BugStatus.verified, BugStatus.closed) and not root_cause:
        raise unprocessable("Document the root cause before verifying or closing a bug.", "root_cause")
    if new_status == BugStatus.verified and not (changes.get("regression_case_id") or b.regression_case_id):
        raise unprocessable("Link a regression test case before marking the fix verified.", "regression_case_id")
    if "regression_case_id" in changes and changes["regression_case_id"] is not None \
            and db.get(TestCase, changes["regression_case_id"]) is None:
        raise unprocessable("Test case does not exist.", "regression_case_id", "INVALID_REFERENCE")
    before = {k: getattr(b, k) for k in changes}
    for k, v in changes.items():
        setattr(b, k, v)
    audit(db, user, "update", "bug_report", b.bug_code,
          {k: {"from": str(before[k]) if before[k] is not None else None, "to": str(v) if v is not None else None}
           for k, v in changes.items() if before[k] != v})
    db.commit()
    return bug_out(db, b)


# ---------------- Automation results ----------------
@router.post("/automation-runs", response_model=AutomationRunOut, status_code=201)
def ingest_automation(body: AutomationRunIn, user: User = Depends(require("qa:write")), db: Session = Depends(get_db)):
    """Ingest a normalized Playwright / pytest / Newman report (see scripts/upload_test_report.py)."""
    codes = {r.case_code for r in body.results if r.case_code}
    case_ids = dict(db.execute(select(TestCase.case_code, TestCase.id).where(TestCase.case_code.in_(codes))).all()) \
        if codes else {}
    counts = {"passed": 0, "failed": 0, "skipped": 0}
    for r in body.results:
        counts[r.status] += 1
    run = AutomationRun(framework=body.framework, suite_name=body.suite_name, commit_sha=body.commit_sha,
                        branch=body.branch, started_at=body.started_at, duration_ms=body.duration_ms,
                        total=len(body.results), uploaded_by=user.id, **counts)
    db.add(run)
    db.flush()
    db.add_all(AutomationResult(automation_run_id=run.id, test_name=r.test_name, file_path=r.file_path,
                                status=r.status, duration_ms=r.duration_ms, error_message=r.error_message,
                                test_case_id=case_ids.get(r.case_code)) for r in body.results)
    audit(db, user, "create", "automation_run", run.id, {"framework": body.framework.value, **counts})
    db.commit()
    return run


@router.get("/automation-runs", response_model=Page[AutomationRunOut])
def list_automation(params: PageParams = Depends(page_params), _: User = Depends(require("qa:read")),
                    db: Session = Depends(get_db)):
    items, total = paginate(db, select(AutomationRun).order_by(AutomationRun.started_at.desc()), params)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.get("/automation-runs/{run_id}", response_model=AutomationRunDetail)
def read_automation(run_id: int, _: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    run = db.scalars(select(AutomationRun).where(AutomationRun.id == run_id).options(
        selectinload(AutomationRun.results).selectinload(AutomationResult.test_case))).first()
    if run is None:
        raise not_found("Automation run")
    base = AutomationRunOut.model_validate(run).model_dump()
    return AutomationRunDetail(**base, results=[
        {"id": r.id, "test_name": r.test_name, "file_path": r.file_path, "status": r.status,
         "duration_ms": r.duration_ms, "error_message": r.error_message,
         "case_code": r.test_case.case_code if r.test_case else None} for r in run.results])


@router.get("/metrics")
def qa_metrics(_: User = Depends(require("qa:read")), db: Session = Depends(get_db)):
    return metrics(db)
