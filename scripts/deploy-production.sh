#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/cscl-tblt}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
BRANCH_NAME="${BRANCH_NAME:-main}"
CLIENT_PROCESS_NAME="${CLIENT_PROCESS_NAME:-cscl-client}"
AGENT_SERVICES=(
  "${PIPELINE_AGENT_SERVICE:-cscl-agent-pipeline}"
  "${REALTIME_AGENT_SERVICE:-cscl-agent-realtime}"
)
STATE_FILES=(
  ".env"
  "client/.env.local"
  "config.json"
  "prompt_config.json"
)

log() {
  printf '[deploy] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 127
  fi
}

backup_state() {
  BACKUP_DIR="$(mktemp -d)"
  export BACKUP_DIR

  for file in "${STATE_FILES[@]}"; do
    if [[ -f "$APP_DIR/$file" ]]; then
      mkdir -p "$BACKUP_DIR/$(dirname "$file")"
      cp -a "$APP_DIR/$file" "$BACKUP_DIR/$file"
    fi
  done
}

restore_state() {
  for file in "${STATE_FILES[@]}"; do
    if [[ -f "$BACKUP_DIR/$file" ]]; then
      mkdir -p "$APP_DIR/$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$APP_DIR/$file"
    fi
  done

  if [[ ! -f "$APP_DIR/config.json" && -f "$APP_DIR/config.example.json" ]]; then
    cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
  fi

  mkdir -p "$APP_DIR/logs"
}

cleanup() {
  if [[ -n "${BACKUP_DIR:-}" && -d "$BACKUP_DIR" ]]; then
    rm -rf "$BACKUP_DIR"
  fi
}

trap cleanup EXIT

require_command git
require_command python3
require_command pnpm
require_command uv
require_command pm2
require_command curl

if [[ ! -d "$APP_DIR/.git" ]]; then
  printf 'Application directory is not a git checkout: %s\n' "$APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

log "Backing up runtime state files"
backup_state

log "Fetching $REMOTE_NAME/$BRANCH_NAME"
git fetch --prune "$REMOTE_NAME" "$BRANCH_NAME"

log "Checking out $DEPLOY_REF"
git checkout "$BRANCH_NAME"
git reset --hard "$DEPLOY_REF"

log "Restoring runtime state files"
restore_state

log "Checking realtime prompt sources"
python3 scripts/check_realtime_prompts.py

log "Installing client dependencies"
pnpm --dir client install --frozen-lockfile

log "Building client"
pnpm --dir client build

log "Syncing agent dependencies"
(
  cd agent
  uv sync --frozen
  uv run python main.py download-files
)

log "Restarting agent services"
for service in "${AGENT_SERVICES[@]}"; do
  sudo -n systemctl restart "$service"
  sudo -n systemctl is-active --quiet "$service"
done

log "Restarting client process"
if pm2 describe "$CLIENT_PROCESS_NAME" >/dev/null 2>&1; then
  pm2 restart "$CLIENT_PROCESS_NAME" --update-env
else
  pm2 start "pnpm start" --name "$CLIENT_PROCESS_NAME" --cwd "$APP_DIR/client"
fi
pm2 save

log "Checking client health"
for attempt in {1..30}; do
  if curl -fsS http://localhost:3000/api/health >/dev/null; then
    break
  fi

  if [[ "$attempt" -eq 30 ]]; then
    printf 'Client health check failed after %s attempts\n' "$attempt" >&2
    exit 1
  fi

  sleep 2
done

log "Deployment completed"
