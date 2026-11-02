#!/usr/bin/env python3
"""Convert a real test report into the QA Lab's automation-run format, save it, and optionally upload it.

Supported inputs:
  --pytest      JUnit XML from `pytest --junitxml=...`
  --playwright  JSON from Playwright's json reporter
  --newman      JSON from `newman run --reporters json`

Test names that contain a test case code (TC-017, test_tc017_..., [TC-017]) are linked to that manual case,
which is how automation coverage is computed. Only the first code in a name is used.

Examples:
  python3 scripts/upload_test_report.py --pytest backend/results/junit.xml --suite "Backend pytest" \\
      --save backend/app/db/reports/pytest.json --upload --api http://localhost:8000
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

CODE_RE = re.compile(r"tc[-_]?(\d{3})", re.IGNORECASE)


def case_code(name: str) -> str | None:
    m = CODE_RE.search(name)
    return f"TC-{m.group(1)}" if m else None


def from_pytest(path: Path) -> tuple[list[dict], int, datetime | None]:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    results, total_ms, started = [], 0, None
    for suite in suites:
        if suite.get("timestamp"):
            ts = datetime.fromisoformat(suite.get("timestamp"))
            started = ts if ts.tzinfo else ts.astimezone(UTC)  # JUnit timestamps are naive local time
        total_ms += int(float(suite.get("time", 0)) * 1000)
        for tc in suite.iter("testcase"):
            name = tc.get("name", "")
            failure = tc.find("failure") if tc.find("failure") is not None else tc.find("error")
            status = "failed" if failure is not None else "skipped" if tc.find("skipped") is not None else "passed"
            results.append({
                "test_name": f"{tc.get('classname', '')}::{name}".strip(":"),
                "file_path": (tc.get("classname") or "").replace(".", "/") + ".py",
                "status": status, "duration_ms": int(float(tc.get("time", 0)) * 1000),
                "error_message": (failure.get("message") or failure.text or "")[:2000] if failure is not None else None,
                "case_code": case_code(name),
            })
    return results, total_ms, started


def from_playwright(path: Path) -> tuple[list[dict], int, datetime | None]:
    data = json.loads(path.read_text())
    results = []

    def walk(suite: dict, titles: list[str]):
        for child in suite.get("suites", []):
            walk(child, titles + [child.get("title", "")])
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                runs = test.get("results", [])
                last = runs[-1] if runs else {}
                status = {"expected": "passed", "unexpected": "failed", "flaky": "passed", "skipped": "skipped"}.get(
                    test.get("status"), "failed")
                err = (last.get("error") or {}).get("message")
                title = " › ".join([t for t in titles if t and not t.endswith(".ts")] + [spec["title"]])
                results.append({"test_name": title, "file_path": f"e2e/tests/{spec.get('file', '')}", "status": status,
                                "duration_ms": int(last.get("duration", 0)),
                                "error_message": re.sub(r"\x1b\[[0-9;]*m", "", err)[:2000] if err else None,
                                "case_code": case_code(spec["title"])})

    for s in data.get("suites", []):
        walk(s, [s.get("title", "")])
    stats = data.get("stats", {})
    started = datetime.fromisoformat(stats["startTime"].replace("Z", "+00:00")) if stats.get("startTime") else None
    return results, int(stats.get("duration", 0)), started


def from_newman(path: Path) -> tuple[list[dict], int, datetime | None]:
    run = json.loads(path.read_text())["run"]
    results = []
    for ex in run.get("executions", []):
        name = ex["item"]["name"]
        failed = [a for a in ex.get("assertions", []) if a.get("error")]
        results.append({"test_name": name, "file_path": "postman/MediCare-QA-Lab.postman_collection.json",
                        "status": "failed" if failed else "passed",
                        "duration_ms": int(ex.get("response", {}).get("responseTime", 0)),
                        "error_message": "; ".join(f"{a['assertion']}: {a['error']['message']}" for a in failed)[:2000] or None,
                        "case_code": case_code(name)})
    t = run.get("timings", {})
    started = datetime.fromtimestamp(t["started"] / 1000, tz=UTC) if t.get("started") else None
    return results, int(t.get("completed", 0) - t.get("started", 0)), started


def git(*args: str) -> str | None:
    try:
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True).strip() or None
    except Exception:
        return None


def login(api: str, email: str, password: str) -> str:
    req = urllib.request.Request(f"{api}/api/v1/auth/login", data=json.dumps({"email": email, "password": password}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pytest", type=Path)
    src.add_argument("--playwright", type=Path)
    src.add_argument("--newman", type=Path)
    ap.add_argument("--suite", required=True, help="Suite name shown in the QA Lab")
    ap.add_argument("--save", type=Path, help="Write the normalized report here (e.g. backend/app/db/reports/x.json)")
    ap.add_argument("--upload", action="store_true", help="POST the report to the API")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--email", default="qa@medicare.example.com")
    ap.add_argument("--password", default="Demo@2026!")
    a = ap.parse_args()

    framework, (results, duration, started) = (
        ("pytest", from_pytest(a.pytest)) if a.pytest else
        ("playwright", from_playwright(a.playwright)) if a.playwright else ("newman", from_newman(a.newman)))
    if not results:
        print("No test results found in the report.", file=sys.stderr)
        return 1
    payload = {"framework": framework, "suite_name": a.suite, "commit_sha": git("rev-parse", "HEAD"),
               "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
               "started_at": (started or datetime.now(UTC)).isoformat(), "duration_ms": max(duration, 0), "results": results}
    counts = {s: sum(r["status"] == s for r in results) for s in ("passed", "failed", "skipped")}
    linked = sorted({r["case_code"] for r in results if r["case_code"]})
    print(f"{framework}: {len(results)} tests {counts} · linked cases: {', '.join(linked) or 'none'}")
    if a.save:
        a.save.parent.mkdir(parents=True, exist_ok=True)
        a.save.write_text(json.dumps(payload, indent=1))
        print(f"saved {a.save}")
    if a.upload:
        token = login(a.api, a.email, a.password)
        req = urllib.request.Request(f"{a.api}/api/v1/qa/automation-runs", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req) as r:
            print(f"uploaded as automation run #{json.load(r)['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
