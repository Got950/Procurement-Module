# Day 1 notes — discovery

I didn’t get to sit next to a buyer for a full week. Fair to say that up front. What I did have was a real procurement flow (indent → TL / Director / MD → procurement → finance) and I treated a Requester as my main user: someone who is not technical, raises purchase requests, and constantly loses time figuring out status.

TL, Procurement, and Finance use the same Copilot later, but Day 1 was about the Requester pain.

## Who

Main person: Requester (lab / ops style). They live in the browser. They should not need a terminal or me on a call.

## What they’re trying to do

They open a purchase case and basically ask: is this still a draft, who has it, and what am I allowed to do right now — submit, wait, chase someone, upload something. Then they want to do that next step without clicking through half the app or pinging WhatsApp.

## How it worked before

Trigger is usually “we need this material.” Input ends up in email threads, a spreadsheet, maybe a shared drive folder with PDFs named badly. Judgment is tribal: who approves what amount, did I already submit this, is procurement waiting on me. Approvals get forwarded around. Output is often just whatever the last email said. Exceptions are boring and constant — missing attachment, wrong person, duplicate request, “any update?” every other day.

I timed myself on staging doing the menu path for a known draft (login → indents → open → read timeline → decide). Roughly 4–7 minutes when I wasn’t rushing like I already knew the UI. Dumping the same question into plain ChatGPT was faster and useless: it invents status and can’t submit anything.

That’s the baseline I’m comparing against. If you re-time on demo day and the numbers move a bit, update the eval doc — don’t pretend the stopwatch is sacred.

## Why it keeps hurting

It happens on every live case, not once a quarter. Status alone burns minutes. People redo uploads, ask the same status question twice, and sometimes try an action that isn’t theirs (Requester poking at RFQ stuff). There are a lot of statuses and seven roles; nobody memorizes the matrix.

## What “better” means for me

- Get to a correct next step in about a minute and a half on seeded cases, not five.
- Zero unauthorized writes in the test set.
- Anything consequential still needs a human Confirm click.
- `npm run test:eval` mostly green (I’m aiming 90%+).
- Someone else can follow the runbook and finish submit/approve without me hovering.

## Things I refused to build in five days

No autopilot that finishes procurement alone. No multi-tenant SaaS. No RAG/MCP science project. Demo doesn’t depend on live Gmail or S3. Copilot helps; the workflow code still owns the status field. Public signup never creates ADMIN.

## Cases I wanted covered (full table is in the eval pack)

Happy ones: list my indents, submit a draft with confirm, TL sees pending.

Nasty ones: Requester tries RFQ, Requester opens someone else’s indent, model dies mid-turn, junk instructions inside a PDF, tool loop spinning, confirm expired, Procurement trying a finance-final action, vague prompt, PDF download only when allowed.

## What shipped as v1

Live MedFlow, Copilot chat, RBAC tools, confirm on writes, seeds, eval harness, staging URL, this folder.

Not HA production. Not “verified Gmail/S3 or bust.” Not a swarm of agents.
