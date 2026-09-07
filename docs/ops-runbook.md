# Operational runbook (go-live). Quarterly disaster-recovery rehearsal is operator-owned.

## Pre-deploy
1. Rotate `OPENAI_API_KEY`, `SESSION_SECRET`, `GMAIL_TOKEN_SECRET`.
2. Set `ADMIN_INITIAL_PASSWORD` (?12 chars) and run `npm run db:seed-admin`.
3. Run `npm run db:migrate` as a separate pre-deploy task (never on app boot).
4. Production: leave `JOBS_INLINE` unset; run a worker (`ROLE=worker`).
5. Set `S3_BUCKET` + IAM for multi-task ECS.

## Health
- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- Dependencies (auth): `GET /api/health/deps`

## Rollback
- ECS deployment circuit breaker rolls back failed web/worker deploys.
- Migrations are expand-only; application rollback does not require schema rollback.

## Gmail
- Connect/disconnect is ADMIN-only.
- Scopes: `gmail.send` + `gmail.readonly` (Google verification is an operator process).
- Incremental sync uses `history.list`; expired history falls back to a bounded full scan.

## Secrets
- Store app secrets in Secrets Manager (see `infra/main.tf`).
- Required JSON keys: `DATABASE_URL`, `SESSION_SECRET`, `GMAIL_TOKEN_SECRET`,
  `OPENAI_API_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `APP_URL`.
- Never commit `.env`.
- Staging cost: leave `enable_nat=false` unless tasks must be private; set `certificate_arn` before production HTTPS.
