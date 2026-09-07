#!/usr/bin/env bash
# Run on EC2 after Security Group opens TCP 80 + 443 and HTTPS health succeeds.
# Sets Secure cookies + public HTTPS app URLs. Does not enable Gmail live send/sync.
set -euo pipefail
cd /opt/asseflow/app

PUBLIC_URL="https://medflow-13-50-17-61.sslip.io"

echo "Waiting for public HTTPS..."
for i in $(seq 1 60); do
  if curl -fsS -m 10 "${PUBLIC_URL}/api/health/live" >/dev/null 2>&1; then
    echo "HTTPS live OK"
    break
  fi
  echo "try $i: not ready yet (cert/SG)"
  sleep 5
done

curl -sS -I -m 15 "http://medflow-13-50-17-61.sslip.io" | head -15
curl -sS -I -m 15 "${PUBLIC_URL}" | head -20
curl -sS -m 15 "${PUBLIC_URL}/api/health/live"; echo
curl -sS -m 15 "${PUBLIC_URL}/api/health/ready"; echo

python3 - <<PY
from pathlib import Path
p = Path("/opt/asseflow/app/.env")
wanted = {
  "FORCE_SECURE_COOKIES": "1",
  "APP_URL": "https://medflow-13-50-17-61.sslip.io",
  "NEXT_PUBLIC_APP_URL": "https://medflow-13-50-17-61.sslip.io",
}
lines = []
seen = set()
for line in p.read_text().splitlines(True):
  if "=" not in line or line.lstrip().startswith("#"):
    lines.append(line)
    continue
  key = line.split("=", 1)[0].strip()
  if key in wanted:
    lines.append(f"{key}={wanted[key]}\n")
    seen.add(key)
  else:
    lines.append(line)
for key, val in wanted.items():
  if key not in seen:
    lines.append(f"{key}={val}\n")
p.write_text("".join(lines))
print("Updated:", ", ".join(sorted(wanted)))
PY

docker compose -f docker-compose.staging.yml --env-file .env up -d --force-recreate --no-deps web worker
sleep 8
curl -sS http://127.0.0.1:3000/api/health/live; echo
curl -sS http://127.0.0.1:3000/api/health/ready; echo
echo "Done. Verify Secure cookie via login Set-Cookie header on HTTPS."
