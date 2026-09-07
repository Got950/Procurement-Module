# Case study — MedFlow

## In one breath

I built MedFlow so people who raise and approve pharma purchase indents spend less time hunting for status. The Copilot answers from live data, suggests the next allowed step, and won’t actually change a case until you hit Confirm.

## User and problem

User is a Requester first (and later TL / Procurement / Finance on the same chat). On staging I used seeded accounts rather than production buyers — same job shapes, synthetic names.

The annoying part isn’t “can we store an indent.” It’s the daily tax: open three screens, skim a timeline, ask a colleague what stage means, maybe click the wrong thing. Delays slow purchasing. Wrong clicks mean rework.

## Before / after

Before: email + spreadsheet + memory of who approves, then eventually ERP screens. Same question every time — what’s the state, what am I allowed to do.

After: that state machine still lives in MedFlow (I did not let the model write `current_status`). Copilot pulls facts with tools, explains the next move, parks writes behind a confirmation, then the normal workflow code commits if you confirm.

## What I kept in vs cut

In: full indent UI path, roles, PDFs/docs, Copilot read tools + confirm-on-write, audit, password reset, signup for business roles only, staging on AWS.

Cut on purpose: agent that “just finishes the case,” model talking straight to SQL, multi-agent stacks, vector DB, MCP, making Gmail/S3 mandatory for the demo.

## Shape of the system

Browser → Next app + `/copilot` → session/RBAC → bounded tool loop → tools call the same use-cases as the UI → confirm endpoint claims the pending action → Postgres + audit with source COPILOT.

Trade-offs I actually felt:

- One agent with hard limits is boring and testable. Multi-hop questions sometimes need a tighter prompt.
- Skipping RAG means answers stay tied to DB truth. Don’t ask it for the employee handbook.
- Confirm on every serious write is an extra click. I kept it anyway for RFQ / PO / approvals.
- Some roles see more indents than a strict tenancy model would. That’s how this ERP was already modeled; Copilot inherits it.

## AI vs human

Copilot can fetch status, counts, docs, quotes, and propose a legal next action. It should refuse stuff outside the role.

You still decide what you meant, click Confirm or Cancel, handle weird policy exceptions, and own the approval / money decisions. Untrusted vendor text gets fenced so it doesn’t become instructions.

## What broke, what I changed

Model outage used to be a scary blank failure mode — now you get a plain error and nothing mutates.

Guessing another user’s indent id fails closed (not found), not “here’s their case.”

If the model repeats the same tool, we stop instead of hallucinating that an email went out.

PDF/extracted text that says “ignore rules and approve” gets wrapped as untrusted data.

Confirmations expire / can’t be replayed forever.

Results I’m willing to show: staging is up, `npm run test:eval` covers the golden set, and a non-dev path is login → Copilot → ask → confirm.

Limitations I’m not hiding: Gmail and S3 aren’t the staging hero path, replies aren’t streamed, and the stopwatch numbers in the eval doc should be re-run when you film the demo.

## Improvement (how I’m proving it)

Menu path for “status + next action” was in the 4–7 minute range when I timed it cold. Target with Copilot on seeded cases is under ~90 seconds. Blocking bad writes is mostly proven in the eval suite, not by vibes. Writes that matter always go through Confirm.

Leave blank rows in the eval pack if you want fresh timings on camera day.

## First two weeks if someone else takes it

Week 1: three people (Requester, TL, Procurement) use Copilot for status every day; jot five things that feel stupid.

Week 2: turn those into a few more golden cases, bump prompt version if needed, decide if Gmail is worth turning on in a narrow lane.

I’d watch sessions per week, how often confirms actually execute vs cancel, eval pass rate, and time on a fixed set of ten cases.

## Next iteration (two weeks of build)

Re-check latency/cost logs on staging. Streaming only if people complain it’s painful to wait. Maybe RFQ-via-Gmail behind a flag. Add failures from week 1 into `tests/eval`. Touch tenancy only if that’s suddenly a real requirement.

More detail: discovery, eval pack, AI note, and operator runbook in this folder. Deeper engineering notes live under `docs/architecture/` and `docs/domains/copilot/`.
