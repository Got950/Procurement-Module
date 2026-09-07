# Domain — Procurement Copilot

## FEATURE

In-app assistant that answers grounded questions about procurement cases and proposes authorized workflow actions. Consequential actions require explicit user confirmation.

## FLOW

1. User opens `/copilot` or navigates via sidebar  
2. `POST /api/copilot/chat` creates/loads owned conversation  
3. Orchestrator runs bounded model↔tool loop  
4. Read tools return scoped data; write tools return confirmation preview  
5. User confirms/cancels via `POST /api/copilot/confirm`  
6. Executor runs tool with `confirmationId`; workflow/use-case mutates state  

## CAPABILITY MAP (code registry)

**Read:** `list_indents`, `get_indent`, `get_indent_counts_by_status`, `get_pending_approvals`, `get_workflow_state`, `get_quotations`, `compare_quotations`, `get_vendor_responses`, `get_documents`, `search_document_text`, `get_document_text`, `compare_document_with_indent`, `get_approval_history`, `get_audit_history`, `get_finance_status`, `list_vendors`, `get_vendor`, `list_items`, `get_item`, `list_payments`, `get_my_notifications`, `get_gmail_status`, `download_indent_pdf`, `download_vendor_pdf`, `download_document`, `navigate_to`

**Write (confirm):** `submit_indent`, `create_indent`, `update_draft_indent`, `mark_quotations_ready`, `send_rfq`, `select_vendor`, `record_approval_decision`, `send_to_finance`, `send_final_invoice_to_finance`, `complete_finance_final_review`, `send_purchase_order`, `create_vendor`, `update_vendor`, `complete_payment`

**Write (no confirm):** `sync_gmail`, `mark_notifications_read`

Not present in this product (do not invent): vendor delete, item CRUD APIs, dedicated query-ticket domain.

## TESTING

- `tests/unit/copilot.test.ts`  
- `tests/integration/copilot.test.ts`  
- `tests/eval/` golden harness — `npm run test:eval` / `test:eval:canary`  

## FAILURES

| Mode | Behaviour |
|------|-----------|
| Model down | Controlled message; no mutation |
| Unknown/forbidden tool | REJECTED / FORBIDDEN |
| Invalid args | INVALID_ARGUMENTS |
| Loop/duplicate tools | stopReason loop_guard / limits |
| Timeout | User told nothing changed |
| Expired confirmation | Conflict; ask again |
| IDOR | NOT_FOUND |

## KNOWN LIMITATIONS

- No streaming  
- No eval harness yet  
- Inherits org-wide indent visibility for non-requesters  
- Audit provenance: Copilot routes / confirm path set `source=COPILOT` (Wave 1)

## DECISIONS

See `docs/architecture/DECISIONS.md` (D-01…D-10).

## PROMPT VERSION

`COPILOT_PROMPT_VERSION` in `src/server/copilot/prompt.ts` — bump on semantic prompt changes; logged on every turn.
