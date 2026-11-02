# BUG-003 · Patient search misses matches in a different letter case

| Field | Value |
|---|---|
| Severity / Priority | Minor / P3 |
| Environment | Local · MediCare QA Lab 1.0.0 · Bug Lab sandbox |
| Component | `backend/app/api/v1/patients.py` → `search_filter()` |
| Demo key | `search_case_sensitive` |
| Regression test | TC-010, `e2e/tests/patients.spec.ts`, `e2e/tests/buglab.spec.ts`, `test_tc010_search_is_case_insensitive` |

## Description
Searching `nora` returns nothing even though **Nora Haddad** exists. Users conclude the patient isn't registered and may create a duplicate. Customer ticket: "Search does not find patient by lowercase name".

## Preconditions
Sandbox reset. Defect `search_case_sensitive` **on**.

## Steps to reproduce
1. Bug Lab → Sandbox patient search → `Nora` → **Search**. Result: 1 patient.
2. Search `nora`. Result: none.

## Expected
Both searches return Nora Haddad.

## Actual
`GET /api/v1/demo/sandbox/patients?q=Nora` → 1 result. `?q=nora` → `[]` (request ID `req_eebbe9f995bff063`).
The log stores the search term as `"q": "[REDACTED]"` (search terms can contain patient names), so the investigation relies on reproducing the request rather than reading the term from logs.

## Investigation
1. The same name in different case gives a different result, so data isn't the issue.
2. The duplicate-patient check (case-insensitive) still blocks a second "nora haddad", which confirms the record exists.
3. Reading `search_filter()`: the case-sensitive branch builds `LIKE` instead of `ILIKE`.

## Root cause
`LIKE` was used instead of `ILIKE`. PostgreSQL `LIKE` is case-sensitive. Injection point: `# DEMO-BUG: search_case_sensitive`.

## Fix and verification
- Fix: always use `ILIKE`.
- Verified: `nora` returns 1 result with the defect off.
- Regression: TC-010 passes in Playwright (`JOHN TURNER` / `john turner`) and pytest (three casings).
