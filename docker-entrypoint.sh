#!/bin/sh
set -e
# Named volumes mount as root; ensure the non-root app user can write uploads.
if [ -d /app/data/uploads ] && [ "$(id -u)" = "0" ]; then
  chown -R app:app /app/data/uploads || true
  chmod -R u+rwX /app/data/uploads || true
fi
run_as_app() {
  if [ "$(id -u)" = "0" ]; then
    exec su-exec app "$@"
  fi
  exec "$@"
}
if [ "${ROLE:-web}" = "worker" ]; then
  run_as_app npx tsx src/worker.ts
fi
run_as_app node server.js
