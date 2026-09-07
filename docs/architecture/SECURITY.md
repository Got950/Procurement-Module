# Security — Copilot & ERP boundaries

## Threat model (Copilot-relevant)

| Threat | Mitigation in code | Residual risk |
|--------|--------------------|---------------|
| Prompt injection via vendor email/PDF | `wrapUntrusted`, sanitize, system prompt | Heuristics incomplete |
| Model invents approval / email success | Grounding rules; confirmation; tools report status | Model may still *claim* wrongly — UI must show confirmation/tool status |
| IDOR across requesters | `canViewIndent` / scope; conversation ownership | Non-requester org-wide visibility (ERP-level) |
| Tool abuse / unknown tools | Registry fail-closed; role allow-list; Zod | Mis-registered tool with wrong roles |
| Confirmation replay / CSRF of action | Atomic claim; user+conversation bind; confirm rate limit; CSRF via API handler patterns | Leaked confirmation id within TTL if session stolen |
| Secret exfiltration | No secrets in prompts; logger redaction | Over-verbose tool results |
| Cost DoS | Chat rate limit 20/min; turn budgets | Shared API key quota across features |

## AuthN / AuthZ pipeline

```
Session cookie/JWT
 → withApiHandler unauthorized if missing
 → CopilotContext.actor from session only
 → toolsForRole filters advertised tools
 → executeToolCall role check again
 → loadAuthorizedIndent / indentScope for resources
 → write: confirmation owned by same user+conversation
 → confirm: re-load session actor; claim; execute with confirmationId set
```

## High-risk actions (HITL required)

`submit_indent`, `mark_quotations_ready`, `send_rfq`, `select_vendor`, `record_approval_decision`, `send_to_finance`, `send_final_invoice_to_finance`, `complete_finance_final_review`, `send_purchase_order`.

`sync_gmail` is privileged but confirmation-optional (mailbox sync / queue only).

## Data handling

- Tool execution errors truncated; args not fully logged in `copilot_tool_executions`
- Do not log full quotation bodies or API keys
- **Tenant model:** intentionally **single-organization / single-tenant**. There is no `tenant_id`. Org-wide indent visibility for non-REQUESTER roles is by design for one company deployment. Do not market or deploy as multi-tenant SaaS until a tenant boundary is implemented end-to-end (authenticated server context, scoped queries, no client-supplied tenant IDs).

## Password recovery

- Self-service forgot/reset uses hashed, expiring, single-use tokens (`password_reset_tokens`)
- Reset emails send via connected Gmail when available; otherwise admin can set passwords under User management
- Settings page supports profile view + authenticated password change
- Never log raw reset tokens or passwords

## Prompt injection policy

External content → DATA → model context. System rules, allow-lists, and confirmation gates outrank retrieved text. Never promote document text into system prompt.

## Required before “production Copilot” claim

- [ ] Red-team injection cases in eval set
- [ ] Confirm all write tools route through authz + workflow
- [ ] Verify rate limits under concurrent users
- [ ] Ensure audit rows distinguish Copilot actions (`source` still incomplete — see gaps)
- [ ] Review org-wide indent visibility risk for Director/Procurement roles via Copilot reads
