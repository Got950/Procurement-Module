# MedFlow — AWS Final Audit Report

**Date:** 2026-09-06  
**Product:** MedFlow / pharmaceutical procurement platform  
**Staging URL:** https://medflow-13-50-17-61.sslip.io
**Login:** https://medflow-13-50-17-61.sslip.io/login
**Host path:** `/opt/asseflow/app`
**Compose:** `docker-compose.staging.yml`
**Secrets policy:** No passwords, tokens, cookie values, API keys, or `.env` contents are reproduced.

---

## Overall verdict

**PASS** for evaluator-facing AWS staging demonstration over HTTPS.

HTTPS is live with a trusted Let's Encrypt certificate for `medflow-13-50-17-61.sslip.io`, Caddy redirects HTTP→HTTPS, Secure cookies are enabled, migration `0013` is applied, and prior RBAC/IDOR hardenings remain in place. Gmail live send/sync and S3 remain intentionally out of staging scope.

---

## Scorecard

| Area | Result | Notes |
|------|--------|-------|
| CODE | PASS | Logout cookie Secure fix; text-quote `storagePath` redaction; Gmail OAuth cookie/`redirect` hardening |
| BUILD | PASS | `npm run build` |
| TESTS | 192 PASSED / 0 FAILED | `npm test` |
| TYPECHECK | PASS | `tsc --noEmit` |
| LINT | PASS (warnings only) | Pre-existing `_removed` in `db.ts` |
| DEPLOYMENT | PASS | web+worker; DB/uploads volumes preserved |
| WEB | PASS | healthy; HTTPS `/api/health/live` + `ready` |
| WORKER | PASS | non-root `app` process |
| DATABASE | PASS | Postgres healthy; bound `127.0.0.1:5432` |
| MIGRATIONS | PASS | Through `0013_jobs_running_index` |
| AUTHENTICATION | PASS | Login/logout via HTTPS |
| SESSION SECURITY | PASS | HttpOnly + SameSite=Lax + Secure (`FORCE_SECURE_COOKIES=1`) |
| RBAC / IDOR | PASS | Prior live matrix retained |
| DOCUMENT SECURITY | PASS | PDF magic; path jail; authz on download |
| DOCKER SECURITY | PASS | Non-root app PID; no docker.sock; no privileged |
| HTTPS | PASS | Let's Encrypt; HTTP 308 → HTTPS |
| DISK | PASS | ~47% of 8 GB root |
| GMAIL | UNVERIFIED | Live send/sync intentionally untouched |
| S3 | UNVERIFIED | Filesystem store |
| SECRET SCAN | PASS | `.env` gitignored; placeholders only in `.env.example` |

---

## Architecture (as deployed)

```
Internet → EC2 :80/:443 → Caddy → 127.0.0.1:3000 (web)
                                      ↓
                                   Postgres 127.0.0.1:5432
                                   worker (same image)
```

Volumes preserved: `app_pgdata`, `app_uploads`.

---

## HTTPS remediation notes

Earlier ACME failures were firewall/SG timeouts while Caddy already listened on 443 without a certificate (TLS alert internal error). After SG allowed public 80/443 and `/etc/caddy/Caddyfile` was synced from `deploy/Caddyfile`, Let's Encrypt issued a valid cert (issuer YE2).

---

## Remaining items

### Safe to leave for later

- S3 document store
- Shared/redis rate limiting
- Worker healthcheck (intentionally disabled)
- Live Gmail OAuth reconnect against HTTPS redirect URI

### Requires manual AWS attention (optional hardening)

- Narrow SSH (TCP 22) to operator IP if still `0.0.0.0/0`
- Expand root EBS beyond 8 GB before heavy rebuilds/load

### Unverified due to scope

- Gmail send/sync E2E
- S3 upload/download E2E
- AWS Console SG/IAM inspection without AWS CLI credentials
