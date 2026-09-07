# Copilot — FAILURES

| Code / stopReason | Class | Detect | Recover | Prevent |
|-------------------|-------|--------|---------|---------|
| MODEL_UNAVAILABLE | Model | ChatFn throws | User message; retry later | Health on deps; optional fallback later |
| UNKNOWN_TOOL / FORBIDDEN / INVALID_ARGUMENTS | Tool selection / validation | Executor | Model sees error JSON; budget on invalid | Registry + Zod + role filter |
| NOT_FOUND (indent) | AuthZ / data | Access helpers | Ask for valid ref | Fail closed |
| AWAITING_CONFIRMATION | HITL | Pending set | User confirm/cancel | One write per turn |
| DUPLICATE_CALL / loop_guard | Agent loop | seenCalls map | Stop; ask narrower | Limits |
| TOOL_BUDGET / iteration_limit / timeout | Resource | LIMITS | Stop; no silent success | Hard ceilings |
| CONFIRMATION expired/replay | Validation | claimConfirmation | New ask | TTL 300s; atomic claim |
| Tool INTERNAL / TIMEOUT | Tool execution | catch + log | Generic error to model | Timeouts per tool |
| Injection attempt | Security | wrapUntrusted | Ignore instructions in data | Fencing + no write without confirm |

Add new rows when production incidents occur; prefer a regression test.
