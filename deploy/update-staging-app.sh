#!/usr/bin/env bash
# Safe staging app update on the EC2 host.
# Updates ONLY web + worker images/containers. Never touches db or volumes.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asseflow/app}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
BRANCH="${DEPLOY_BRANCH:-master}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"

cd "$APP_DIR"

echo "==> Fetching $BRANCH"
BEFORE="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
# History rewrite (orphan squash / force-push) cannot fast-forward.
if ! git merge-base --is-ancestor HEAD "origin/$BRANCH" 2>/dev/null; then
  echo "==> Non-fast-forward history detected; hard-resetting to origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  git pull --ff-only origin "$BRANCH"
fi
AFTER="$(git rev-parse HEAD)"

if [[ "$BEFORE" == "$AFTER" && "$FORCE_DEPLOY" != "1" ]]; then
  echo "Already at $AFTER — nothing to deploy (set FORCE_DEPLOY=1 to rebuild anyway)."
  exit 0
fi

echo "==> Updating code $BEFORE → $AFTER (force=$FORCE_DEPLOY)"
echo "==> Building web image (worker shares the same image)"
docker compose -f "$COMPOSE_FILE" --env-file .env build web

echo "==> Recreating ONLY web + worker (db + volumes untouched)"
docker compose -f "$COMPOSE_FILE" --env-file .env up -d --force-recreate --no-deps web worker

echo "==> Waiting for health"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS http://127.0.0.1:3000/api/health/live >/dev/null \
    && curl -fsS http://127.0.0.1:3000/api/health/ready >/dev/null; then
    echo "Health OK after attempt $i"
    break
  fi
  if [[ "$i" -eq 12 ]]; then
    echo "Health check failed after recreate" >&2
    docker compose -f "$COMPOSE_FILE" --env-file .env ps
    exit 1
  fi
  sleep 5
done

echo "==> Pruning dangling images (volumes preserved)"
docker image prune -f >/dev/null || true

echo "==> Deployed $(git rev-parse --short HEAD)"
curl -fsS http://127.0.0.1:3000/api/health/live
echo
curl -fsS http://127.0.0.1:3000/api/health/ready
echo
