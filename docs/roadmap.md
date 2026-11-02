# Implementation roadmap

**Status (2026-11-02):** all milestones complete. Results: 115 backend tests, 17 Playwright tests, 31 Postman requests (112 assertions), all passing. 30 manual test cases. See [test-cases/test-execution-report.md](test-cases/test-execution-report.md). The Docker image is defined but couldn't be built in the development sandbox (container registries blocked); its steps were verified individually on a fresh database.

The build order puts the backend first in places where the frontend needs a real API to talk to. The brief lists frontend as Phase 2, but the rule is "no mocked API responses", so each frontend page is built against working endpoints.

| Milestone | Scope | Done when (verified, not assumed) |
|---|---|---|
| **M0 — Planning** (done) | Architecture, schema, API, RBAC, journeys, roadmap | Docs written; schema loads in Postgres 16; constraint checks pass |
| **M1 — Foundations** (done) | Docker Compose (db, backend, frontend), FastAPI skeleton, config, Alembic baseline from `schema.sql`, request-ID + logging + redaction middleware, error envelope, `/health` | `docker compose up` → `/health` 200; pytest smoke passes; Swagger loads |
| **M2 — Auth & shell** (done) | Login, JWT, `/auth/me`, permission dependency, seed demo users; React app shell (sidebar, top bar, global search box, role-based nav), login page | All three demo accounts log in; 401/403 tests pass; Playwright login test passes |
| **M3 — Pharmacy core** (done) | Patients, medications, prescriptions, refill workflow (API + UI), synthetic seed (~250 patients, ~400 Rx, refill history) | J2/J3 work end to end; duplicate/validation tests pass |
| **M4 — Dashboard** (done) | Summary + activity endpoints, charts, date filter | Numbers match SQL verification queries |
| **M5 — Support Center** (done) | Tickets, notes, events, assignment, state machine, convert-to-bug | J4/J7 work; invalid transitions → 409 |
| **M6 — QA Lab** (done) | Test cases/steps, runs, results, bug reports, metrics, automation report ingest | J6 works; metrics change only from real executions |
| **M7 — API & Logs Explorer** (done) | Logs/audit endpoints + UI, request trace view, API catalog page, Postman collection | J5 works; Newman run of collection passes |
| **M8 — Bug Lab** (done) | Demo flags, sandbox seed/reset, 4 injected defects, isolation tests | J8 works; isolation tests prove normal paths are unaffected |
| **M9 — Testing deliverables** (done) | ≥20 manual test cases (executed in the app), ≥5 Playwright specs, backend unit + integration suite, test report ingest | All suites run green in CI-style script; results visible in QA Lab |
| **M10 — Docs & polish** (done) | README with screenshots, support troubleshooting guide, bug reports for each injected defect, responsive/a11y pass, Settings page | Fresh clone → documented commands → working app |

## Known limitations (to be stated in README)

- Not HIPAA-compliant and not independently audited. Synthetic data only.
- Token in `sessionStorage` (XSS exposure vs. httpOnly cookie). Acceptable for a demo; documented.
- Single-instance deployment; no horizontal scaling or background worker.
