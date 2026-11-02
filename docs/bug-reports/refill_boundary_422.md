# BUG-002 · Refill rejected with 422 when exactly 1 refill remains

| Field | Value |
|---|---|
| Severity / Priority | Major / P2 |
| Environment | Local · MediCare QA Lab 1.0.0 · Bug Lab sandbox |
| Component | `backend/app/services/refills.py` → `submit()` |
| Demo key | `refill_boundary_422` |
| Regression test | TC-019, `test_tc019_boundary_one_remaining_ok_zero_rejected`, `test_bug_reproduces_boundary_422` |

## Description
A valid refill request is rejected as if no refills were left when the prescription has **exactly one** refill remaining. Patients on their last refill can't get it through the normal flow. This is a classic off-by-one boundary defect.

## Preconditions
Sandbox reset. Defect `refill_boundary_422` **on**. Sandbox Metformin (Omar Khalil, RX-5478) shows **1 / 3** refills left.

## Steps to reproduce
1. Bug Lab → Sandbox prescriptions → Metformin → **Request refill**.
2. Read the error toast and the *Last API response* panel.

## Expected
`201 Created`, refill *Pending* (1 remaining is a valid request; 0 is not).

## Actual
```json
// POST /api/v1/demo/sandbox/refills?prescription_id=478 → 422   (req_862064037361260d)
{ "error": { "code": "NO_REFILLS_REMAINING", "message": "No refills remaining on RX-5478.",
  "details": [{ "field": "prescription_id", "issue": "No refills remaining on RX-5478." }],
  "request_id": "req_862064037361260d" } }
```
Log entry (Logs Explorer → Trace):
```json
{ "level": "WARNING", "method": "POST", "path": "/api/v1/demo/sandbox/refills", "status_code": 422,
  "duration_ms": 8, "user_role": "qa_engineer", "context": { "query": { "prescription_id": "478" } }, "is_demo": true }
```

## Investigation
1. The UI says "No refills remaining", but the prescription page shows 1 left. Is the data wrong? Running the **Database checks** shows `refill_counter_consistency` passes, so the stored counter is correct.
2. The trace shows a 422 raised by validation, not by a database constraint (no `CONSTRAINT_VIOLATION` code).
3. Boundary testing: 2 remaining → 201, 1 remaining → 422, 0 remaining → 422. The failure starts exactly at the boundary, which points to the comparison operator.

## Root cause
The availability check used `refills_remaining > 1` instead of `>= 1`. Injection point: `# DEMO-BUG: refill_boundary_422`.

## Fix and verification
- Fix: compare with `>= 1`.
- Verified: the same request with the defect off returned `201` with status `pending`.
- Regression: TC-019 covers both sides of the boundary (1 accepted, 0 rejected) and passes in pytest.
