"""QA metrics are always computed from recorded executions — never stored or hardcoded."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AutomationResult, AutomationRun, BugReport, BugStatus, TestCase, TestResultStatus, TestRun, TestRunResult,
)

OPEN_BUG_STATUSES = (BugStatus.new, BugStatus.confirmed, BugStatus.in_progress, BugStatus.fixed)


def run_stats(results: list[TestRunResult]) -> dict:
    counts = {s.value: 0 for s in TestResultStatus}
    for r in results:
        counts[r.status.value] += 1
    total = len(results)
    executed = counts["passed"] + counts["failed"] + counts["blocked"]
    return {
        "total": total, "passed": counts["passed"], "failed": counts["failed"], "blocked": counts["blocked"],
        "not_run": counts["not_run"], "executed": executed,
        "pass_rate": round(counts["passed"] / executed * 100, 1) if executed else None,
        "progress": round(executed / total * 100, 1) if total else 0.0,
    }


def metrics(db: Session) -> dict:
    active_cases = db.scalar(select(func.count()).select_from(TestCase).where(~TestCase.is_archived)) or 0
    automated_case_ids = set(db.scalars(select(TestCase.id).where(~TestCase.is_archived, TestCase.is_automated)))
    linked = set(db.scalars(select(AutomationResult.test_case_id).where(AutomationResult.test_case_id.is_not(None))))
    covered = automated_case_ids | linked
    by_module = db.execute(select(TestCase.module, func.count()).where(~TestCase.is_archived)
                           .group_by(TestCase.module).order_by(TestCase.module)).all()

    latest_run = db.scalars(select(TestRun).order_by(TestRun.started_at.desc()).limit(1)).first()
    latest_manual = None
    if latest_run:
        latest_manual = {"id": latest_run.id, "name": latest_run.name, "started_at": latest_run.started_at,
                         "completed_at": latest_run.completed_at, **run_stats(latest_run.results)}

    latest_auto = []
    for fw in db.scalars(select(AutomationRun.framework).distinct()):
        run = db.scalars(select(AutomationRun).where(AutomationRun.framework == fw)
                         .order_by(AutomationRun.started_at.desc()).limit(1)).first()
        latest_auto.append({
            "id": run.id, "framework": run.framework.value, "suite_name": run.suite_name, "started_at": run.started_at,
            "total": run.total, "passed": run.passed, "failed": run.failed, "skipped": run.skipped,
            "duration_ms": run.duration_ms,
            "pass_rate": round(run.passed / (run.passed + run.failed) * 100, 1) if (run.passed + run.failed) else None,
        })

    # Execution trend: last 12 manual runs + automation runs, oldest first.
    trend = []
    for run in db.scalars(select(TestRun).order_by(TestRun.started_at.desc()).limit(12)):
        st = run_stats(run.results)
        if st["executed"]:
            trend.append({"date": run.started_at, "label": run.name, "kind": "manual",
                          "run_type": run.run_type.value, "pass_rate": st["pass_rate"], "executed": st["executed"]})
    for run in db.scalars(select(AutomationRun).order_by(AutomationRun.started_at.desc()).limit(12)):
        ran = run.passed + run.failed
        if ran:
            trend.append({"date": run.started_at, "label": run.suite_name, "kind": run.framework.value,
                          "run_type": "automated", "pass_rate": round(run.passed / ran * 100, 1), "executed": ran})
    trend.sort(key=lambda t: t["date"])

    bugs_by_severity = dict(db.execute(select(BugReport.severity, func.count())
                                       .where(BugReport.status.in_(OPEN_BUG_STATUSES)).group_by(BugReport.severity)).all())
    bugs_by_status = dict(db.execute(select(BugReport.status, func.count()).group_by(BugReport.status)).all())

    return {
        "test_cases": {"total": active_cases, "automated": len(automated_case_ids),
                       "by_module": [{"module": m, "count": c} for m, c in by_module]},
        "coverage": {"covered_cases": len(covered & _active_ids(db)), "total_cases": active_cases,
                     "percent": round(len(covered & _active_ids(db)) / active_cases * 100, 1) if active_cases else 0.0},
        "latest_manual_run": latest_manual,
        "latest_automation": latest_auto,
        "trend": trend,
        "open_bugs_by_severity": {k.value: v for k, v in bugs_by_severity.items()},
        "bugs_by_status": {k.value: v for k, v in bugs_by_status.items()},
    }


def _active_ids(db: Session) -> set[int]:
    return set(db.scalars(select(TestCase.id).where(~TestCase.is_archived)))


def latest_pass_rate(db: Session) -> dict | None:
    """Most recent execution of any kind, for the dashboard KPI."""
    candidates = []
    run = db.scalars(select(TestRun).order_by(TestRun.started_at.desc()).limit(1)).first()
    if run:
        st = run_stats(run.results)
        if st["executed"]:
            candidates.append({"source": "manual", "name": run.name, "at": run.started_at, **st})
    auto = db.scalars(select(AutomationRun).order_by(AutomationRun.started_at.desc()).limit(1)).first()
    if auto and (auto.passed + auto.failed):
        candidates.append({"source": auto.framework.value, "name": auto.suite_name, "at": auto.started_at,
                           "total": auto.total, "passed": auto.passed, "failed": auto.failed, "blocked": 0,
                           "not_run": auto.skipped, "executed": auto.passed + auto.failed,
                           "pass_rate": round(auto.passed / (auto.passed + auto.failed) * 100, 1)})
    return max(candidates, key=lambda c: c["at"]) if candidates else None
