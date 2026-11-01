# API design

Base path `/api/v1`. JSON only. Swagger UI at `/docs`, OpenAPI at `/openapi.json`.
All endpoints except `POST /auth/login` and `GET /health` require `Authorization: Bearer <token>`.

## Conventions

| Topic | Rule |
|---|---|
| Request ID | Client may send `X-Request-ID`; otherwise server generates `req_<ulid>`. Always echoed in the response header and the error body. |
| Errors | `{"error": {"code", "message", "details": [{"field", "issue"}], "request_id"}}` |
| Pagination | `page` (≥1), `page_size` (1–100, default 20) → `{items, total, page, page_size}` |
| Sorting | `sort=field` / `sort=-field` from an allow-list per resource; unknown field → 422 |
| Concurrency | `PATCH` bodies include `updated_at`; mismatch → 409 `STALE_WRITE` |
| Idempotency | `POST /refill-requests` accepts an `Idempotency-Key` header; a replay returns the original 201 response |
| Demo mode | `X-Demo-Session: <id>` header. Ignored unless `DEMO_BUGS_ENABLED=true` and the target rows are sandbox rows |

### Status codes used

| Code | When |
|---|---|
| 200 / 201 / 204 | Success / created / deleted or no body |
| 400 | Malformed request (bad JSON) |
| 401 | Missing, invalid or expired token; bad credentials (`INVALID_CREDENTIALS`, generic message) |
| 403 | Authenticated but role lacks permission (`FORBIDDEN`) |
| 404 | Resource not found (also returned for resources hidden by role to avoid leaking existence) |
| 409 | Duplicate (`PATIENT_DUPLICATE`, `PRESCRIPTION_DUPLICATE`, `REFILL_DUPLICATE`), invalid state transition (`INVALID_TRANSITION`), stale write |
| 422 | Field validation failure (`VALIDATION_ERROR`, with per-field `details`) |
| 429 | Login rate limit (5 attempts/minute per IP+email) |
| 500 | Unhandled. Generic message plus request ID; stack trace only in logs |

## Endpoints

### Auth & system
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Email + password → `{access_token, token_type, expires_in, user}` |
| GET | `/auth/me` | Current user + permission list (frontend builds nav from it) |
| GET | `/health` | Liveness + DB connectivity |

### Dashboard
| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/summary` | KPI counts (active patients, active Rx, pending refills, open tickets, latest pass rate) with `?from&to` |
| GET | `/dashboard/prescription-activity` | Daily new prescriptions vs. refills, `?from&to&granularity=day|week` |
| GET | `/dashboard/recent` | Latest tickets, open bugs, latest test run |

### Patients
| Method | Path | Purpose |
|---|---|---|
| GET | `/patients` | Search `q` (name, patient code, email, phone), filter `status`, paginate, sort |
| POST | `/patients` | Create (409 on duplicate identity) |
| GET | `/patients/{id}` | Profile + summary counts |
| PATCH | `/patients/{id}` | Edit (optimistic concurrency) |
| POST | `/patients/{id}/deactivate` | Soft-deactivate (blocked if active prescriptions exist → 409) |
| GET | `/patients/{id}/prescriptions` | Prescriptions for the patient |
| GET | `/patients/{id}/medication-history` | Prescriptions + refill timeline |

### Medications & prescriptions
| Method | Path | Purpose |
|---|---|---|
| GET | `/medications` | Catalog lookup `q` |
| GET | `/prescriptions` | Filter `status`, `patient_id`, `medication_id`, `q` |
| POST | `/prescriptions` | Create (409 duplicate active, 422 invalid quantity/refills/dates, 409 inactive patient) |
| GET | `/prescriptions/{id}` | Detail + refill history |
| PATCH | `/prescriptions/{id}` | Edit dosage, end date, notes |
| POST | `/prescriptions/{id}/status` | Transition (`on_hold`, `cancelled`, `active`) with allowed-transition check |

### Refill requests
| Method | Path | Purpose |
|---|---|---|
| GET | `/refill-requests` | Filter `status`, `prescription_id`, date range |
| POST | `/refill-requests` | Submit for a prescription (422 if no refills remaining or Rx not active; 409 if one is pending) |
| POST | `/refill-requests/{id}/approve` | Approve → decrements `refills_remaining` in the same transaction |
| POST | `/refill-requests/{id}/reject` | Reject with required reason |
| POST | `/refill-requests/{id}/dispense` | Mark dispensed |
| POST | `/refill-requests/{id}/cancel` | Cancel a pending request |

Refill state machine: `pending → approved → dispensed`, `pending → rejected`, `pending → cancelled`. All other transitions → 409 `INVALID_TRANSITION`.

### Support tickets
| Method | Path | Purpose |
|---|---|---|
| GET | `/tickets` | Filter `status`, `priority`, `category`, `assignee_id`, `q` |
| POST | `/tickets` | Create with category, priority, description, diagnostics |
| GET | `/tickets/{id}` | Detail + notes (internal notes only for permitted roles) + events |
| PATCH | `/tickets/{id}` | Edit priority/category/diagnostics |
| POST | `/tickets/{id}/assign` | Assign to a user |
| POST | `/tickets/{id}/status` | Transition (escalate requires a note; resolve requires a resolution) |
| POST | `/tickets/{id}/notes` | Add investigation note |
| POST | `/tickets/{id}/convert-to-bug` | Create a pre-filled bug report linked to the ticket |

Ticket state machine: `open → investigating → escalated → investigating`, `investigating|escalated → resolved → closed`, `resolved → investigating` (reopen).

### QA
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/qa/test-cases` | List (filter module/type/automated) / create with steps |
| GET/PATCH/DELETE | `/qa/test-cases/{id}` | Detail / edit / archive (soft) |
| GET/POST | `/qa/test-runs` | List / start a run with selected case IDs |
| GET | `/qa/test-runs/{id}` | Run with results and computed stats |
| PATCH | `/qa/test-runs/{id}/results/{result_id}` | Record Pass/Fail/Blocked + actual result |
| POST | `/qa/test-runs/{id}/complete` | Close the run |
| GET/POST | `/qa/bugs` | List (filter status/severity/priority) / create |
| GET/PATCH | `/qa/bugs/{id}` | Detail / update status, root cause, fix notes |
| POST | `/qa/automation-runs` | Ingest a Playwright JSON or pytest JUnit report (real results only) |
| GET | `/qa/automation-runs` | History of automated runs |
| GET | `/qa/metrics` | Pass rate, execution progress, coverage (cases with ≥1 linked automated test), bugs by severity, regression trend |

