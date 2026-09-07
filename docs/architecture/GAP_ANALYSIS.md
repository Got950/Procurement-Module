# Gap analysis — Copilot production readiness

Classification: **P0** correctness/security/blocking · **P1** production reliability · **P2** performance/cost · **P3** advanced · **P4** optional.

Evidence basis: `src/server/copilot/**`, APIs, tests, migrations, ERP seams. Not PLAN.md alone.

| ID | Area | Gap | Priority | Notes |
|----|------|-----|----------|-------|
| G-01 | Docs / truth | README, PRODUCTION_READINESS, IMPLEMENTATION_PROGRESS, PLAN Phase 10 claim Copilot not built | P0 | Misleading operators; fix docs (this pass starts) |
| G-02 | Deploy | Copilot code + `0011_copilot.sql` largely uncommitted; migration not in committed baseline | P0 | Cannot claim shipped until migrate + verify |
| G-03 | Provenance | `ActorContext` lacked `source` / correlation into workflow audits | P1 | **CLOSED (Wave 1):** ALS `UI|JOB|COPILOT` + Copilot routes + job runner; confirm-submit test |
| G-04 | AuthZ model | Non-REQUESTER indent visibility org-wide; Copilot amplifies bulk reads | P1 | ERP limitation; document + consider tighter scopes |
| G-05 | Eval | No golden harness / canary (B-65) | P1 | **CLOSED (Wave 2):** `tests/eval/` + baseline + canary scripts |
| G-06 | Observability | No prompt/tool versions; no cost ledger; weak stage latency | P1 | Turn logs exist |
| G-07 | UX | No streaming; tool progress limited | P2 | Functional sync JSON UI exists |
| G-08 | Cost | Per-user/day token budgets beyond rate limit | P2 | Rate limit + turn caps exist |
| G-09 | Reliability | No evaluated model fallback | P2 | Controlled unavailable path exists |
| G-10 | Capability registry | No exported manifest/docs synced to tools | P2 | Code registry is source of truth |
| G-11 | Memory | No durable user preferences / long-term memory | P4 | Short-term history sufficient for now |
| G-12 | RAG | No policy/SOP RAG | P3/P4 | Only if product needs policy Q&A |
| G-13 | GraphRAG | Not present | P4 | Do not add without eval justification |
| G-14 | Multi-agent | Not present | P4 | Do not add without eval justification |
| G-15 | MCP | Not present | P4 | Do not add without external client need |
| G-16 | Caching | No semantic cache for Copilot turns | P3 | Quotation AI has input_hash cache |
| G-17 | Tests | Missing trajectory eval + more workflow write confirm E2E through confirm API | P1 | Strong security integration already |
| G-18 | `sync_gmail` | Write without confirmation | P2 | Acceptable if documented; revisit if sync has side effects beyond read |
| G-19 | Read models | Tools query via prisma/SQL rather than dedicated read-model module | P3 | Works; PLAN wanted intention-revealing repos |
| G-20 | Finance coverage | Not all finance use-cases exposed as tools | P3 | Expand by capability demand |

## KEEP / IMPROVE / REFACTOR / REPLACE / REMOVE

| Component | Class | Reason |
|-----------|-------|--------|
| `orchestrator.ts` bounds | **KEEP** | Correct control plane |
| `tool-registry` + Zod | **KEEP** | Fail-closed contracts |
| `executor` + confirmations | **KEEP** | HITL + audit spine |
| `untrusted.ts` | **KEEP** | Necessary injection boundary |
| `llm.ts` ChatFn | **KEEP** | Provider seam + testability |
| `prompt.ts` | **IMPROVE** | Add version id; keep small |
| `read-tools` / `action-tools` | **IMPROVE** | Tighten scopes; provenance; coverage |
| `CopilotPanel` | **IMPROVE** | Streaming/status clarity later |
| Conversation memory (N turns) | **KEEP** | Cheap, appropriate |
| Quotation AI path | **KEEP** | Separate from Copilot chat |
| Deterministic scoring | **KEEP** | Do not let LLM replace |
| Multi-agent / GraphRAG / MCP | **REMOVE** from roadmap unless justified | Complexity without measured need |
| Stale “Copilot deferred” docs | **REPLACE** with code-truth docs | Done in architecture set |

## Architecture / AI / Context / … coverage checklist

- Architecture: documented; foundation solid  
- AI/LLM: single provider abstraction present; fallback/eval weak  
- Context: minimal-ish (history + refs + tools); good direction  
- Memory: short-term only — OK  
- RAG: intentionally absent — OK for now  
- Tools: strong; expand carefully  
- Agent loop: strong bounds  
- Validation: Zod + workflow — strong  
- Security: strong baseline; org-wide reads + eval gaps  
- Rate limiting: present on chat/confirm  
- Cost: instrumented lightly; not managed as ledger  
- Latency: not staged  
- Observability: partial  
- Evaluation: major gap  
- Testing: good unit/integration; missing eval  
- Deployment: migrate/commit/ops docs  
- Documentation: being repaired this pass  
