# Operator runbook

You don’t need to be a developer. Browser is enough.

## What you’re using

MedFlow tracks purchase indents through approvals, procurement, and finance. Copilot is the chat on the side that can look stuff up and suggest actions. If something would change a case, you’ll get a Confirm step — read it before you click.

## Get in

1. Go to https://medflow-13-50-17-61.sslip.io  
2. Sign in with the account you were given (or create an account for a normal business role — not Admin).  
3. Use Dashboard / Indents / Copilot from the left.

If you’re setting up a laptop from scratch, that’s a different story — see the main project README (env file, migrate, seed, `npm run dev`).

## Requester path that usually works

Create an indent under Indents → New (or ask Copilot to help with a draft). Save it.

In Copilot, ask to submit that draft. Read the preview. Confirm.

Ask what the status is. You should see it waiting on Team Leader review (wording may vary slightly).

## Team Leader

Log in as TL. Ask Copilot what’s pending for you, or use Approvals / the indent screen. Approve or reject like you normally would — Copilot will also ask you to confirm if it proposes the action.

## Procurement / Finance

Same idea: ask for the queue or status, let it propose something your role can do, confirm, then peek at the indent page to double-check.

## If it feels wrong

Copilot says forbidden / can’t — you’re probably on the wrong stage or wrong role. Open the indent and look at the timeline.

Confirm expired — just ask again and confirm sooner.

Copilot errors out — use the normal Indents UI and tell whoever runs the server if it keeps happening.

Data looks wrong — don’t invent a workaround in chat. Cancel and check the case page.

## Please don’t

Share passwords in screenshots.  
Confirm actions you don’t understand.  
Treat Copilot as a way around approvals.  
Expect public signup to make you an Admin — it won’t.

## If you run the staging machine

Ops notes are in `docs/ops-runbook.md` and the AWS deploy doc. Don’t casually wipe Docker volumes.

## Empty environment?

Ask whoever owns the project to seed admin / role users / items. Passwords are not sitting in the GitHub repo on purpose.
