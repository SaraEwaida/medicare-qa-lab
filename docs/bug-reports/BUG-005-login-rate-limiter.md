# BUG-005 · Login rate limiter locks out users after successful sign-ins

| Field | Value |
|---|---|
| Severity / Priority | Major / P1 |
| Status | Verified |
| Found by | Playwright E2E suite, 2026-11-02 (real defect, not injected) |
| Environment | Local · MediCare QA Lab 1.0.0 · Chromium (Playwright 1.63) |
| Component | `backend/app/core/security.py` → `LoginRateLimiter`, `backend/app/api/v1/auth.py` → `login()` |
| Regression test | TC-003, `test_successful_logins_do_not_trigger_rate_limit`, `test_tc003_login_rate_limited_after_five_attempts`, full Playwright suite |

## Description
After five **successful** sign-ins within a minute from the same IP and email, the sixth sign-in is rejected with `429 Too many login attempts`, even with the correct password. Pharmacists who sign in on several devices or tabs get locked out for a minute.

## How it was found
The first full Playwright run had 4 of 17 tests failing in different specs, all at the same line: `loginAs()` stayed on `/login`. The failures shared the account and timing, not the feature, which pointed to authentication rather than the pages under test. The server log for those requests showed `POST /api/v1/auth/login → 429`.

## Steps to reproduce (before the fix)
1. Sign in as `pharmacist@medicare.example.com` and sign out. Repeat four more times within 60 seconds.
2. Sign in a sixth time with the correct password.

## Expected
Success. Only failed attempts count toward the limit (5 per minute).

## Actual
`429 RATE_LIMITED`, `Retry-After: ~55`. The login page shows "Too many login attempts".

## Root cause
`LoginRateLimiter.check()` appended every attempt to the sliding window *before* the password was verified, so successful logins used up the budget meant for failures. The existing test (TC-003) only covered failed attempts, which is why the defect slipped through.

## Fix
- `check()` only reads the window and raises 429 if the limit is already reached.
- `record_failure()` is called only on invalid credentials.
- A successful login resets that key.

## Verification
- New regression test: 8 consecutive successful logins all return 200.
- TC-003 still passes: 5 failures followed by a 6th attempt still return 429.
- Full Playwright suite: 17/17 passed. Backend suite: 115/115 passed.

## Lesson
Test the **negative of the negative**: a limiter test must prove that legitimate traffic is *not* limited, not only that abuse is.
