#!/usr/bin/env python3
"""Render docs/test-cases/*.md from the same sources the app uses, so docs and data never disagree.

- manual-test-cases.md      ← backend/app/db/seed_data.py (TEST_CASES)
- test-execution-report.md  ← backend/app/db/reports/*.json (real, uploaded test executions)
"""

import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.db.seed_data import TEST_CASES  # noqa: E402

OUT = ROOT / "docs" / "test-cases"


def manual_cases() -> str:
    lines = ["# Manual test cases", "",
             f"{len(TEST_CASES)} documented test cases. They are seeded into the QA Lab (TC-001 … TC-{len(TEST_CASES):03d}), "
             "where they can be executed in test runs. Generated from `backend/app/db/seed_data.py`.", "",
             "Demo password for all accounts: `Demo@2026!`", "",
             "| ID | Title | Module | Type | Priority | Automated by |", "|---|---|---|---|---|---|"]
    for i, tc in enumerate(TEST_CASES, 1):
        auto = f"`{tc['automation']}`" if tc["automation"] else "manual only"
        lines.append(f"| [TC-{i:03d}](#tc-{i:03d}) | {tc['title']} | {tc['module']} | {tc['type']} | {tc['priority'].upper()} | {auto} |")
    for i, tc in enumerate(TEST_CASES, 1):
        lines += ["", f"## TC-{i:03d}", "", f"**{tc['title']}**", "",
                  f"- **Module:** {tc['module']} · **Type:** {tc['type']} · **Priority:** {tc['priority'].upper()}",
                  f"- **Preconditions:** {tc['preconditions']}", "", "| Step | Action | Expected |", "|---|---|---|"]
        for n, (action, expected) in enumerate(tc["steps"], 1):
            lines.append(f"| {n} | {action} | {expected or ''} |")
        lines += ["", f"**Expected result:** {tc['expected']}"]
    return "\n".join(lines) + "\n"


def execution_report() -> str:
    reports = sorted((ROOT / "backend/app/db/reports").glob("*.json"))
    lines = ["# Test execution report", "",
             "Results of real executions, converted by `scripts/upload_test_report.py` and loaded into the QA Lab "
             "(QA Lab → Automation). Regenerate with `./scripts/run_all_tests.sh` then `python3 scripts/generate_test_docs.py`.", "",
             "| Suite | Framework | Executed | Tests | Passed | Failed | Skipped | Duration | Commit |", "|---|---|---|---|---|---|---|---|---|"]
    linked: set[str] = set()
    details = []
    for f in reports:
        r = json.loads(f.read_text())
        c = Counter(x["status"] for x in r["results"])
        when = datetime.fromisoformat(r["started_at"]).astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
        lines.append(f"| {r['suite_name']} | {r['framework']} | {when} | {len(r['results'])} | {c['passed']} | {c['failed']} | "
                     f"{c['skipped']} | {r['duration_ms'] / 1000:.1f} s | `{(r.get('commit_sha') or '')[:7]}` |")
        codes = sorted({x["case_code"] for x in r["results"] if x.get("case_code")})
        linked |= set(codes)
        failures = [x for x in r["results"] if x["status"] == "failed"]
        details.append(f"### {r['suite_name']}\n\nLinked manual cases: {', '.join(codes) or 'none'}\n\n"
                       + ("Failures:\n" + "\n".join(f"- `{x['test_name']}`: {x['error_message']}" for x in failures)
                          if failures else "No failures."))
    lines += ["", f"**Automation coverage:** {len(linked)} of {len(TEST_CASES)} manual cases are linked to at least one "
              "executed automated test.", "", *details]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manual-test-cases.md").write_text(manual_cases())
    (OUT / "test-execution-report.md").write_text(execution_report())
    print("wrote", OUT / "manual-test-cases.md", "and", OUT / "test-execution-report.md")
