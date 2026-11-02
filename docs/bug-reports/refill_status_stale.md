# BUG-001 · Refill approval returns stale "pending" status

| Field | Value |
|---|---|
| Severity / Priority | Major / P1 |
| Environment | Local · MediCare QA Lab 1.0.0 · Chrome 130 / Windows 11 · Bug Lab sandbox |
| Component | `backend/app/services/refills.py` → `approve()` |
| Demo key | `refill_status_stale` |
| Regression test | TC-017, `e2e/tests/refills.spec.ts`, `e2e/tests/buglab.spec.ts`, `test_bug_reproduces_refill_status_stale` |

## Description
After a pharmacist approves a refill, the status badge keeps showing **Pending**. The approval did succeed: the database is updated and a page reload shows **Approved**. Users who trust the screen may approve twice or tell the patient the refill is still waiting. The customer report for this is ticket "Refill approved but still shows pending".

## Preconditions
QA Engineer signed in. Bug Lab → **Reset sandbox**. Defect `refill_status_stale` **on**.

## Steps to reproduce
1. Bug Lab → Sandbox prescriptions → Lisinopril (Nora Haddad) → **Request refill**. The latest refill shows *Pending*.
2. Click **Approve**.
3. Look at the status badge and the *Last API response* panel.
4. Click **Reload from server**.

## Expected
The approve response has `status: "approved"` and `refills_remaining` decremented. The UI updates immediately.

## Actual
HTTP 200, but the body still shows the pre-approval state. The UI shows *Pending* until reloaded.

```json
// POST /api/v1/demo/sandbox/refills/378/approve → 200   (request ID req_f7e7153032148d88)
{ "id": 378, "rx_code": "RX-5477", "status": "pending", "refills_remaining": 3, "reviewed_at": null }

// GET /api/v1/demo/sandbox/refills/378 → 200   (re-read straight after)
{ "id": 378, "status": "approved", "refills_remaining": 2, "reviewed_at": "2026-11-02T20:22:33.123282+02:00" }
```

## Investigation
1. **Is it the UI or the API?** The Network tab and the Bug Lab's *Last API response* show that the server itself returned `pending`, so this isn't a client caching problem.
2. **Did the write happen?** A re-read (GET) and the audit trail (`status_change pending → approved`, same request ID) show the database is correct.
3. **So the response is built from old data.** Reading `approve()`: the response dict was serialized from a snapshot taken *before* the status change and counter decrement, and that snapshot was returned instead of re-reading the row after commit.

## Root cause
`approve()` returned a pre-update snapshot instead of serializing the refill after commit. The injection point is marked `# DEMO-BUG: refill_status_stale`.

## Fix and verification
- Fix: serialize the refill after commit (the normal code path). In the lab, switching the defect **off** activates it.
- Verified: approve now returns `"status": "approved"` with `refills_remaining` decremented, and the badge updates without a reload.
- Regression: TC-017 (manual), `refills.spec.ts` (UI updates in place), `test_tc017_approve_updates_status_and_decrements` (API). All pass.
