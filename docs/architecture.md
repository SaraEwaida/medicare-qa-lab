# MediCare QA Lab — Architecture

> Synthetic data only. This project is a demonstration and is **not** HIPAA-compliant or independently audited.

## 1. System overview

```mermaid
flowchart LR
    subgraph Client["Browser"]
        SPA["React + TypeScript SPA<br/>Tailwind · shadcn/ui · TanStack Query"]
    end

    subgraph API["FastAPI service (/api/v1)"]
        MW["Middleware<br/>request ID · timing · structured logging · redaction"]
        AUTH["Auth & RBAC<br/>JWT bearer · role dependencies"]
        ROUTERS["Routers<br/>patients · prescriptions · refills · tickets · qa · logs · demo"]
        SVC["Service layer<br/>business rules · validation · audit"]
        DEMO["Bug-injection registry<br/>(demo sandbox only)"]
        REPO["SQLAlchemy 2.0 ORM"]
    end

    DB[("PostgreSQL 16")]

    subgraph Tooling["Testing & tooling"]
        PW["Playwright E2E"]
        PY["pytest unit + integration"]
        PM["Postman / Newman"]
        SW["OpenAPI / Swagger UI"]
    end

    SPA -- "JSON over HTTPS<br/>Authorization: Bearer" --> MW --> AUTH --> ROUTERS --> SVC --> REPO --> DB
    SVC -. "checks flag + X-Demo-Session" .-> DEMO
    PW --> SPA
    PM --> MW
    PY --> SVC
    SW --> ROUTERS
    PW -. "JSON report ingest" .-> ROUTERS
    PY -. "JUnit/JSON report ingest" .-> ROUTERS
```

**As built:** one Docker image. FastAPI serves the API under `/api` and the built React app for every other path, so the browser talks to a single origin and needs no CORS in production (CORS is enabled only for the Vite dev server). Docker Compose runs that image plus `postgres:16`. This replaced the planned nginx + backend split: it gives one service and one URL on free hosting, with nothing to lose at this scale. See [deployment.md](deployment.md).

## 2. Key architectural decisions

| # | Decision | Why | Trade-off |
|---|---|---|---|
| D1 | **Monorepo** (`backend/`, `frontend/`, `e2e/`, `postman/`, `docs/`) | One clone, one `docker compose up`, easy for interviewers to review | Less separation than multi-repo; fine for this scale |
| D2 | **FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2** | Auto-generated OpenAPI/Swagger, typed validation that produces precise 422 errors (great QA material), versioned migrations | Sync SQLAlchemy chosen over async for simpler tests and debugging |
| D3 | **JWT bearer auth** (60-min access token, bcrypt passwords) | Works identically from the SPA, Swagger "Authorize" and Postman — important for API-testing demos | Token kept in `sessionStorage` (cleared on tab close). An httpOnly cookie would be stronger against XSS; documented as a known limitation |
| D4 | **RBAC enforced server-side** via a `require_permission("patients:write")` dependency; frontend hides UI per role but never relies on it | Authorization must be testable at the API level (403 test cases) | Permission map lives in code, not DB — simpler, reviewed via PRs |
| D5 | **Request ID on every request** (`X-Request-ID` echoed or generated) and a **standard error envelope** | Lets support engineers trace a user-reported error to a log line — the core L1 support skill this project demonstrates | — |
| D6 | **Logs persisted to `app_logs`** (plus stdout JSON) with a redaction filter (names, phone, email, DOB, free-text diagnostic fields masked) | The API & Logs Explorer queries real logs, not fixtures | Logging to DB adds write load; acceptable for a demo, retention job trims to 14 days |
| D7 | **Audit log** on every create/update/delete/status change (`audit_logs`: who, what, before/after diff with redaction) | Healthcare apps need traceability; also used for "database verification" examples | — |
| D8 | **Controlled bug injection isolated three ways**: (1) `DEMO_BUGS_ENABLED` env var, (2) per-bug flag in `demo_bug_flags`, (3) bug only fires when the request carries `X-Demo-Session` *and* targets sandbox rows (`is_sandbox = true`) | Normal app paths can never hit an injected defect, even if a flag is left on | A little extra branching in a few service functions, kept in one `demo/` module |
| D9 | **QA metrics are computed, never hardcoded**: pass rate, coverage etc. come from `test_run_results` and ingested automation reports (`automation_runs`) | Project rule: no fake success metrics | Dashboard shows empty states until tests are actually executed |
| D10 | **Frontend: Vite + React Router + TanStack Query + Recharts, with small in-repo form validators** | Query cache makes loading/error/empty states consistent; client validators mirror the backend rules for instant feedback, and server 422 details map back onto the same fields | Validation rules exist on both sides; the server remains the source of truth |
| D12 | **Enums stored as VARCHAR + named CHECK constraints** (not native PG enums) | Adding a status is a one-line migration; constraint names map to API error codes | Slightly larger storage than native enums |
| D13 | **Single image serves API + SPA** | One free web service, one URL, same-origin auth | Static files served by Python rather than a CDN; fine for demo traffic |
| D14 | **Coverage counts executed links only** | A case counts as covered only when an uploaded report from a real run links to it; "declared automated" is shown separately | Coverage is 0% on an empty database until reports are uploaded (seed loads the committed real reports) |
| D11 | **Business identifiers separate from PKs**: `P-1024`, `RX-5781`, `SUP-1042`, `TC-001`, `BUG-007` | Human-readable IDs for tickets/bug reports; integer PKs stay internal | Generated via Postgres sequences + prefix |

