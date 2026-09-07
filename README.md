<p align="center">
  <img src="public/images/medflow-logo.png" alt="MedFlow" width="120" height="120" />
</p>

<h1 align="center">MedFlow</h1>

<p align="center">
  <strong>Pharmaceutical Procurement</strong><br />
  Indent lifecycle · RBAC approvals · RFQ/PO workflows · documents · AI Procurement Copilot
</p>

<p align="center">
  <a href="https://medflow-13-50-17-61.sslip.io"><strong>Live app</strong></a>
  ·
  <a href="https://medflow-13-50-17-61.sslip.io/login"><strong>Login</strong></a>
  ·
  <a href="USER_MANUAL.md"><strong>User manual</strong></a>
  ·
  <a href="docs/EVALUATOR_GUIDE.md"><strong>Evaluator guide</strong></a>
  ·
  <a href="deliverables/"><strong>Sprint deliverables</strong></a>
</p>

---

Ask the submitter for the shared staging password (not stored in GitHub).

**End-user how-to (non-technical):** [`USER_MANUAL.md`](USER_MANUAL.md) — click-by-click guide for every role and screen.  
Product / evaluator walkthrough: [`docs/EVALUATOR_GUIDE.md`](docs/EVALUATOR_GUIDE.md).

**Gmail** is intentionally disabled / unverified for this staging demonstration. **S3** is not configured — documents use filesystem storage.

## Features

- Indent lifecycle: create → submit → TL / Director / MD approvals → procurement → finance
- Strict RBAC across REQUESTER, TEAM_LEADER, PROCUREMENT, DIRECTOR, MD, FINANCE, ADMIN
- PDF generation, PDF document upload/download with validation
- Procurement Copilot (OpenAI) with server-side authorization and prompt-injection protections
- Optional Gmail RFQ/PO email integration (**out of scope for staging demo**)
- Optional S3 document store (**filesystem used on staging**)
- Audit log, notifications, password recovery, admin user management

## Architecture

```
Internet → medflow-13-50-17-61.sslip.io
        → Caddy :443 (HTTPS / Let's Encrypt)
        → Docker web :3000 → Postgres (127.0.0.1:5432)
                   ↑
                worker (job queue)
```

Code layout:

- `src/app/` — App Router pages + `api/` route handlers
- `src/server/` — workflow, jobs, Copilot, document store
- `src/lib/` — DB, session, RBAC, validation
- `public/images/medflow-logo.png` — official product logo
- `migrations/` — expand-only SQL (`node-pg-migrate`)
- `docker-compose.staging.yml` — EC2 staging stack (web + worker + Postgres)

## Local setup

**Prerequisites:** Node.js 20+, PostgreSQL 16+

```bash
cp .env.example .env   # fill SESSION_SECRET, ADMIN_INITIAL_PASSWORD, DATABASE_URL, optional OPENAI_API_KEY
npm install
npm run db:migrate
npm run db:seed-admin
npm run db:seed-demo-users   # optional role accounts
npm run db:seed-items        # optional catalog
npm run dev
```

Worker (production-style jobs): `npm run worker` (or Docker `ROLE=worker`). Local email jobs: `JOBS_INLINE=1`.

## AWS deployment

Staging host pattern (existing EC2 + Docker Compose + Caddy HTTPS):

- Docs: `docs/AWS_EC2_DEPLOYMENT.md`, `docs/AWS_FINAL_DEPLOYMENT.md`, `docs/EVALUATOR_GUIDE.md`
- Compose: `docker-compose.staging.yml`
- Preserve volumes `pgdata` / `uploads` — never `docker compose down -v`

**Auto-deploy:** pushes to `master` that change app code (see `.github/workflows/deploy-staging.yml` path filters) SSH into the staging EC2 and rebuild **only** `web` + `worker`. Docs/deliverables-only commits are skipped. Infra/Terraform is never applied by this workflow.

Required GitHub Actions secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`.

Current public staging: **https://medflow-13-50-17-61.sslip.io** (HTTP redirects to HTTPS).

## Evaluator guide

**Start here:** [`docs/EVALUATOR_GUIDE.md`](docs/EVALUATOR_GUIDE.md)

- Login: https://medflow-13-50-17-61.sslip.io/login
- Demo accounts for all 7 roles (password shared out-of-band — not in GitHub)
- Workflow, Copilot, RBAC, and security test ideas

Final submission status: [`docs/FINAL_SUBMISSION_REPORT.md`](docs/FINAL_SUBMISSION_REPORT.md)  
API security matrix: [`docs/FINAL_API_SECURITY_MATRIX.md`](docs/FINAL_API_SECURITY_MATRIX.md)  
AWS final audit: [`docs/AWS_FINAL_AUDIT_REPORT.md`](docs/AWS_FINAL_AUDIT_REPORT.md)

## Security

- Authentication required on protected APIs; RBAC enforced server-side
- Session cookies: HttpOnly + SameSite; set `FORCE_SECURE_COOKIES=1` behind HTTPS
- Document path traversal sanitization; PDF magic-byte validation
- Sensitive field redaction (`passwordHash`, bank fields by role, `storagePath` / `s3Key`)
- Copilot tools respect role + ownership; adversarial prompts refused

Do not commit `.env`, PEM files, or real secrets.

## Known limitations

| Item | Status |
|------|--------|
| **Gmail** | UNVERIFIED / OUT OF SCOPE FOR FINAL DEMO |
| **S3** | OUT OF SCOPE / UNVERIFIED (filesystem store) |
| **HTTPS** | Live on staging (`https://medflow-13-50-17-61.sslip.io`, Let's Encrypt via Caddy) |
| Host size | Small EC2 (≈2 vCPU / 3.7 GiB / 8 GB disk); DB pool + rate limits + Copilot/PDF concurrency gates tuned for ~50 concurrent evaluators |
| Tenancy | Single-organization product (no `tenant_id`) |

## Scripts

- `npm test` / `npm run typecheck` / `npm run build` / `npm run lint`
- `npm run db:migrate` / `npm run db:seed-admin` / `npm run db:seed-demo-users`
- Destructive seed/clear requires `ALLOW_DESTRUCTIVE=1`

## License / submission

Private evaluation copy. See repository owner for access and the staging demo password.
