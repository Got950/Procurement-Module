# Procurement — FLOW

```
Requester creates indent (UI)
  → submit (use case) → PENDING_TL_INDENT (etc. by track)
Approvers decide (use cases)
Procurement:
  → create RFQ + enqueue email jobs
  → Gmail sync ingest quotations
  → AI extract (cached) + deterministic score
  → mark quotes ready → select vendor → TL vendor / further approvals
  → PO draft/upload → send PO email
Finance:
  → accounts / final review use cases
```

Async: `jobs` table + worker (`email.send`, `gmail.sync`, …). Local may use `JOBS_INLINE=1`.

Copilot tools mirror many of these steps behind confirmation — see action-tools.
