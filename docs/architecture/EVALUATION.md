# Evaluation — Copilot

## Current state

| Capability | Status | Evidence |
|------------|--------|----------|
| Unit tests (registry, prompts, bounds, fencing) | Present | `tests/unit/copilot.test.ts` |
| Integration (IDOR, confirmation, loop, model down) | Present | `tests/integration/copilot.test.ts` |
| Golden conversational eval harness | **Present** | `tests/eval/` |
| Fast canary subset | **Present** | cases with `canary: true` + `npm run test:eval:canary` |
| Trajectory scoring (fixture) | Partial | loop / stopReason / maxModelCalls checks |
| Live model canary | **Not in CI** | Fixtures only — no token spend |
| Cost/quality monitoring | Partial | Turn logs only |

## How to run

```bash
npm run test:eval          # full golden set
npm run test:eval:canary   # canary title filter
```

## Layout

| Path | Role |
|------|------|
| `tests/eval/types.ts` | Case schema / dimensions |
| `tests/eval/fixtures.ts` | Scripted model-down helper |
| `tests/eval/runner.ts` | Executes pure / tool / turn cases |
| `tests/eval/golden.ts` | Dataset |
| `tests/eval/baseline.json` | Expected case ids + promptVersion gate |
| `tests/eval/copilot-eval.test.ts` | Vitest entry |

**CI rule:** model behaviour is fully scripted via `ChatFn`. Do not call live OpenAI in eval.

## Dimensions covered

1. Tool selection / execution  
2. Groundedness (no inventing email success)  
3. Safety (injection fence, no SQL tool)  
4. HITL (confirm required; confirm executes)  
5. AuthZ (IDOR, role gates)  
6. Trajectory (bounds, duplicate loops)  
7. Reliability (model unavailable)

## Release gate

```
FAST CANARY → FULL EVAL → baseline ids + promptVersion match → RELEASE
```

When changing `systemPrompt` semantics: bump `COPILOT_PROMPT_VERSION`, update `baseline.json`, re-run eval.

## Regression rule

Every meaningful production Copilot failure should become a golden case when feasible.
