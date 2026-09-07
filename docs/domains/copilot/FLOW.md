# Copilot — FLOW

```
UI CopilotPanel
  → POST /api/copilot/chat { conversationId?, message }
  → auth + rate limit
  → create/load owned conversation
  → expire stale confirmations
  → runCopilotTurn
       append user message
       build messages: systemPrompt + contextPrompt(refs) + recent turns
       loop ≤ maxIterations:
         chat(tools for role)
         if text only → break
         for each tool call (bounded):
           executeToolCall → ok | confirmation | error
         if confirmation → stop further writes
       append assistant message + metadata
  → JSON { reply, toolCalls, pendingConfirmation, stopReason, usage }

Confirm path:
  → POST /api/copilot/confirm { conversationId, confirmationId, decision }
  → claimConfirmation (atomic) | cancel
  → executeToolCall with confirmationId
  → finishConfirmation
  → optional LLM one-shot explanation (falls back to factual summary)
```

Resource budgets: see `LIMITS` in `src/server/copilot/orchestrator.ts`.
