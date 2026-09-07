# Observability — Copilot

## What exists (code)

| Signal | Where | Notes |
|--------|-------|-------|
| Request correlation | `withApiHandler` → `CopilotContext.correlationId` | Propagated into tool_executions |
| Turn log | `orchestrator` `log.info("copilot turn")` | model, **promptVersion**, tokens, duration, stopReason, userId |
| Metric | `emitMetric("CopilotTurn", …, { stopReason })` | EMF if `EMIT_EMF=1` |
| Tool executions | `copilot_tool_executions` | name, kind, status, duration, error, target |
| Write audits | `appendAudit` `COPILOT_*` + workflow actions | **source=`COPILOT`** when ALS set; UI/JOB similarly |
| Confirmation lifecycle | `copilot_confirmations` | PENDING→EXECUTING→EXECUTED/FAILED/CANCELLED |
| Prompt version | `COPILOT_PROMPT_VERSION` | On turn response + assistant `data_json` |

## Reconstructing a run (target audit trail)

Desired reconstruction:

REQUEST → context used → model → tools selected → tool results → failures/retries → verification → final action

**Today:** Approximate via conversation messages `data_json` (incl. promptVersion) + tool_executions + confirmations + `audit_logs.source`. Not a single trace API.

## Gaps

- No tool registry version stored per turn
- Tokens logged but not aggregated into a cost ledger table
- No per-stage latency breakdown (auth / model / tool / confirm)
- UI does not stream intermediate tool status (poll/batch JSON only)
- No dedicated ops dashboard for Copilot KPIs

## Logging rules

Do not log: API keys, session secrets, full passwords, unnecessary PII dumps, full untrusted vendor payloads.

Prefer: ids, statuses, durations, error codes, correlation ids, token counts, promptVersion, request source.
