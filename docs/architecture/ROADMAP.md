# Incremental implementation roadmap

Do **not** rebuild the Copilot. Harden and close gaps in order.

## Wave 0 — Truth & ship hygiene (immediate)

1. Architecture docs (this directory) + domain docs  
2. Align README / progress reports with code  
3. Ensure `0011_copilot.sql` applied in dev/test; commit when user requests  
4. Run Copilot unit + integration tests; record results in HANDOVER  

**Exit:** Engineers trust docs; migrate path clear.

## Wave 1 — P0/P1 correctness & security

1. Add `source: 'UI' | 'JOB' | 'COPILOT'` (and correlation) through use-case/audit paths used by Copilot  
2. Confirm-path integration tests for at least one RFQ/approval happy path + failure path  
3. Review tool role matrix vs RBAC policies; fix mismatches  
4. Document org-wide indent read risk; decide if Copilot list tools need tighter filters for some roles  
5. Prompt version constant logged on every turn  

**Exit:** Auditor can attribute Copilot mutations; tests cover confirm execute.

## Wave 2 — Evaluation harness (P1)

1. `tests/eval/` golden JSON cases (authz, grounding, injection, HITL)  
2. Scripted runner with injectable `ChatFn` fixtures (no live spend in CI)  
3. Optional live canary job behind env flag  
4. Baseline metrics stored for regression  

**Exit:** Prompt/model changes have a gate.

## Wave 3 — Observability & cost (P1/P2)

1. Persist token usage per conversation/turn (table or columns)  
2. Stage timings (model vs tools)  
3. Simple ops queries / metrics for stopReason, tool error rate, cost/user/day  
4. Optional daily token budget enforcement  

**Exit:** Cost and failure modes visible in staging.

## Wave 4 — UX reliability (P2)

1. Stream or progressive tool status in UI  
2. Clear QUEUED vs SENT vs FAILED copy (already partially in prompts)  
3. Cancellation of in-flight turn if feasible  

**Exit:** Users understand system actions.

## Wave 5 — Capability expansion (P3, demand-driven)

1. Missing finance/procurement tools only when a concrete task fails capability analysis  
2. Optional read-model module extraction if N+1/complexity hurts  
3. Semantic cache only if measured duplicate spend  

## Wave 6 — Advanced (P3/P4) — only if justified

- Policy RAG, GraphRAG, multi-agent, MCP  

Each requires DECISIONS.md entry answering the six justification questions in the master directive.

## Out of order forbidden

- Rewriting working orchestrator “for LangGraph/agents”  
- Adding vector DB for chat memory  
- Unbounded autonomy over full indent lifecycle  
