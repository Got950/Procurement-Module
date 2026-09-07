# Copilot — TESTING

## Automated

```bash
npm test -- tests/unit/copilot.test.ts tests/integration/copilot.test.ts
npm run test:eval
npm run test:eval:canary
```

Covers: untrusted fencing, registry/role gates, confirmation requirement, IDOR, ownership, claim replay, cancel, loop guard, model unavailable, finance tool forbidden for procurement, **golden eval dimensions** (authz, HITL, trajectory, safety).

## Manual smoke

1. Login as REQUESTER — list own indents; cannot see others  
2. Ask to submit draft — confirmation card; cancel leaves DRAFT  
3. Confirm submit — status advances; audit/tool_executions row  
4. Login as PROCUREMENT — RFQ tool requires confirm; QUEUED vs SENT language  
5. Disconnect OpenAI key — chat returns controlled unavailable message  

## Not yet automated

- Full RFQ email confirm E2E with worker  
- Golden conversational eval suite  
- Load/rate-limit soak  
