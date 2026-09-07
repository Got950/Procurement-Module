# Architecture invariants & constraints

These are non-negotiable unless explicitly changed with a DECISIONS.md entry and verification.

## Invariants

1. **ERP business logic is authoritative.** State transitions live in workflow/use-cases, not in LLM output.
2. **LLM output is never authorization.** Session role + tool allow-list + resource checks decide access.
3. **Consequential mutations require confirmation** (`requiresConfirmation`) plus atomic claim before execute.
4. **Agent loops are bounded** (`LIMITS` in `orchestrator.ts`: iterations, tool calls, duplicates, invalid args, wall clock, output tokens, user message length).
5. **No generic SQL / shell / arbitrary HTTP tools.** Unknown tool names fail closed.
6. **Conversation and confirmation ownership are user-scoped.** Cross-user id guessing → not found.
7. **Unauthorized indent access fails as not found** (no existence oracle for other requesters’ cases).
8. **Untrusted external text is data**, fenced via `wrapUntrusted`, never system instruction.
9. **Costs and tokens are bounded per turn**; chat routes are rate-limited.
10. **Secrets never enter prompts or client bundles** (`OPENAI_API_KEY` server-only).
11. **Migrations are expand-only** for production safety.
12. **Domain documentation must be corrected when it conflicts with code.**

## Explicit non-goals (until justified)

- Multi-agent orchestration
- Vector DB / GraphRAG
- MCP exposure of ERP tools
- Unbounded autonomous “finish the whole procurement case” agents
- Model-direct database writes
- Kubernetes / Kafka / microservices for Copilot alone

## Operational constraints

- Production must run a worker when `JOBS_INLINE` is unset (RFQ/email jobs).
- Copilot RFQ/PO side effects may queue jobs; UI/model must not claim delivery until backend says so.
- Object-level indent isolation for non-REQUESTER roles is still weak (org-wide) — Copilot inherits this ERP limitation.
