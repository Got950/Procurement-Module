# Current state vs target state

Audited from repository code on 2026-09-06. Historical PLAN/README claims that Copilot was “not started” are **obsolete**.

## CURRENT STATE (verified in code)

### ERP

- Production-oriented procurement monolith (Phases 0–9 largely present)
- Postgres + migrations through `0011_copilot.sql` (uncommitted in working tree at audit time)
- Session auth, RBAC, rate limits, idempotency, jobs/worker, Gmail, quotation AI + deterministic scoring
- Application use-cases thin over workflow

### Copilot (implemented, largely uncommitted)

| Area | Present |
|------|---------|
| UI | `/copilot` page + `CopilotPanel` (history, confirm/cancel) |
| APIs | `/api/copilot/chat`, `confirm`, `conversations` |
| LLM | `ChatFn` + OpenAI chat completions |
| Loop | Bounded iterations/tools/timeouts/duplicates |
| Tools | 16 read + 10 action tools; role-filtered registry |
| HITL | Confirmations TTL, atomic claim, replay window |
| AuthZ | Session actor; tool roles; indent access helpers |
| Injection | Untrusted fencing |
| Memory | Last N turns + recent indent refs (not long-term memory) |
| RAG | None (document text search tool is SQL/ILIKE-scoped, not vector RAG) |
| Tests | Unit + integration Copilot suites |
| Docs | Were stale; architecture docs added this pass |

### Explicitly absent vs production-grade target

- Eval harness / golden set / canary
- Prompt & tool versioning
- Persisted cost accounting
- Streaming UX / progressive tool status
- `ActorContext.source = 'COPILOT'`
- Capability manifest artifact (registry exists in code only)
- Model fallback provider
- GraphRAG / MCP / multi-agent (correctly absent)

## TARGET STATE

A **controlled software system** where the LLM is one component:

SAFE · RELIABLE · OBSERVABLE · EVALUABLE · COST-AWARE · SECURE · AUDITABLE · USEFUL

Concrete target properties:

1. Same ERP correctness as UI for every Copilot action  
2. Every high-risk action HITL + audit with Copilot provenance  
3. Bounded resources always  
4. Grounded answers only from authorized tool results  
5. Measurable quality via golden evals before prompt/model change  
6. Operators can reconstruct any turn end-to-end  
7. Cost/latency SLOs visible  
8. Documentation matches code  

## Delta summary

Foundation (agent loop, tools, HITL, authz, tests) ≈ **70–80% toward a serious internal Copilot**.

Production-grade bar (eval, cost ledger, provenance, streaming ops maturity, doc sync, commit/migrate readiness) ≈ **remaining 20–30%**, plus ongoing ERP limitations (org-wide indent scope).
