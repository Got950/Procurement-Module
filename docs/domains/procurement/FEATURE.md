# Domain — Procurement (indent workflow)

## FEATURE

End-to-end purchase indent lifecycle: create → multi-tier approvals → RFQ/quotations → vendor selection → PO → finance.

## FLOW

Authoritative transitions live in `src/server/workflow/indent-workflow.ts` and `src/server/domain/state-machine.ts`. HTTP routes and Copilot action tools must call `src/server/application/indent-use-cases.ts` (or equivalent workflow functions), not invent status writes.

High-level:

`DRAFT` → TL/Director/MD tracks → `PROCUREMENT_ACTIVE` → RFQ/quotes → selection → approvals → PO → finance states.

Budget track uses `approvalBudgetAmount` (not requester estimate alone) — see `src/lib/budget-approval.ts`.

## TESTING

- `tests/integration/indent-workflow.test.ts`  
- `tests/integration/workflow-matrix.test.ts`  
- `tests/unit/budget-approval.test.ts`, `policies`, concurrency, idempotency  

## FAILURES

| Mode | Notes |
|------|-------|
| Concurrent double action | Optimistic/version guards → conflict |
| Unauthorized transition | Workflow role checks |
| External email/Gmail down | Jobs retry / DEAD; domain state separate |
| AI quotation extract fail | Zod validation; deterministic scores remain |

## COPILOT INTERACTION

Copilot is an alternate adapter. It must not bypass state machine. See `docs/domains/copilot/`.

## KNOWN LIMITATIONS

- Indent object scope mostly org-wide except REQUESTER  
- B-56 UI decomposition deferred historically  
