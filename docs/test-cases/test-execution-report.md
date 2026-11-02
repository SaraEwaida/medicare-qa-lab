# Test execution report

Results of real executions, converted by `scripts/upload_test_report.py` and loaded into the QA Lab (QA Lab → Automation). Regenerate with `./scripts/run_all_tests.sh` then `python3 scripts/generate_test_docs.py`.

| Suite | Framework | Executed | Tests | Passed | Failed | Skipped | Duration | Commit |
|---|---|---|---|---|---|---|---|---|
| API contract (Postman/Newman) | newman | 2026-11-02 18:18 UTC | 31 | 31 | 0 | 0 | 1.4 s | `716bd81` |
| Browser E2E (Playwright) | playwright | 2026-11-02 18:18 UTC | 17 | 17 | 0 | 0 | 39.9 s | `716bd81` |
| Backend unit + integration (pytest) | pytest | 2026-11-02 20:18 UTC | 115 | 115 | 0 | 0 | 8.8 s | `716bd81` |

**Automation coverage:** 30 of 30 manual cases are linked to at least one executed automated test.

### API contract (Postman/Newman)

Linked manual cases: TC-002, TC-004, TC-005, TC-009, TC-012, TC-013, TC-015, TC-018, TC-022, TC-026, TC-030

No failures.
### Browser E2E (Playwright)

Linked manual cases: TC-001, TC-002, TC-006, TC-007, TC-008, TC-009, TC-010, TC-013, TC-014, TC-017, TC-020, TC-021, TC-022, TC-025

No failures.
### Backend unit + integration (pytest)

Linked manual cases: TC-001, TC-002, TC-003, TC-004, TC-005, TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024, TC-025, TC-027, TC-028, TC-029, TC-030

No failures.
