# BUG-004 · Double-click creates duplicate refill requests

| Field | Value |
|---|---|
| Severity / Priority | Critical / P1 |
| Environment | Local · MediCare QA Lab 1.0.0 · Bug Lab sandbox |
| Component | `backend/app/services/refills.py` → `submit()` |
| Demo key | `refill_double_submit` |
| Regression test | TC-018, `test_tc018_duplicate_pending_refill_rejected`, `test_tc018_idempotency_key_replays_original`, `test_concurrent_double_submit_creates_one_row`, Postman "Duplicate pending refill → 409" |

## Description
Submitting the same refill twice quickly (double-click, flaky network retry) creates **two pending requests**. If both are approved, the patient could receive medication twice and the refill counter drops by two. Customer ticket: "Duplicate refill requests created" (critical).

## Preconditions
Sandbox reset. Defect `refill_double_submit` **on**.

## Steps to reproduce
1. Bug Lab → Atorvastatin (Lina Nasser) → **Submit twice**. This sends two POSTs with the **same** `Idempotency-Key`.
2. Look at the *Last API response* panel and the row's "2 pending" badge.

## Expected
The second request returns the original refill (idempotent replay) or `409 REFILL_DUPLICATE`, leaving one pending row.

## Actual
```
POST /api/v1/demo/sandbox/refills  Idempotency-Key: doc-double-1  → 201  refill 380  (req_5e84d16399333a3f)
POST /api/v1/demo/sandbox/refills  Idempotency-Key: doc-double-1  → 201  refill 381  (req_41212caa439f724c)
```
SQL verification:
```sql
SELECT prescription_id, count(*) FROM refill_requests
WHERE status = 'pending' GROUP BY 1 HAVING count(*) > 1;   -- returns the sandbox prescription with 2
```

## Investigation
1. Two different refill IDs for one idempotency key mean the server ignored the key.
2. Why didn't the database stop it? The partial unique index `uq_one_pending_refill` deliberately excludes sandbox rows (`WHERE ... AND NOT is_sandbox`), so the application check was the only guard, and it was skipped.
3. Reading `submit()`: both the idempotency lookup and the pending-duplicate check were bypassed.

## Root cause
The idempotency-key lookup and the pending-duplicate check were both skipped. Injection point: `# DEMO-BUG: refill_double_submit`. For real data, the partial unique index is a second line of defense. That's why this defect can only exist in the sandbox.

## Fix and verification
- Fix: restore both checks. Keep the database index as defense in depth.
- Verified with the defect off: two submissions with one key returned the **same** refill ID (382, 382).
- Regression: TC-018 plus a concurrency test (two threads submit at once → one `201`, one `409`, one row).
