# Architecture decisions (Copilot)

Record format: decision → context → alternatives → reason → trade-offs → reconsider when.

Code remains authoritative if this file drifts.

---

## D-01 — Single bounded tool-calling agent (not multi-agent)

**Decision:** One orchestrator loop (`runCopilotTurn`) with hard ceilings.

**Context:** Procurement tasks are mostly retrieve-facts + propose-authorized-action.

**Alternatives:** Multi-agent planner/executor/verifier; fully deterministic menus only; HTTP-only “chat that scrapes UI”.

**Reason:** Matches domain; already implemented with tests for loop/duplicate/timeout guards. Multi-agent adds latency/cost/failure surface without measured need.

**Trade-offs:** Complex multi-hop planning may hit iteration/tool limits and ask user to narrow.

**Reconsider when:** Eval shows systematic task failure due to missing specialised roles *and* a simpler workflow cannot express the need.

---

## D-02 — No RAG / vector DB / GraphRAG for v1

**Decision:** Do not add embeddings or a knowledge graph. Context = short conversation history + tool results + recent indent refs.

**Context:** Authoritative state lives in Postgres transactional tables, not document corpora.

**Alternatives:** Hybrid RAG over SOPs; GraphRAG over employee↔indent↔vendor graph.

**Reason:** Facts must come from authorized live queries. SOP RAG is optional later; GraphRAG not justified until multi-hop relationship queries fail measurable evals.

**Trade-offs:** Cannot answer “what does our policy say” without tools/docs search on stored text (`search_document_text` is indent-scoped extracted text, not org policy RAG).

**Reconsider when:** Policy/SOP Q&A is a product requirement with a golden set, or multi-hop org graph queries dominate failures.

---

## D-03 — No MCP for in-app Copilot

**Decision:** Keep an in-process tool registry; do not expose ERP via MCP yet.

**Context:** Copilot runs inside the same trusted process as sessions and RBAC.

**Alternatives:** MCP server wrapping tools for external agents.

**Reason:** Extra protocol layer without interoperability demand; increases attack surface.

**Reconsider when:** A second trusted client (IDE agent, ops bot) needs the same contracts *and* can share authz model.

---

## D-04 — Human confirmation for all consequential writes

**Decision:** Write tools with `requiresConfirmation: true` create a TTL confirmation; execution only after explicit confirm API with atomic claim.

**Context:** RFQ/PO email and approvals are irreversible or externally visible.

**Alternatives:** Auto-execute low-risk writes; confirm only external email.

**Reason:** Fail-safe for ERP; already coded with replay window + ownership binding.

**Trade-offs:** Extra click; `sync_gmail` is write-kind but confirmation-optional (read-side effect only).

**Reconsider when:** Product defines a clear low-risk auto-class with audit + rollback story.

---

## D-05 — LLM proposes; workflow/use-cases commit

**Decision:** Tools call `indentUseCases` / domain services; model never writes `current_status` directly.

**Context:** PLAN.md section 20 compatibility requirement.

**Alternatives:** Copilot SQL; Copilot calling routes over HTTP.

**Reason:** Preserves state machine, authz, transactions.

**Trade-offs:** Some tools still do supporting SQL reads or call `sendPurchaseOrderEmail` / Gmail sync directly — must stay behind the same authz gates.

**Reconsider when:** Full `ActorContext.source = 'COPILOT'` plumbing lands (see gap P0/P1).

---

## D-06 — OpenAI via `ChatFn` port, single primary model

**Decision:** `openaiChat()` implements `ChatFn`; model from `OPENAI_COPILOT_MODEL` → `OPENAI_MODEL` → `gpt-4o-mini`.

**Alternatives:** Multi-provider router; local models; Anthropic primary.

**Reason:** Existing OpenAI dependency for quotation AI; injectable `ChatFn` for tests.

**Trade-offs:** No evaluated fallback model; provider outage → controlled unavailable message.

**Reconsider when:** SLO requires multi-provider fallback *and* behavioural parity is evaluated.

---

## D-07 — Prompt-injection: fence untrusted vendor/document text

**Decision:** `wrapUntrusted` + sanitize + system instructions treating fenced blocks as data.

**Alternatives:** Strip all vendor text; allow model free reading.

**Reason:** Quotations/emails are adversarial by nature.

**Trade-offs:** Heuristic sanitization is not perfect; tool allow-lists + confirmation remain primary control.

**Reconsider when:** Red-team finds systematic breakout requiring stronger isolation (e.g. separate summariser model without tools).

---

## D-11 — Fixture-based golden eval (no live spend in CI)

**Decision:** `tests/eval` runs scripted `ChatFn` cases against real tools/orchestrator/DB; baseline JSON gates case ids + prompt version.

**Context:** Wave 2 / B-65 — prompt and tool changes need a regression gate.

**Alternatives:** Live OpenAI in CI; offline LLM-as-judge only; defer eval.

**Reason:** Deterministic, free, exercises authz/HITL/bounds; live spend belongs in optional staging canaries later.

**Trade-offs:** Does not score free-form model quality — only contracts the system around a scripted model.

**Reconsider when:** Staging has a budgeted live canary job with a frozen prompt/model pair.

---

## D-09 — Request source via ALS for audit provenance

**Decision:** `withRequestContext({ correlationId, source })` where `source ∈ {UI, JOB, COPILOT}`; `appendAudit` reads ALS (overrideable). API default `UI`; Copilot routes `COPILOT`; job runner `JOB`.

**Context:** Wave 1 gap G-03 — auditors must distinguish machine-assisted mutations.

**Alternatives:** Thread `source` through every workflow signature; only tag CopilotAction audits.

**Reason:** Workflow already calls `appendAudit` without ActorContext; ALS matches existing correlation pattern with minimal churn.

**Trade-offs:** Nested jobs started from a COPILOT request that enqueue work will audit as JOB when the worker runs (correct: the side-effect runner is the worker).

**Reconsider when:** Multi-tenant or cross-service audit export needs a different vocabulary.

---

## D-10 — Prompt version constant

**Decision:** `COPILOT_PROMPT_VERSION = "copilot-system-v1"` logged and stored on assistant message metadata; bump on semantic prompt changes.

**Context:** Eval/regression gate for prompt edits.

**Alternatives:** Hash prompt body each turn; embed version in system prompt text.

**Reason:** Explicit, reviewable version id without polluting model context.

**Reconsider when:** Multiple simultaneous prompt experiments need A/B labels.