**Masking:** both non-pharmacist roles (Support and QA) see masked patient contact details, following the minimum-necessary principle. The original plan masked only Support.

**Roles:** the brief defines three roles (Pharmacist, Support Engineer, QA Engineer). The reference image also mentions Admin; I'm leaving it out to keep the scope tight. Settings that would need an admin (demo-bug toggles, user list) go to QA Engineer.

## 3. Folder structure

```
medicare-qa-lab/
├── backend/
│   ├── app/
│   │   ├── main.py               # app factory: middleware, routers, SPA serving
│   │   ├── core/                 # config, security (JWT, bcrypt, rate limit), permissions, redaction, errors, logging middleware
│   │   ├── db/                   # session, seed.py, seed_data.py (incl. the 30 test cases), reports/ (real test results)
│   │   ├── models/               # SQLAlchemy models + enums
│   │   ├── schemas/              # Pydantic request/response models
│   │   ├── services/             # refill workflow, ticket transitions, QA metrics, audit
│   │   ├── api/v1/               # auth, dashboard, patients, prescriptions, tickets, qa, logs, demo
│   │   └── demo/                 # Bug Lab: defect registry + sandbox data
│   ├── alembic/                  # migrations
│   ├── tests/unit, tests/integration
│   └── docker-entrypoint.sh
├── frontend/src/
│   ├── components/               # ui.tsx (shadcn-style primitives), common.tsx, AppShell.tsx
│   ├── features/                 # auth, dashboard, patients, prescriptions, tickets, qa, api-explorer, bug-lab, settings
│   └── lib/                      # API client (request IDs, error envelope), auth context, types
├── e2e/                          # Playwright tests
├── postman/                      # collection, environment, generator
├── scripts/                      # run_all_tests.sh, upload_test_report.py, generate_test_docs.py
├── docs/                         # architecture, database, api, support guide, deployment, test cases, bug reports
├── Dockerfile, docker-compose.yml, render.yaml
└── README.md
```

## 4. Critical user journeys

These drive both the build order and the test plan. Each will get manual test cases and at least the starred ones get Playwright coverage.

| ID | Role | Journey | Key checks |
|---|---|---|---|
| J1* | Any | Log in with demo account → land on role-appropriate dashboard → log out | Wrong password → 401 with generic message; locked nav items per role |
| J2* | Pharmacist | Search patient → open profile → edit phone → save | Validation (phone format, required fields), audit entry written |
| J3* | Pharmacist | Create prescription for patient → submit refill request → approve → status updates everywhere | Duplicate pending refill rejected (409); refills remaining decremented; status refreshes without reload |
| J4* | Support Engineer | Create ticket (category, priority, diagnostics) → investigate → add internal note → escalate → resolve → close | Valid status transitions only; internal notes hidden from non-support roles; history recorded |
| J5 | Support Engineer | Look up a user's request ID in Logs Explorer → find the failing request → link to ticket | Logs redacted; filter by request ID, status code, path |
| J6* | QA Engineer | Create test case → start test run → record Pass/Fail/Blocked → file bug from failure | Run metrics recompute; bug linked to failed result |
| J7 | Support → QA | Convert support ticket into engineering bug report | Bug pre-filled from ticket; bidirectional link |
| J8 | QA Engineer | Bug Lab: enable a defect → reproduce in sandbox → inspect logs → disable → regression test passes | Defect never affects non-sandbox data or requests without `X-Demo-Session` |
| J9 | Any | Unauthorized action (e.g. Support Engineer approving a refill via API) | 403 with request ID; attempt logged |

## 5. Cross-cutting conventions

- **Error envelope** (all non-2xx):
  ```json
  {"error": {"code": "REFILL_DUPLICATE", "message": "A pending refill request already exists for RX-5781.",
             "details": [], "request_id": "req_7b1f0c9a2d4e6f81"}}
  ```
- **Pagination:** `?page=1&page_size=20` (max 100) → `{"items": [...], "total": 248, "page": 1, "page_size": 20}`.
- **Timestamps:** UTC ISO-8601 in API, rendered in the user's local zone in the UI.
- **Optimistic concurrency:** `updated_at` sent back on edits; stale writes → 409.
- **Redaction:** a single `redact()` utility used by both log and audit writers; covered by unit tests.
