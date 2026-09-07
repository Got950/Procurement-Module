# MedFlow — AWS EC2 Staging Deployment Runbook

**Verified on:** 2026-09-06  
**Host:** `ec2-user@13.50.17.61` (`i-0a146e96ab5f14a74`, `eu-north-1c`)  
**App path:** `/opt/asseflow/app`  
**Compose file:** `docker-compose.staging.yml`

Commands below were verified on the staging EC2 host unless marked otherwise.

---

## Connect

```bash
ssh -i /Users/mac3ssev/Desktop/p2p/asseflow-staging.pem ec2-user@13.50.17.61
```

Public evaluator URL (HTTPS):

- https://medflow-13-50-17-61.sslip.io/login
- Caddy on the host terminates TLS and reverse-proxies to `127.0.0.1:3000`

---

## Layout

| Path | Purpose |
|------|---------|
| `/opt/asseflow/app` | Git clone of `Got950/Procurement-Module` |
| `/opt/asseflow/app/.env` | Staging secrets (mode `600`, not in git) |
| `/opt/asseflow/app/docker-compose.staging.yml` | `db` + `web` + `worker` |
| `/etc/caddy/Caddyfile` | Host reverse proxy (from `deploy/Caddyfile`) |

Services:

- `db` — Postgres 16 (bound to host `127.0.0.1:5432` only)
- `web` — Next.js on container `:3000`, published as host `127.0.0.1:3000` only
- `worker` — `ROLE=worker` job drain (`tsx src/worker.ts`)
- Caddy (systemd) — public `:80` / `:443` → web

---

## Health checks

From the EC2 host:

```bash
curl -sS http://127.0.0.1:3000/api/health/live
curl -sS http://127.0.0.1:3000/api/health/ready
curl -fsS https://medflow-13-50-17-61.sslip.io/api/health/live
curl -fsS https://medflow-13-50-17-61.sslip.io/api/health/ready
cd /opt/asseflow/app
docker compose -f docker-compose.staging.yml --env-file .env ps
sudo systemctl status caddy --no-pager | head -15
```

Expected:

- live → `{"status":"ok"}`
- ready → `{"status":"ready","checks":{"config":"ok","database":"ok"}}`
- `app-web-1` → `(healthy)`
- HTTP → HTTPS 308 redirect; HTTPS certificate from Let's Encrypt

---

## Inspect logs

```bash
cd /opt/asseflow/app
docker compose -f docker-compose.staging.yml --env-file .env logs -f --tail=200 web
docker compose -f docker-compose.staging.yml --env-file .env logs -f --tail=200 worker
docker compose -f docker-compose.staging.yml --env-file .env logs --tail=100 db
```

---

## Update application (pull → rebuild → restart)

```bash
ssh -i /Users/mac3ssev/Desktop/p2p/asseflow-staging.pem ec2-user@13.50.17.61
cd /opt/asseflow/app
git fetch origin
git checkout master
git pull --ff-only origin master

export DOCKER_BUILDKIT=1
docker compose -f docker-compose.staging.yml --env-file .env build web
docker compose -f docker-compose.staging.yml --env-file .env up -d web worker
docker builder prune -f
curl -sS http://127.0.0.1/api/health/ready
```

Notes verified during first deploy:

- Amazon Linux 2023 did not ship `docker-compose-plugin` via `dnf`; Compose v2.29.7 was installed to `/usr/libexec/docker/cli-plugins/docker-compose`.
- Disk is **8 GB**. Prune build cache after each rebuild. Expand EBS before large rebuilds if free space is under ~3 GB.

---

## Run migrations (safe `up` only)

Do **not** use bare `npx node-pg-migrate up` for this project: migrations that set `disableTransaction` (e.g. `CREATE INDEX CONCURRENTLY`) fail in the CLI transaction path.

Verified method:

```bash
cd /opt/asseflow/app
set -a; source .env; set +a

# One-time / as needed: deps image with full node_modules (includes node-pg-migrate)
docker build --target deps -t asseflow:deps .

docker run --rm --network app_default \
  -e DATABASE_URL \
  -v "$(pwd)/migrations:/app/migrations:ro" \
  -v "$(pwd)/scripts/run-migrate.mjs:/app/run-migrate.mjs:ro" \
  -w /app \
  asseflow:deps \
  node run-migrate.mjs

docker compose -f docker-compose.staging.yml --env-file .env exec -T db \
  psql -U postgres -d pharma_procurement -c "SELECT id, name FROM pgmigrations ORDER BY id;"

docker rmi asseflow:deps   # reclaim disk when done
```

