#!/usr/bin/env bash
# Runs every automated suite against real services and records the results in the QA Lab.
#
#   1. Backend unit + integration tests (pytest, separate test database)
#   2. Postman collection via Newman (against the running app)
#   3. Playwright browser tests (against the running app)
#
# Each report is converted with scripts/upload_test_report.py, uploaded to the running API (QA Lab → Automation)
# and saved under backend/app/db/reports/ so fresh deployments start with real, dated results.
#
# Requirements: app running at $APP_URL (default http://localhost:8000), PostgreSQL test DB for pytest
# (TEST_DATABASE_URL), backend venv, node. Set NO_UPLOAD=1 to skip uploading.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_URL="${APP_URL:-http://localhost:8000}"
REPORTS="$ROOT/backend/app/db/reports"
UPLOAD=$([[ "${NO_UPLOAD:-0}" == "1" ]] && echo "" || echo "--upload --api $APP_URL")
PY="$ROOT/backend/.venv/bin/python"; [[ -x "$PY" ]] || PY=python3
status=0

echo "▶ pytest"
mkdir -p "$ROOT/backend/results"
(cd "$ROOT/backend" && "$PY" -m pytest -q --junitxml=results/junit.xml) || status=1
python3 "$ROOT/scripts/upload_test_report.py" --pytest "$ROOT/backend/results/junit.xml" \
  --suite "Backend unit + integration (pytest)" --save "$REPORTS/pytest.json" $UPLOAD

echo "▶ newman"
(cd "$ROOT/postman" && npx --yes newman@6 run MediCare-QA-Lab.postman_collection.json \
  -e local.postman_environment.json --env-var "baseUrl=$APP_URL" \
  --reporters cli,json --reporter-json-export results/newman.json) || status=1
python3 "$ROOT/scripts/upload_test_report.py" --newman "$ROOT/postman/results/newman.json" \
  --suite "API contract (Postman/Newman)" --save "$REPORTS/newman.json" $UPLOAD

echo "▶ playwright"
(cd "$ROOT/e2e" && E2E_BASE_URL="$APP_URL" npx playwright test) || status=1
python3 "$ROOT/scripts/upload_test_report.py" --playwright "$ROOT/e2e/results/results.json" \
  --suite "Browser E2E (Playwright)" --save "$REPORTS/playwright.json" $UPLOAD

[[ $status -eq 0 ]] && echo "✔ all suites passed" || echo "✘ at least one suite had failures (results were still recorded)"
exit $status
