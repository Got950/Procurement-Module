# Procurement — FAILURES

| Failure | Detect | Recover | Regression |
|---------|--------|---------|------------|
| Invalid status transition | State machine / ConflictError | User retries from UI | workflow-matrix |
| Double submit / double pay | Idempotency + row locks | 409 | idempotency + concurrency tests |
| Gmail quota / outage | Job retry → DEAD | Re-enqueue; sync fallback | jobs tests |
| Bad AI JSON | Zod parse fail | Retry/extract path; no rank invent | ai-validation unit |
| Missing approval amount | Budget track null | Force amount before routing | budget-approval |

Copilot-specific failures: `docs/domains/copilot/FAILURES.md`.
