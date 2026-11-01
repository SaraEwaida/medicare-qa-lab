# Database design

PostgreSQL 16. 18 tables in 5 groups. The full DDL is in [`schema.sql`](schema.sql). Constraint checks are in [`schema-checks.sql`](schema-checks.sql) (validated against PostgreSQL 16: all 12 negative cases rejected as intended).

## Entity relationships

```mermaid
erDiagram
    users ||--o{ patients : creates
    users ||--o{ refill_requests : "requests / reviews"
    users ||--o{ support_tickets : "assigned"
    users ||--o{ ticket_notes : writes
    users ||--o{ test_runs : starts
    users ||--o{ bug_reports : reports

    patients ||--o{ prescriptions : has
    medications ||--o{ prescriptions : "prescribed as"
    prescriptions ||--o{ refill_requests : receives

    patients |o--o{ support_tickets : "may concern"
    prescriptions |o--o{ support_tickets : "may concern"
    support_tickets ||--o{ ticket_notes : has
    support_tickets ||--o{ ticket_events : "history"
    support_tickets |o--o{ bug_reports : "converted to"

    test_cases ||--o{ test_case_steps : has
    test_runs ||--o{ test_run_results : contains
    test_cases ||--o{ test_run_results : "executed as"
    test_run_results |o--o{ bug_reports : "failure filed as"
    test_cases |o--o{ bug_reports : "regression check"

    automation_runs ||--o{ automation_results : contains
    test_cases |o--o{ automation_results : "covered by"

    demo_bug_flags |o--o{ bug_reports : "documents"
    users ||--o{ app_logs : "acting user"
    users ||--o{ audit_logs : actor
```

## Groups

| Group | Tables | Notes |
|---|---|---|
| Identity | `users` | Role enum: pharmacist, support_engineer, qa_engineer. bcrypt hashes only. |
| Pharmacy | `patients`, `medications`, `prescriptions`, `refill_requests` | `ON DELETE RESTRICT` where history matters. Patients are deactivated, never hard-deleted. |
| Support | `support_tickets`, `ticket_notes`, `ticket_events` | Diagnostic fields on the ticket; `related_request_id` links to `app_logs`. |
| QA | `test_cases`, `test_case_steps`, `test_runs`, `test_run_results`, `bug_reports`, `automation_runs`, `automation_results` | Metrics are computed from these tables, never stored as totals. |
| Platform | `demo_bug_flags`, `app_logs`, `audit_logs` | Logs are redacted before insert. |

## Integrity rules enforced in the database

Defense in depth: the API validates first and returns friendly errors, and the database still enforces the rules if the API has a bug.

| Rule | Mechanism |
|---|---|
| No duplicate real patient (same name + DOB, case-insensitive) | Partial unique index `uq_patient_identity` |
| One active prescription per patient + medication | Partial unique index `uq_active_rx_per_med` |
| One pending refill per prescription | Partial unique index `uq_one_pending_refill` |
| Double-submit protection | `refill_requests.idempotency_key UNIQUE` |
| `0 ≤ refills_remaining ≤ refills_authorized` | CHECK |
| Rejected refill needs a reason; pending ⇔ not yet reviewed | CHECK |
| Resolved/closed ticket needs a resolution | CHECK |
| Failed test result needs an actual result | CHECK |
| Verified/closed bug needs a root cause | CHECK |
| Automation totals add up | CHECK `passed + failed + skipped = total` |
| DOB in the past; phone format | CHECK |

Partial indexes exclude `is_sandbox = true` rows. That lets the Bug Lab reproduce "duplicate request" defects on sandbox data while real data stays protected.

## Business identifiers

Generated from sequences: `P-1001`, `RX-5001`, `SUP-1001`, `TC-001`, `BUG-001`. Gaps after a rolled-back insert are expected Postgres behavior and not a defect. This is a useful QA talking point.

## Notes for Phase 3 (Alembic)

- Name every CHECK constraint explicitly (e.g. `ck_refill_rejection_reason`) so the API can map a DB `IntegrityError` to a specific error code.
- Add `updated_at` triggers or ORM `onupdate` handling.
- Add a scheduled `app_logs` retention delete (14 days).
