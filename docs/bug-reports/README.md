# Bug reports

| ID | Title | Severity | Priority | Origin | Status |
|---|---|---|---|---|---|
| [BUG-001](refill_status_stale.md) | Refill approval returns stale "pending" status | Major | P1 | Bug Lab (injected) | Fixed |
| [BUG-002](refill_boundary_422.md) | Refill rejected with 422 when exactly 1 refill remains | Major | P2 | Bug Lab (injected) | Fixed |
| [BUG-003](search_case_sensitive.md) | Patient search misses matches in a different letter case | Minor | P3 | Bug Lab (injected) | Fixed |
| [BUG-004](refill_double_submit.md) | Double-click creates duplicate refill requests | Critical | P1 | Bug Lab (injected) | Fixed |
| [BUG-005](BUG-005-login-rate-limiter.md) | Login rate limiter locks out users after successful sign-ins | Major | P1 | **Found by Playwright** | Verified |

BUG-001 to BUG-004 are controlled defects: switch them on in the Bug Lab to reproduce them, and switch them off to apply the fix. BUG-005 was a genuine defect in this codebase, caught by the E2E suite during development and fixed.

**Severity** is the impact on users (critical → trivial). **Priority** is the order of fixing (P1 → P4). They're set independently: a critical defect in a rarely used path can still be P2.

The evidence below (request IDs, response bodies, log entries) was captured from real runs on 2026-11-02 with `scripts`-style API calls against a local instance. Request IDs differ on every run.
