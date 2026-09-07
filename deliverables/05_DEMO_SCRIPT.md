# Demo script (~5 minutes)

Record your screen. When you’re done, drop the link in [README.md](./README.md).

Loom / QuickTime / OBS — whatever.  
App: https://medflow-13-50-17-61.sslip.io  
Have Requester (and maybe TL) creds ready. Don’t flash `.env` or type the password in giant font.

## 0:00–0:45 — why this exists

Talk normally:

People keep asking where their indent is and what they’re supposed to click. Menus work if you already know them. Plain ChatGPT will invent a status because it can’t see the database.

Optionally click around Indents for a few seconds so the “old way” is visible.

## 0:45–2:30 — one real path

Log in as Requester. Open Copilot.

Ask something like: what are my open indents and what should I do next?

If there’s a draft, ask it to submit. Show the Confirm card. Confirm it. Ask for status again — should be waiting on Team Leader (or whatever the workflow says).

Flip to the indent page once so it’s obvious the UI agrees with the chat.

Say out loud: the model suggested it, I confirmed, the workflow code wrote the status.

## 2:30–3:15 — not a developer toy

Point at the normal sidebar. No terminal. Confirm / Cancel are obvious. Mention there’s a runbook in this folder if someone else has to drive it.

## 3:15–4:15 — breaking it a little

As Requester, ask it to send an RFQ (or similar). It should refuse.

Or glance at the eval doc / mention `npm run test:eval`. Mention model-down and nasty PDF text as things you already hardened.

## 4:15–5:00 — results + the ugly limitation

Staging is live, roles are enforced, writes need Confirm, there’s an eval suite. Biggest caveat on this demo environment: Gmail/S3 aren’t the hero path, and Copilot is help — not a full autopilot for procurement.

End with the repo link. Stop talking.

## Before you upload

- [ ] No secrets on screen
- [ ] Confirm click is visible
- [ ] You said what was slow before
- [ ] You named one real limitation
- [ ] Link pasted into deliverables README