### Observability
| Method | Path | Purpose |
|---|---|---|
| GET | `/logs` | Filter `request_id`, `level`, `status_code`, `path`, `from`, `to` |
| GET | `/logs/requests/{request_id}` | All log lines for one request (trace view) |
| GET | `/audit` | Filter `entity_type`, `entity_id`, `actor_id` |
| GET | `/api-catalog` | Example request/response pairs for the troubleshooting docs page |

### Bug Lab (controlled demo)
| Method | Path | Purpose |
|---|---|---|
| GET | `/demo/bugs` | List injectable defects + state |
| POST | `/demo/bugs/{key}/toggle` | Enable/disable a defect |
| POST | `/demo/sandbox/reset` | Wipe and reseed sandbox rows |

Planned defects (keys): `refill_status_stale` (UI does not invalidate cache after approve), `refill_validation_500` (unhandled error returns 500 instead of 422), `search_case_sensitive` (patient search ignores lowercase matches), `refill_double_submit` (idempotency and UI guard bypassed, so duplicates are created on sandbox data).

## Role-based access matrix

✅ allowed · 👁 read-only · ❌ denied (403)

| Permission | Pharmacist | Support Engineer | QA Engineer |
|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ |
| Patients: read | ✅ | 👁 (masked contact info) | 👁 |
| Patients: create / edit / deactivate | ✅ | ❌ | ❌ |
| Prescriptions: read | ✅ | 👁 | 👁 |
| Prescriptions: create / edit / status | ✅ | ❌ | ❌ |
| Refills: submit | ✅ | ❌ | ❌ |
| Refills: approve / reject / dispense | ✅ | ❌ | ❌ |
| Tickets: create | ✅ | ✅ | ✅ |
| Tickets: read own | ✅ | ✅ | ✅ |
| Tickets: read all, assign, transition, internal notes | ❌ | ✅ | 👁 (read all + internal notes) |
| Tickets: convert to bug | ❌ | ✅ | ✅ |
| QA test cases / runs: write | ❌ | ❌ | ✅ |
| QA test cases / runs / metrics: read | ❌ | 👁 | ✅ |
| Bug reports: create / edit | ❌ | ✅ create only | ✅ |
| Logs & audit | ❌ | ✅ | ✅ |
| Bug Lab toggles, sandbox reset | ❌ | ❌ | ✅ |

The frontend reads the permission list from `/auth/me` to build navigation. Every rule above is also enforced and tested on the API.
