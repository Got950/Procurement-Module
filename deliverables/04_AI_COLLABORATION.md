# AI collaboration note

I used AI a lot on this project. I also didn’t let it merge anything I hadn’t checked.

## What I used

Cursor (Composer / agents) for most of the coding, searching the repo, tests, and drafting docs — including this folder. I treat it like a fast junior who has read the tree, not like an owner.

OpenAI’s API is what the product Copilot calls at runtime. That’s different from the IDE help.

GitHub is just where the code lives.

Vitest / the eval harness isn’t “generative AI,” but it’s how I keep the Copilot from rotting when prompts change.

I did not set up some autonomous CI agent that ships to master while I sleep.

## What I handed to AI

Boilerplate routes, wiring Copilot tools, registration flow, a bunch of tests, first drafts of architecture notes, grepping for existing auth patterns so I didn’t invent a second login system, and brainstorming failure modes (confirms, fencing, loop limits).

## How I checked the output

Code: typecheck, lint, build, `npm test`, `npm run test:eval`.

Auth claims: integration tests, then logging in as different roles on staging and trying to be dumb on purpose.

Mutations: if it writes, it should have gone through Confirm, show up in audit as COPILOT, and leave the status the workflow expects.

Docs: I compare them to `src/server/copilot/*` and the decision notes. If the doc and the code fight, the code wins and I fix the doc.

Security-ish bits: reuse the existing password hashing; public register allowlist does not include ADMIN even if someone posts it in JSON.

## Stuff I threw away or fixed by hand

I killed ideas where the model would set status itself or “be the ACL.”

I refused auto-sending RFQs / POs / approvals with no human click. Extra click is fine.

I ignored the urge to bolt on RAG / MCP / multi-agent because the checklist online said so. No measured need.

Small corrections that mattered: the real role code is `TEAM_LEADER`, not inventing `TL` in the database. Registration has to validate roles on the server. Old docs saying “no eval harness” were wrong after we added one. And “just ask ChatGPT” without tools is not an ERP answer.

## Decisions that were mine

The bottleneck is status + next allowed action, not “replace SAP in five days.”

Copilot assists; workflow code commits.

Fail closed on auth. Fence untrusted text. Confirm the scary writes.

Ship without depending on Gmail/S3 for the demo story.

Prove with a golden eval + a boring menu baseline, not a single lucky chat.

Handoff = runbook + seeds + live URL. Secrets stay out of git.

Put the sprint paperwork in `deliverables/` so graders aren’t archaeology-ing random AWS audit markdown.

I used AI to move faster. The domain rules and the “what must never be automated” calls are on me.
