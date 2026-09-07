#!/usr/bin/env bash
# Install and enable Caddy on Amazon Linux 2023 for MedFlow HTTPS.
# Idempotent. Does not touch Docker volumes or Postgres data.
set -euo pipefail

CADDYFILE_SRC="${1:-/opt/asseflow/app/deploy/Caddyfile}"

if ! command -v caddy >/dev/null 2>&1; then
  # Official Caddy yum repo for RHEL/Fedora/Amazon Linux compatible systems
  if [ ! -f /etc/yum.repos.d/caddy.repo ]; then
    sudo tee /etc/yum.repos.d/caddy.repo >/dev/null <<'EOF'
[caddy]
name=Caddy
baseurl=https://rpm.cloudsmith.io/public/caddy/stable/el/9/\$basearch
gpgcheck=1
gpgkey=https://dl.cloudsmith.io/public/caddy/stable/gpg.key
enabled=1
EOF
  fi
  sudo dnf install -y caddy
fi

sudo mkdir -p /etc/caddy
sudo cp "$CADDYFILE_SRC" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl --no-pager --full status caddy | head -20
caddy version