Never run `db:migrate:down`, reset, drop, or truncate against staging data unless explicitly approved.

---

## Seed admin / demo users (non-destructive upserts)

```bash
cd /opt/asseflow/app
set -a; source .env; set +a
docker build --target deps -t asseflow:deps .

docker run --rm --network app_default \
  -e DATABASE_URL -e ADMIN_INITIAL_PASSWORD \
  -v "$(pwd)/scripts:/app/scripts:ro" \
  -v "$(pwd)/src:/app/src:ro" \
  -v "$(pwd)/tsconfig.json:/app/tsconfig.json:ro" \
  -w /app asseflow:deps npx tsx scripts/seed-admin.ts

docker run --rm --network app_default \
  -e DATABASE_URL -e ADMIN_INITIAL_PASSWORD -e DEMO_USER_PASSWORD \
  -v "$(pwd)/scripts:/app/scripts:ro" \
  -v "$(pwd)/src:/app/src:ro" \
  -v "$(pwd)/tsconfig.json:/app/tsconfig.json:ro" \
  -w /app asseflow:deps npx tsx scripts/seed-demo-users.ts
```

Default seeded identities (passwords come from env; not printed by scripts):

- Admin: `admin` / `admin@must.co.in`
- Demo roles: `ananya.mehta`, `rohan.kapoor`, `kavitha.iyer`, `suresh.menon`, `meera.krishnan`, `arjun.desai`

---

## Restart / recover

```bash
cd /opt/asseflow/app
docker compose -f docker-compose.staging.yml --env-file .env restart web worker
# or single container:
docker restart app-web-1
curl -sS http://127.0.0.1/api/health/ready
```

Restart policy: `unless-stopped` (verified in compose).

---

## Rollback (git commit / image)

Git rollback (verified pattern; choose a known-good SHA first):

```bash
cd /opt/asseflow/app
git log --oneline -10
git checkout <known-good-sha>
docker compose -f docker-compose.staging.yml --env-file .env build web
docker compose -f docker-compose.staging.yml --env-file .env up -d web worker
curl -sS http://127.0.0.1/api/health/ready
```

Image tag rollback (if a previous image ID was retained):

```bash
docker images asseflow
docker tag <old-image-id> asseflow:staging
docker compose -f docker-compose.staging.yml --env-file .env up -d web worker
```

Migrations are expand-only; application rollback does **not** automatically roll schema back.

---

## Environment variables (names only)

Required on staging:

- `DATABASE_URL`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ADMIN_INITIAL_PASSWORD`

Configured for features:

- `OPENAI_API_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN_SECRET`
- `GMAIL_REDIRECT_URI`, `APP_URL`, `NEXT_PUBLIC_APP_URL`
- `FORCE_SECURE_COOKIES=1` (HTTPS staging via Caddy)
- `APP_URL` / `NEXT_PUBLIC_APP_URL` = `https://medflow-13-50-17-61.sslip.io`
- `HOSTNAME=0.0.0.0` (compose web service)

Optional / not set on this host:

- `S3_BUCKET`, `AWS_REGION` → documents use local filesystem volume `uploads`
- `JOBS_INLINE` → intentionally unset; worker processes jobs

Never commit `.env`. Never put secrets in Dockerfile or git.

---

## Security Group (manual)

Instance SG: `launch-wizard-1` (`sg-04c917cbfd51665f6`).

Required inbound:

- **TCP 80** from `0.0.0.0/0` (ACME HTTP-01 + redirect)
- **TCP 443** from `0.0.0.0/0` (evaluator HTTPS)
- **TCP 22** from operator IP only (preferred)
- Do **not** open `5432` publicly (already loopback-only on host)

AWS CLI credentials are typically unavailable on this host; change SG in the AWS Console if needed.

---

## HTTPS / Caddy

Hostname: `medflow-13-50-17-61.sslip.io` (sslip.io DNS → `13.50.17.61`).

```bash
sudo cp /opt/asseflow/app/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
# or: bash /opt/asseflow/app/deploy/install-caddy.sh
# after HTTPS health OK: bash /opt/asseflow/app/deploy/enable-secure-cookies.sh
```

Certificates persist under `/var/lib/caddy`. Do not commit private keys.
