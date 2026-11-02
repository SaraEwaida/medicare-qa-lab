# Manual test cases

30 documented test cases. They are seeded into the QA Lab (TC-001 … TC-030), where they can be executed in test runs. Generated from `backend/app/db/seed_data.py`.

Demo password for all accounts: `Demo@2026!`

| ID | Title | Module | Type | Priority | Automated by |
|---|---|---|---|---|---|
| [TC-001](#tc-001) | Login with valid pharmacist credentials | auth | smoke | P1 | `e2e/tests/auth.spec.ts` |
| [TC-002](#tc-002) | Login rejected with wrong password shows a generic error | auth | security | P1 | `e2e/tests/auth.spec.ts` |
| [TC-003](#tc-003) | Login is rate-limited after 5 failed attempts | auth | security | P2 | `backend/tests/integration/test_auth.py` |
| [TC-004](#tc-004) | Invalid or missing token returns 401 with request ID | api | security | P1 | `backend/tests/integration/test_auth.py` |
| [TC-005](#tc-005) | Support engineer cannot approve a refill (403) | security | security | P1 | `backend/tests/integration/test_rbac.py` |
| [TC-006](#tc-006) | Navigation shows only modules allowed for the role | auth | functional | P2 | `e2e/tests/rbac.spec.ts` |
| [TC-007](#tc-007) | Create a patient with valid data | patients | functional | P1 | `e2e/tests/patients.spec.ts` |
| [TC-008](#tc-008) | Patient form rejects a future date of birth | patients | functional | P2 | `backend/tests/integration/test_patients.py` |
| [TC-009](#tc-009) | Duplicate patient (same name and DOB, different case) is rejected | patients | functional | P1 | `backend/tests/integration/test_patients.py` |
| [TC-010](#tc-010) | Patient search by name is case-insensitive | patients | regression | P2 | `e2e/tests/patients.spec.ts` |
| [TC-011](#tc-011) | Editing a patient writes a redacted audit entry | patients | security | P2 | `backend/tests/integration/test_patients.py` |
| [TC-012](#tc-012) | Concurrent edit of a patient returns 409 stale write | patients | functional | P3 | `backend/tests/integration/test_patients.py` |
| [TC-013](#tc-013) | Non-pharmacist roles see masked patient contact details | security | security | P2 | `backend/tests/integration/test_rbac.py` |
| [TC-014](#tc-014) | Create prescription: refills remaining equals refills authorized | prescriptions | functional | P1 | `e2e/tests/refills.spec.ts` |
| [TC-015](#tc-015) | Prescription quantity boundaries (0, 1, 1000, 1001) | prescriptions | functional | P2 | `backend/tests/integration/test_prescriptions.py` |
| [TC-016](#tc-016) | Duplicate active prescription for the same medication is rejected | prescriptions | functional | P1 | `backend/tests/integration/test_prescriptions.py` |
| [TC-017](#tc-017) | Submit and approve a refill; status updates without reload | refills | regression | P1 | `e2e/tests/refills.spec.ts` |
| [TC-018](#tc-018) | Second pending refill for the same prescription is rejected | refills | regression | P1 | `backend/tests/integration/test_refills.py` |
| [TC-019](#tc-019) | Refill boundary: 1 remaining accepted, 0 remaining rejected | refills | regression | P1 | `backend/tests/integration/test_refills.py` |
| [TC-020](#tc-020) | Rejecting a refill requires a reason | refills | functional | P2 | `backend/tests/integration/test_refills.py` |
| [TC-021](#tc-021) | Create a support ticket with diagnostic information | tickets | functional | P1 | `e2e/tests/tickets.spec.ts` |
| [TC-022](#tc-022) | Ticket workflow enforces valid transitions | tickets | functional | P1 | `backend/tests/integration/test_tickets.py` |
| [TC-023](#tc-023) | Internal ticket notes are hidden from the pharmacist | tickets | security | P2 | `backend/tests/integration/test_tickets.py` |
| [TC-024](#tc-024) | Convert a support ticket into an engineering bug | tickets | functional | P2 | `e2e/tests/tickets.spec.ts` |
| [TC-025](#tc-025) | Failed test result requires actual result; pass rate recalculates | qa | functional | P1 | `e2e/tests/qa.spec.ts` |
| [TC-026](#tc-026) | Validation errors return a 422 envelope with field details | api | api | P1 | `postman/MediCare-QA-Lab.postman_collection.json` |
| [TC-027](#tc-027) | Request ID from an error leads to the matching log entry | api | functional | P2 | `backend/tests/integration/test_logging.py` |
| [TC-028](#tc-028) | Logs never contain patient names, emails or phone numbers | security | security | P1 | `backend/tests/integration/test_logging.py` |
| [TC-029](#tc-029) | Enabled Bug Lab defects do not affect normal application paths | security | regression | P1 | `backend/tests/integration/test_demo_isolation.py` |
| [TC-030](#tc-030) | Database consistency checks pass after workflows | api | regression | P2 | `backend/tests/integration/test_logging.py` |

## TC-001

**Login with valid pharmacist credentials**

- **Module:** auth · **Type:** smoke · **Priority:** P1
- **Preconditions:** Demo accounts seeded. User is logged out.

| Step | Action | Expected |
|---|---|---|
| 1 | Open the login page. | Login form with email and password fields is shown. |
| 2 | Enter pharmacist@medicare.example.com and the demo password; click Sign in. |  |

**Expected result:** Dashboard opens; header shows 'Maya Pharmacist · Pharmacist'; sidebar shows Patients and Prescriptions.

## TC-002

**Login rejected with wrong password shows a generic error**

- **Module:** auth · **Type:** security · **Priority:** P1
- **Preconditions:** User is logged out.

| Step | Action | Expected |
|---|---|---|
| 1 | Enter a valid email with a wrong password; click Sign in. |  |

**Expected result:** Error 'Invalid email or password.' is shown; no hint whether the email exists; user stays on login page.

## TC-003

**Login is rate-limited after 5 failed attempts**

- **Module:** auth · **Type:** security · **Priority:** P2
- **Preconditions:** User is logged out.

| Step | Action | Expected |
|---|---|---|
| 1 | Submit a wrong password 5 times for the same email. | Each attempt returns 401. |
| 2 | Submit a 6th attempt within one minute. |  |

**Expected result:** 6th attempt returns 429 'Too many login attempts' with a Retry-After header.

## TC-004

**Invalid or missing token returns 401 with request ID**

- **Module:** api · **Type:** security · **Priority:** P1
- **Preconditions:** API reachable (Postman or curl).

| Step | Action | Expected |
|---|---|---|
| 1 | GET /api/v1/patients without Authorization header. |  |
| 2 | GET /api/v1/patients with 'Authorization: Bearer invalid'. |  |

**Expected result:** Both return 401 with error.code UNAUTHORIZED and an error.request_id matching the X-Request-ID header.

## TC-005

**Support engineer cannot approve a refill (403)**

- **Module:** security · **Type:** security · **Priority:** P1
- **Preconditions:** A pending refill exists. Token for support@medicare.example.com.

| Step | Action | Expected |
|---|---|---|
| 1 | POST /api/v1/refill-requests/{id}/approve with the support token. |  |
| 2 | Check Logs Explorer → Audit for a permission_denied entry. |  |

**Expected result:** 403 FORBIDDEN; refill stays pending; audit log records permission_denied.

## TC-006

**Navigation shows only modules allowed for the role**

- **Module:** auth · **Type:** functional · **Priority:** P2
- **Preconditions:** Demo accounts seeded.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as Pharmacist and note sidebar items. | No Logs Explorer, no Bug Lab. |
| 2 | Log in as QA Engineer and note sidebar items. | QA Lab, Logs Explorer and Bug Lab are visible. |

**Expected result:** Each role sees only permitted modules; opening a hidden URL directly shows an 'access restricted' state.

## TC-007

**Create a patient with valid data**

- **Module:** patients · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Patients → New patient. | Form opens. |
| 2 | Fill first/last name, a past date of birth, phone '+970 59 123 4567'; Save. |  |

**Expected result:** Success toast; new patient code (P-xxxx) shown; patient appears at top of the directory.

## TC-008

**Patient form rejects a future date of birth**

- **Module:** patients · **Type:** functional · **Priority:** P2
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Patients → New patient; enter tomorrow's date as date of birth; Save. |  |
| 2 | Change date of birth to today; Save. |  |

**Expected result:** Tomorrow: inline error 'Date of birth cannot be in the future', no request saved. Today: accepted (boundary).

## TC-009

**Duplicate patient (same name and DOB, different case) is rejected**

- **Module:** patients · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Patient 'John Turner' 1985-06-14 exists.

| Step | Action | Expected |
|---|---|---|
| 1 | Create patient 'john' 'TURNER' with DOB 1985-06-14. |  |

**Expected result:** 409 PATIENT_DUPLICATE with message naming the existing patient code; no new row in patients table.

## TC-010

**Patient search by name is case-insensitive**

- **Module:** patients · **Type:** regression · **Priority:** P2
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Note an existing patient's first name, e.g. 'Layla'. |  |
| 2 | Search the directory for the name in lowercase ('layla'). |  |

**Expected result:** Matching patients are returned regardless of letter case. (Regression for BUG: search_case_sensitive.)

## TC-011

**Editing a patient writes a redacted audit entry**

- **Module:** patients · **Type:** security · **Priority:** P2
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Support/QA account available to read audit logs.

| Step | Action | Expected |
|---|---|---|
| 1 | Open a patient → Edit → change phone number → Save. | Success toast. |
| 2 | As QA, open Logs Explorer → Audit, filter entity_type=patient. |  |

**Expected result:** Audit entry 'update' exists for the patient; phone values show [REDACTED], not the real numbers.

## TC-012

**Concurrent edit of a patient returns 409 stale write**

- **Module:** patients · **Type:** functional · **Priority:** P3
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Same patient open in two tabs.

| Step | Action | Expected |
|---|---|---|
| 1 | Save a change in tab A. |  |
| 2 | Save a different change in tab B (without reload). |  |

**Expected result:** Tab B gets 409 STALE_WRITE: 'changed by someone else. Reload and try again.' Tab A's change is kept.

## TC-013

**Non-pharmacist roles see masked patient contact details**

- **Module:** security · **Type:** security · **Priority:** P2
- **Preconditions:** Logged in as Support Engineer (support@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Open Patients directory. |  |
| 2 | Open a patient profile. |  |

**Expected result:** Email and phone are masked (e.g. a***@example.com, ***-***-4567); DOB, address and allergies hidden.

## TC-014

**Create prescription: refills remaining equals refills authorized**

- **Module:** prescriptions · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Active patient without Amlodipine.

| Step | Action | Expected |
|---|---|---|
| 1 | Prescriptions → New prescription; choose patient, Amlodipine 5 mg, qty 30, refills 3; Save. |  |

**Expected result:** RX code generated; status Active; refills 3 of 3 remaining.

## TC-015

**Prescription quantity boundaries (0, 1, 1000, 1001)**

- **Module:** prescriptions · **Type:** functional · **Priority:** P2
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Submit quantity 0. | 422 |
| 2 | Submit quantity 1. | 201 |
| 3 | Submit quantity 1000. | 201 |
| 4 | Submit quantity 1001. | 422 |

**Expected result:** 0 and 1001 rejected with field error on 'quantity'; 1 and 1000 accepted.

## TC-016

**Duplicate active prescription for the same medication is rejected**

- **Module:** prescriptions · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Patient has an active Lisinopril 10 mg prescription.

| Step | Action | Expected |
|---|---|---|
| 1 | Create another Lisinopril 10 mg prescription for the same patient. |  |

**Expected result:** 409 PRESCRIPTION_DUPLICATE naming the existing RX code.

## TC-017

**Submit and approve a refill; status updates without reload**

- **Module:** refills · **Type:** regression · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Active prescription with ≥1 refill remaining.

| Step | Action | Expected |
|---|---|---|
| 1 | Open the prescription → Request refill. | Refill appears as Pending. |
| 2 | Prescriptions → Refill queue → Approve. |  |

**Expected result:** Status changes to Approved immediately (no reload); refills remaining decreases by 1. (Regression for BUG: refill_status_stale.)

## TC-018

**Second pending refill for the same prescription is rejected**

- **Module:** refills · **Type:** regression · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Prescription already has a pending refill.

| Step | Action | Expected |
|---|---|---|
| 1 | Submit another refill for the same prescription (or double-click Submit). |  |

**Expected result:** 409 REFILL_DUPLICATE; only one pending row exists. (Regression for BUG: refill_double_submit.)

## TC-019

**Refill boundary: 1 remaining accepted, 0 remaining rejected**

- **Module:** refills · **Type:** regression · **Priority:** P1
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Prescriptions with exactly 1 and 0 refills remaining.

| Step | Action | Expected |
|---|---|---|
| 1 | Request a refill on the prescription with 1 remaining. | 201 Pending. |
| 2 | Request a refill on the prescription with 0 remaining. |  |

**Expected result:** 0 remaining → 422 NO_REFILLS_REMAINING. (Regression for BUG: refill_boundary_422.)

## TC-020

**Rejecting a refill requires a reason**

- **Module:** refills · **Type:** functional · **Priority:** P2
- **Preconditions:** Logged in as Pharmacist (pharmacist@medicare.example.com). Pending refill exists.

| Step | Action | Expected |
|---|---|---|
| 1 | Click Reject and submit an empty reason. | Inline validation error. |
| 2 | Enter 'Prescriber requested hold' and submit. |  |

**Expected result:** Refill becomes Rejected; reason shown in the prescription's refill history.

## TC-021

**Create a support ticket with diagnostic information**

- **Module:** tickets · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Support Engineer (support@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Support Center → New ticket. |  |
| 2 | Fill subject, category Refill, priority High, description, browser, OS, related request ID; Submit. |  |

**Expected result:** Ticket SUP-xxxx created with status Open; diagnostics visible on detail; 'created' event in history.

## TC-022

**Ticket workflow enforces valid transitions**

- **Module:** tickets · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as Support Engineer (support@medicare.example.com). An Open ticket exists.

| Step | Action | Expected |
|---|---|---|
| 1 | Try Open → Resolved. | 409 INVALID_TRANSITION. |
| 2 | Investigating → Escalated without a note. | 422 note required. |
| 3 | Resolve with a resolution text, then Close. |  |

**Expected result:** Only allowed transitions succeed; history shows every status change with actor and time.

## TC-023

**Internal ticket notes are hidden from the pharmacist**

- **Module:** tickets · **Type:** security · **Priority:** P2
- **Preconditions:** Pharmacist created a ticket; support added an internal note.

| Step | Action | Expected |
|---|---|---|
| 1 | As Pharmacist open the ticket. |  |

**Expected result:** Internal notes and diagnostic notes are not shown or returned by the API.

## TC-024

**Convert a support ticket into an engineering bug**

- **Module:** tickets · **Type:** functional · **Priority:** P2
- **Preconditions:** Logged in as Support Engineer (support@medicare.example.com). Ticket with a related request ID.

| Step | Action | Expected |
|---|---|---|
| 1 | Open ticket → Convert to bug; choose severity Major, priority P2; confirm. |  |

**Expected result:** BUG-xxx created, linked to the ticket (both directions); evidence includes the request ID.

## TC-025

**Failed test result requires actual result; pass rate recalculates**

- **Module:** qa · **Type:** functional · **Priority:** P1
- **Preconditions:** Logged in as QA Engineer (qa@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | QA Lab → New run with 3 cases. | All Not Run, progress 0%. |
| 2 | Mark one Failed without actual result. | Validation error. |
| 3 | Mark Passed, Failed (with actual result), Blocked. |  |

**Expected result:** Stats show 1/1/1, progress 100%, pass rate 33.3%; dashboard KPI reflects the new run.

## TC-026

**Validation errors return a 422 envelope with field details**

- **Module:** api · **Type:** api · **Priority:** P1
- **Preconditions:** Pharmacist token.

| Step | Action | Expected |
|---|---|---|
| 1 | POST /api/v1/patients with first_name '' and email 'not-an-email'. |  |

**Expected result:** 422 VALIDATION_ERROR; details list first_name and email; request_id present.

## TC-027

**Request ID from an error leads to the matching log entry**

- **Module:** api · **Type:** functional · **Priority:** P2
- **Preconditions:** Logged in as QA Engineer (qa@medicare.example.com).

| Step | Action | Expected |
|---|---|---|
| 1 | Trigger any error and copy the request ID from the error toast. |  |
| 2 | Logs Explorer → paste the request ID → Trace. |  |

**Expected result:** The trace shows method, path, status, duration and redacted context for that request.

## TC-028

**Logs never contain patient names, emails or phone numbers**

- **Module:** security · **Type:** security · **Priority:** P1
- **Preconditions:** Patient created with known name/email/phone.

| Step | Action | Expected |
|---|---|---|
| 1 | Search the patient directory with the patient's name. |  |
| 2 | Inspect app_logs and audit_logs for that request. |  |

**Expected result:** Search term stored as [REDACTED]; no name, email or phone appears in any log row.

## TC-029

**Enabled Bug Lab defects do not affect normal application paths**

- **Module:** security · **Type:** regression · **Priority:** P1
- **Preconditions:** Logged in as QA Engineer (qa@medicare.example.com). All Bug Lab defects enabled.

| Step | Action | Expected |
|---|---|---|
| 1 | As Pharmacist, approve a real refill; search patients in lowercase; submit a duplicate refill. |  |

**Expected result:** All normal behaviors are correct; defects only reproduce in the Bug Lab sandbox.

## TC-030

**Database consistency checks pass after workflows**

- **Module:** api · **Type:** regression · **Priority:** P2
- **Preconditions:** Logged in as QA Engineer (qa@medicare.example.com). Several refills approved/rejected during testing.

| Step | Action | Expected |
|---|---|---|
| 1 | Logs Explorer → Database checks → Run. |  |

**Expected result:** All checks pass (0 violating rows), e.g. refills_remaining = authorized − approved refills.
