#!/usr/bin/env bash
# Deploy Connect on qemu/117 (self-hosted runner). No secrets on argv.
set -euo pipefail

REPO="${REPO:-$HOME/1Password_Connect}"
CRED="${CONNECT_CREDENTIALS_FILE:-$HOME/.config/1password-connect/1password-credentials.json}"

if [[ ! -f "$CRED" ]]; then
  echo "deploy: missing credentials file (set CONNECT_CREDENTIALS_FILE)" >&2
  exit 1
fi
# Compose file secrets must be readable inside Connect containers (opuser).
chmod 644 "$CRED" 2>/dev/null || true

cd "$REPO"
git fetch origin main
git checkout -f "${GITHUB_SHA:-origin/main}"

export CONNECT_CREDENTIALS_FILE="$CRED"
export CONNECT_API_HOST_PORT="${CONNECT_API_HOST_PORT:-8080}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-opconnect-infra-qemu117}"

python3 -m pip install -q -r tests/requirements.txt 2>/dev/null || true
python3 -m unittest discover -s tests -q

python3 deploy/docker/compose_wrapper.py up -d

DEST="$HOME/.config/systemd/user"
mkdir -p "$DEST"
install -m 0644 deploy/systemd/user/onepassword-connect.service "$DEST/onepassword-connect.service"
systemctl --user daemon-reload
systemctl --user enable --now onepassword-connect.service

echo "deploy: connect stack up (project=$COMPOSE_PROJECT_NAME port=$CONNECT_API_HOST_PORT)"
