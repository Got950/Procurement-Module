# MedFlow — Final API Security Matrix

**Date:** 2026-09-06  
**Deployment under test:** https://medflow-13-50-17-61.sslip.io
**Source of truth:** `src/app/api/**` + live black-box checks  
**Auth stack:** `withApiHandler` → session JWT/refresh → RBAC/policies → workflow gates  
**CSRF:** `assertSafeOrigin` on `/api/*` except `/api/session` and Gmail OAuth callback  
**Default mutate rate limit:** 60/min/IP unless noted  

Legend — RESULT: **PASS** (authz + validation verified or code-reviewed with live spot checks)

| METHOD | ENDPOINT | AUTHENTICATION | ALLOWED ROLES | OWNERSHIP CHECK | VALIDATION | RATE LIMIT | SENSITIVE DATA | RESULT |
|--------|----------|----------------|---------------|-----------------|------------|------------|----------------|--------|
| POST | `/api/session` | public | — | — | Zod login | custom IP+id | user profile only | PASS |
| DELETE | `/api/session` | optional | self | session | — | — | none | PASS |
| GET | `/api/me` | optional | self | session | — | — | safe user fields | PASS |
| GET | `/api/users` | none | stub | — | — | — | 404 stub | PASS |
| POST | `/api/auth/forgot-password` | public | — | — | email Zod | 5/15m | generic message | PASS |
| POST | `/api/auth/reset-password` | public | — | — | token+pwd | 10/15m | none | PASS |
| GET/PATCH | `/api/settings` | required | self | session user | pwd Zod | default mutate | no passwordHash | PASS |
| GET/POST | `/api/admin/users` | required | ADMIN | — | email Zod | default POST | hasPassword only | PASS |
| PATCH/DELETE | `/api/admin/users/[id]` | required | ADMIN | user id | pwd / id | default | generic errors | PASS |
| GET/POST | `/api/admin/roles` | required | ADMIN | — | label | default POST | role codes | PASS |
| GET | `/api/health/live` | public | — | — | — | off | ok | PASS |
| GET | `/api/health/ready` | public | — | — | — | off | config/db flags | PASS |
| GET | `/api/health/deps` | required | ADMIN | — | — | — | bool flags only | PASS |
| GET/POST | `/api/vendors` | required | PROCUREMENT\|ADMIN | — | email Zod | default POST | vendor PII | PASS |
| GET/PATCH | `/api/vendors/[id]` | required | PROCUREMENT\|ADMIN | vendor id | email | default PATCH | vendor PII | PASS |
| GET | `/api/vendors/[id]/pdf` | required | PROCUREMENT\|ADMIN | vendor id | params | — | PDF bytes | PASS |
| GET | `/api/items` | required | REQUESTER\|PROC\|ADMIN | — | — | — | catalog | PASS |
| POST | `/api/items` | required | PROC\|ADMIN | — | Zod | default | — | PASS |
| GET/PATCH/DELETE | `/api/items/[id]` | required | PROC\|ADMIN | item id | Zod | default mutate | — | PASS |
| GET | `/api/indents` | required | role-scoped | list policy | page/limit | — | bank redacted | PASS |
| POST | `/api/indents` | required | REQUESTER\|ADMIN | — | qty/amount caps | default | — | PASS |
| GET | `/api/indents/[id]` | required | canViewIndent | indent | params | — | bank redact; no storagePath | PASS |
| PATCH | `/api/indents/[id]` | required | owner\|ADMIN draft | indent | version+caps | default | — | PASS |
| POST | `/api/indents/[id]/submit` | required | workflow | indent | — | idem | — | PASS |
| POST | `/api/indents/[id]/approvals` | required | TL/DIR/MD + SoD | indent+stage | body | idem | — | PASS |
| GET | `/api/indents/[id]/pdf` | required | canViewIndent | indent | — | — | PDF | PASS |
| POST | `/api/indents/[id]/rfq/send` | required | PROC\|ADMIN | indent | body | idem | sanitized errors | PASS |
| POST | `/api/indents/[id]/quotations/upload` | required | PROC\|ADMIN | indent | PDF magic | default | no storagePath | PASS |
| POST | `/api/indents/[id]/quotations/from-text` | required | PROC\|ADMIN | indent | ≤50k | default | — | PASS |
| POST | `/api/indents/[id]/quotations/[qid]/extract` | required | PROC\|ADMIN | qid∈indent | — | default | — | PASS |
| POST | `/api/indents/[id]/compare` | required | PROC\|ADMIN | indent | body | default | — | PASS |
| POST | `/api/indents/[id]/vendor-selection` | required | workflow | indent | Zod | default | — | PASS |
| POST | `/api/indents/[id]/procurement-requirements` | required | PROCUREMENT | indent | Zod | default | — | PASS |
| POST | `/api/indents/[id]/quotes/ready` | required | PROCUREMENT | indent | — | default | — | PASS |
| POST | `/api/indents/[id]/vendor-proof` | required | PROCUREMENT | indent | — | default | — | PASS |
| POST | `/api/indents/[id]/send-to-finance` | required | PROCUREMENT | indent | — | default | — | PASS |
| POST | `/api/indents/[id]/send-final-invoice` | required | PROCUREMENT | indent | — | default | — | PASS |
| POST | `/api/indents/[id]/invoice` | required | PROCUREMENT | indent | Zod | default | — | PASS |
| POST | `/api/indents/[id]/finance/accounts-complete` | required | FINANCE\|ADMIN | indent | authz before validation | idem | writes bank | PASS |
| POST | `/api/indents/[id]/finance/final-complete` | required | FINANCE\|ADMIN | indent | — | idem | — | PASS |
| GET | `/api/indents/[id]/gmail-replies` | required | PROC\|ADMIN | indent | — | — | email meta | PASS |
| GET | `/api/indents/[id]/gmail-attachments` | required | PROC\|ADMIN | indent+thread | thread bind | — | bytes | PASS |
| POST | `/api/finance/payments/[indentId]/complete` | required | FINANCE\|ADMIN | indent | proof id | idem | — | PASS |
| POST | `/api/po/[indentId]/upload` | required | PROC\|ADMIN | indent | multipart | default | href only | PASS |
| POST | `/api/po/[indentId]/send` | required | PROC\|ADMIN | indent | poId | idem | gmailMessageId | PASS |
| POST | `/api/documents/upload` | required | upload policy | indent | PDF magic + sanitize name | default | no storagePath | PASS |
| GET | `/api/documents/[id]/file` | required | canViewIndent | document→indent | — | — | file; nosniff | PASS |
| GET | `/api/integrations/gmail/status` | required | PROC\|ADMIN | — | — | — | mailbox / connected | PASS |
| GET | `/api/integrations/gmail/start` | required | ADMIN | — | — | — | OAuth redirect | PASS |
| GET | `/api/integrations/gmail/callback` | ADMIN+state | ADMIN | OAuth state | — | — | redirect | PASS |
| POST | `/api/integrations/gmail/disconnect` | required | ADMIN | — | — | default | — | PASS |
| POST | `/api/integrations/gmail/sync` | required | PROC\|ADMIN | connected | — | default | — | PASS |
| GET | `/api/notifications` | required | self | user | — | — | own | PASS |
| POST | `/api/notifications/read` | required | self | ids owned | ids | default | — | PASS |
| GET | `/api/notifications/unread-count` | required | self | user | — | — | count | PASS |
| GET | `/api/audit` | required | ADMIN unscoped; else indent viewer | indentId when non-admin | query | — | audit rows | PASS |
| POST | `/api/copilot/chat` | required | any authenticated | owned conversation | ≤2000 chars | 20/min | tool-scoped | PASS |
| POST | `/api/copilot/confirm` | required | owned confirm | confirm token | Zod | 20/min+idem | — | PASS |
| GET | `/api/copilot/conversations` | required | self | user | — | — | titles | PASS |
| GET | `/api/copilot/conversations/[id]` | required | owner | conversation owner | params | — | messages | PASS |

## Direct API live checks (public staging)

| Check | Result |
|-------|--------|
| Unauthenticated protected APIs | 401 |
| Invalid login | 401 generic; no secret/stack leak |
| All 7 role logins | 200 |
| REQUESTER → vendors / admin / gmail status | 403 |
| FINANCE → vendors | 403 |
| PROCUREMENT → vendors / gmail status | 200 (`connected: false`) |
| Copilot normal Q&A | 200 |
| Copilot secret prompt | refused; no key/DB leak |
| Copilot cross-user conversation | 404 |
| Document upload PDF / fake PDF | 200 / 400 |
| Traversal filename | sanitized |
| `storagePath` / `s3Key` / `passwordHash` in JSON | absent |
| `/.env` HTTP | redirects to login (not served) |
| Postgres `:5432` public | closed |
| Docker daemon public | closed |

**Note:** UI hiding is never treated as security. Authorization is enforced server-side on each route above.
