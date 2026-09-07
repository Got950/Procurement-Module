# Architecture — Pharma Procurement + AI Copilot

**Authority:** executable source under `src/` wins over this document.  
**Last audited:** 2026-09-06 (code inspection; docs previously claimed Copilot was deferred).

## 1. System shape

Modular monolith:

| Layer | Location | Role |
|-------|----------|------|
| UI | `src/app/(app)/`, `src/components/` | Next.js App Router pages |
| HTTP adapters | `src/app/api/` | Thin route handlers via `withApiHandler` |
| Application | `src/server/application/` | Use-case adapters (indent mutations) |
| Domain / workflow | `src/server/workflow/`, `src/server/domain/` | State machine, approval routing |
| Copilot | `src/server/copilot/` | Bounded tool-calling agent over ERP tools |
| Integrations | `src/server/gmail-*.ts`, `openai/`, `document-store.ts` | Gmail, OpenAI, S3/local docs |
| Jobs | `src/server/jobs.ts`, `job-handlers.ts`, `worker.ts` | Postgres job queue |
| Shared libs | `src/lib/` | DB, session, RBAC, rate limit, logger, metrics |
| Schema | `migrations/` | Expand-only SQL (`0011_copilot.sql` for Copilot) |

**Stack (verified in `package.json`):** Next.js 15, React 19, TypeScript, PostgreSQL via `pg`, Zod, Jose sessions, OpenAI SDK, Google APIs, Vitest.

**Not present (by design today):** microservices, Kafka, vector DB, GraphRAG, MCP server, multi-agent framework, ElastiCache.

## 2. Core business domain

Procurement indent lifecycle (pharma/manufacturing style):

1. Requester creates/submits indent  
2. Team Leader / Director / MD budget-track approvals  
3. Procurement RFQ → quotations → vendor selection → further approvals  
4. Purchase order → finance invoice / payment  

**Core entities:** users, roles, items, vendors, indents, approvals, RFQs, quotations, documents, purchase orders, finance records, notifications, audit logs, jobs, sessions, Gmail linkage.

**Critical write / destructive ops:** approval decisions, RFQ email send, vendor selection, PO email, finance completion, status transitions. All must go through authorized workflow/use-case paths — not LLM inventing SQL or status values.

## 3. AuthN / AuthZ

- Session JWT (`src/lib/session.ts`, `SESSION_SECRET`)
- Middleware gate on app routes (`src/middleware.ts`)
- RBAC nav/policies (`src/lib/rbac/policies.ts`) — Copilot nav entry for all roles
- Indent visibility: requesters own-only; other roles org-wide except ADMIN override (`src/lib/indent-access.ts`)
- Copilot tools re-check role allow-lists + `loadAuthorizedIndent` / `indentScope` (fail closed as `NOT_FOUND` for IDOR)

**Known constraint:** object-level indent scope remains mostly org-wide for non-REQUESTER roles (documented OQ-1 / README).

## 4. Copilot runtime architecture (as implemented)

```
User (Copilot UI)
  → POST /api/copilot/chat | confirm | conversations
  → session + rate limit
  → conversation ownership check
  → runCopilotTurn / confirmCopilotAction
       → system + short history + recent indent refs
       → OpenAI ChatCompletions (ChatFn port)
       → bounded loop (iterations / tools / duplicates / timeout)
       → executeToolCall
            → registry lookup → role gate → Zod args
            → write? → confirmation record (no mutation yet)
            → read/execute → timeout → audit + tool_executions
       → indentUseCases / workflow / Gmail / scoring (deterministic)
  → JSON reply + optional confirmation card
```

**Persistence (`migrations/0011_copilot.sql`):**

- `copilot_conversations` — per-user ownership  
- `copilot_messages` — user/assistant turns  
- `copilot_tool_executions` — tool audit  
- `copilot_confirmations` — HITL gate with TTL + atomic claim  

## 5. Existing AI outside Copilot

`src/server/openai/quotation-ai.ts` — quotation extraction / suitability with Zod validation, vendor-text sanitization, and `input_hash` cache. Deterministic `scoring-engine.ts` remains authority for vendor ranking.

## 6. Observability today

- Structured JSON logger + redaction helpers  
- Correlation IDs on API handler  
- EMF-style metrics helper (`emitMetric`) — Copilot emits `CopilotTurn`  
- Audit service for write tools (`COPILOT_*`)  
- Copilot tool execution rows  

Gaps: no prompt/model version fields, no persisted cost ledger, no eval harness, no streaming traces to UI.

## 7. Deployment

- Docker image + `ROLE=worker` entrypoint  
- Terraform under `infra/` (apply not verified in CI)  
- GitHub Actions CI + deploy workflow  
- Ops: `docs/ops-runbook.md`

## 8. Extension points for Copilot (intentional)

Prefer calling:

1. `indentUseCases` / workflow functions  
2. Authorized read tools that mirror UI visibility  
3. Job enqueue for side effects (email, gmail.sync)

Avoid: raw SQL mutation tools, model-chosen status writes, bypassing confirmation for consequential actions.
