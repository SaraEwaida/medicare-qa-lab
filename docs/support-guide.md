# Level 1 support guide

How a support engineer investigates a customer issue in MediCare QA Lab, decides what it is, and either resolves it or hands it to engineering. Everything referenced here exists in the app: Support Center, API & Logs (trace, logs, audit, database checks), and the QA Lab.

## 1. Triage a new ticket (first 15 minutes)

1. **Read the report and the diagnostics.** Category, priority, browser/OS, app version, and especially the **request ID** if the customer copied it from an error message (every error toast and error page shows one).
2. **Check the priority.** Raise it if patient care is affected (wrong medication data, duplicate dispensing, refills blocked). Lower it if there's a workaround and only one user is affected.
3. **Assign it to yourself** and move it to **Investigating**. The ticket history records who did what and when.
4. **Send a first reply** (template below) so the customer knows it's being worked.

## 2. Investigate

| Question | Where to look |
|---|---|
| What did the server actually return? | API & Logs → **Trace a request** → paste the request ID. Shows status, path, duration, role and redacted context. |
| Did the request change data? | The same trace's **Data changes** panel (audit entries written by that request). |
| Is it happening to others? | **Request logs** → filter `4xx`/`5xx` and the path; **Most frequent errors (24 h)**. |
| Is the data consistent? | **Database checks**: read-only SQL rules, e.g. refill counters match approved refills. |
| Can I reproduce it? | Use the same role. Use the **API console** to send the exact request and compare responses. |
| Is it a permission issue? | Audit trail → action `permission_denied`. Compare with the role table in `docs/api.md`. |

### Reading status codes
| Code | Usually means | Typical L1 outcome |
|---|---|---|
| 401 | Session expired (60 min) or not signed in | Explain; ask the user to sign in again |
| 403 | Role lacks permission | Explain the role boundary; route to someone with the right role |
| 404 | Wrong ID, or a record the role can't see | Confirm the ID; check the role |
| 409 | Duplicate, invalid status change, or edited by someone else | Explain the rule in the message; resolve by reloading or completing the blocking step |
| 422 | Field validation | Point to the field listed in `error.details` |
| 500 | Unexpected server error | **Always** convert to a bug with the request ID as evidence |

## 3. Decide

- **User error or expected behavior.** Explain, link to the rule, and resolve. Examples: a 60-minute session timeout; deactivating a patient blocked by an on-hold prescription.
- **Data problem.** Correct it with the right role, document what changed (the audit log keeps the record), and resolve.
- **Defect.** On the ticket, choose **Convert to bug**, set severity and priority, and add reproduction steps. The bug is pre-filled from the ticket, linked both ways, and carries the request ID as evidence. Leave the ticket **Escalated** until QA verifies the fix, then resolve it, referencing the bug code.

### Severity vs priority (for converted bugs)
- **Severity** is user impact. *Critical*: wrong or duplicate medication, data loss. *Major*: core workflow blocked with no workaround. *Minor*: workaround exists. *Trivial*: cosmetic.
- **Priority** is fix order (P1–P4). It considers how many users are affected and timing, not only impact.

## 4. Worked example: "Refill approved but still shows pending"

1. The customer's request ID trace shows `POST /refill-requests/{id}/approve → 200`. The audit shows `pending → approved`. The data is correct.
2. Re-reading the refill shows *approved*. Only the response or the UI was stale. Reproduced in the Bug Lab with `refill_status_stale`.
3. Converted to a bug: severity **Major**, priority **P1**, request ID attached. QA confirmed the root cause (BUG-001), engineering fixed it, and QA verified it with TC-017.
4. The ticket was resolved with a pointer to BUG-001 and the fixed version.

## 5. Customer reply templates

**First response**
> Hi {name}, thanks for reporting this. I'm looking into why the refill for {RX code} still shows as pending after approval. I can see your request reached our system at {time}, and I'm checking what happened next. I'll update you within {timeframe}. In the meantime, reloading the page shows the current status.

**Update: escalated to engineering**
> Hi {name}, I've reproduced the issue and confirmed your approval was saved correctly; only the on-screen status was out of date. Our engineering team is fixing it under reference {BUG code}. Reloading the page after approving shows the correct status until the fix is released. I'll let you know as soon as it's live.

**Resolution**
> Hi {name}, the fix for the refill status display is now live (version {version}). Approved refills now update immediately without a reload. I've verified it on our side; please let me know if you still see it. I'll close this ticket in 3 days if we don't hear back.

**Expected behavior (no defect)**
> Hi {name}, thanks for checking with us. Sessions end after 60 minutes for security, which is why you were asked to sign in again. Your work up to that point was saved. If this happens sooner than an hour after signing in, reply with the time and I'll look into it.

## 6. Privacy rules for support

- Logs and audit entries are **redacted**: names, emails, phones, addresses, search terms and diagnostic notes are masked before storage. Don't ask customers to paste patient details into tickets; ask for **patient codes** (P-1234) and **request IDs** instead.
- Support engineers see **masked** patient contact details. Only pharmacists see full details.
- All data in this application is synthetic. This system isn't HIPAA-compliant and hasn't been independently audited.
