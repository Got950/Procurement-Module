# Procurement — TESTING

```bash
npm test -- tests/integration/indent-workflow.test.ts tests/integration/workflow-matrix.test.ts
npm test -- tests/unit/budget-approval.test.ts tests/unit/rbac-matrix.test.ts
```

Manual: create indent → approve along budget track → RFQ → quote → select → PO → finance.

When changing workflow guards, update matrix tests and Copilot tool role allow-lists together.
