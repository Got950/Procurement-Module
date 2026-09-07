# MedFlow — AWS Deployment

**Date:** 2026-09-06  
**Product:** MedFlow / pharmaceutical procurement platform  
**Secrets policy:** No passwords, tokens, API keys, cookie values, or `.env` contents are reproduced here.

---

## Public URL

**https://medflow-13-50-17-61.sslip.io**

## Login URL

**https://medflow-13-50-17-61.sslip.io/login**

Health (no login):

- https://medflow-13-50-17-61.sslip.io/api/health/live
- https://medflow-13-50-17-61.sslip.io/api/health/ready

HTTP automatically redirects to HTTPS.

---

## Architecture

```
Internet
  → TCP 80/443 (Security Group)
  → Caddy (host reverse proxy, automatic Let's Encrypt)
  → 127.0.0.1:3000 (Next.js web container)
  → PostgreSQL (127.0.0.1:5432 only)
  → worker (same image, no published ports)
```

| Layer | Detail |
|-------|--------|
| EC2 | `i-0a146e96ab5f14a74` · `eu-north-1` · Amazon Linux 2023 |
| Public IP | `13.50.17.61` |
| Hostname | `medflow-13-50-17-61.sslip.io` (sslip.io → same IP) |
| App path | `/opt/asseflow/app` |
| Compose | `docker-compose.staging.yml` |
| Image | `asseflow:staging` |
| Reverse proxy | Caddy v2 (`/etc/caddy/Caddyfile`, systemd `caddy.service`) |

---

## Docker services

| Service | Image | Ports | Restart | Notes |
|---------|-------|-------|---------|-------|
| `web` | `asseflow:staging` | `127.0.0.1:3000→3000` | unless-stopped | Public traffic only via Caddy |
| `worker` | `asseflow:staging` | none | unless-stopped | Background jobs |
| `db` | `postgres:16-alpine` | `127.0.0.1:5432→5432` | unless-stopped | Not public |

### Volumes (do not delete)

- `app_pgdata` — PostgreSQL data
- `app_uploads` — document uploads under `/app/data/uploads`

---

## How evaluators access the application

1. Open **https://medflow-13-50-17-61.sslip.io/login** in Chrome, Safari, or Edge.
2. No VPN, hosts file, or client certificate install is required.
3. Use the seeded demo accounts listed in `docs/EVALUATOR_GUIDE.md`.
4. Ask the submitter for the shared demo password out-of-band (never stored in GitHub).

---

## Environment variable names (values never committed)

Present on the host `.env` (mode `600`):

`APP_URL`, `NEXT_PUBLIC_APP_URL`, `FORCE_SECURE_COOKIES`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `SESSION_SECRET`, `OPENAI_API_KEY`, `NODE_ENV`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `ADMIN_INITIAL_PASSWORD`, `DEMO_USER_PASSWORD`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_TOKEN_SECRET`

Canonical public URL configuration:

- `APP_URL=https://medflow-13-50-17-61.sslip.io`
- `NEXT_PUBLIC_APP_URL=https://medflow-13-50-17-61.sslip.io`
- `FORCE_SECURE_COOKIES=1` (only after HTTPS is live)

**Not present:** S3 / object-store credentials.

---

## HTTPS configuration

- Host Caddy listens on `:80` and `:443`.
- Automatic trusted certificates via Let's Encrypt (stored under `/var/lib/caddy` — not in git).
- HTTP → HTTPS redirect (308).
- App container bound to loopback only after cutover.
- Repo files: `deploy/Caddyfile`, `deploy/install-caddy.sh`.

Reload proxy after Caddyfile edits:

```bash
sudo cp /opt/asseflow/app/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## Health endpoints

| Endpoint | Expected |
|----------|----------|
| `/api/health/live` | `{"status":"ok"}` |
| `/api/health/ready` | `{"status":"ready","checks":{"config":"ok","database":"ok"}}` |

---

## Deployment / update commands

```bash
ssh -i asseflow-staging.pem ec2-user@13.50.17.61
cd /opt/asseflow/app
git fetch origin
git status   # inspect local changes before pulling
git pull --ff-only

docker compose -f docker-compose.staging.yml --env-file .env build web
docker compose -f docker-compose.staging.yml --env-file .env up -d --force-recreate --no-deps web worker
# NEVER: down -v | system prune --volumes | dropdb | migrate down

curl -sS http://127.0.0.1:3000/api/health/live
curl -sS http://127.0.0.1:3000/api/health/ready
curl -sS -I https://medflow-13-50-17-61.sslip.io
```

Safe disk hygiene (volumes untouched):

```bash
docker image prune -f
docker builder prune -af
df -h
```

---

## Rollback procedure

1. Note previous working image id: `docker images asseflow`.
2. Retag or rebuild from a known-good git SHA.
3. Recreate **only** `web` and `worker` (`--no-deps`); leave `db` and volumes alone.
4. Verify health endpoints and login.
5. If Caddy misbehaves: `sudo systemctl restart caddy` (certs persist in `/var/lib/caddy`).

---

## Persistence across reboot

| Component | Mechanism |
|-----------|-----------|
| Docker engine | `systemctl enable docker` |
| web / worker / db | Compose `restart: unless-stopped` |
| Caddy | `systemctl enable caddy` |
| Postgres data | Docker volume `app_pgdata` |
| Uploads | Docker volume `app_uploads` |

Do not reboot casually on the small staging disk; inspect unit enablement instead.

---

## Security considerations

- PostgreSQL bound to loopback only.
- Application port not published publicly (loopback `:3000`).
- Docker socket not mounted; no privileged compose flags.
- Session cookies: HttpOnly + SameSite; `Secure` when `FORCE_SECURE_COOKIES=1`.
- Non-root app process after entrypoint chown of uploads.
- Security Group must expose **only** TCP 80 and 443 to the internet for the app; SSH should not be `0.0.0.0/0` unless unavoidable.
- Do **not** open TCP 5432 publicly.

### Required Security Group (`sg-04c917cbfd51665f6`, region `eu-north-1`)

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| HTTP | 80 | `0.0.0.0/0` (and optionally `::/0`) | ACME HTTP-01 + redirect |
| HTTPS | 443 | `0.0.0.0/0` (and optionally `::/0`) | Public app TLS |
| SSH | 22 | Your IP /24 only | Admin access |
| — | 5432 | **none / remove if present** | Must stay private |

Without world-open 80/443, Let's Encrypt cannot issue a certificate and external evaluators cannot reach HTTPS.

---

## Feature verification status

| Feature | Status |
|---------|--------|
| HTTPS + trusted cert | **PASS** — Let's Encrypt via Caddy; HTTP→HTTPS 308 |
| Auth / RBAC / IDOR | Covered by prior live QA + automated tests |
| Copilot | Live on staging; prompt-injection protections in tests |
| Documents / PDF | Filesystem store; magic-byte + authz checks |
| Gmail send/sync | **UNVERIFIED** — intentionally excluded from this cutover |
| S3 document store | **UNVERIFIED** — not configured; filesystem in use |

---

## Staging limitations

- Single small EC2 (≈2 vCPU / 3.7 GiB / 8 GB root) — not sized for load tests.
- No swap; prune Docker build cache after rebuilds.
- In-process rate limits (per container).
- Gmail OAuth redirect still points at the previous host configuration; live Gmail remains out of scope.
- S3 not enabled.

---

## Related docs

- `docs/EVALUATOR_GUIDE.md` — evaluator walkthrough
- `docs/AWS_FINAL_AUDIT_REPORT.md` — prior security/audit scorecard
- `deploy/Caddyfile` — reverse proxy site config
