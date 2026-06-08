#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://tblt-agent.net}"
LOCAL_URL="${LOCAL_URL:-http://localhost:3000}"
CLIENT_PROCESS_NAME="${CLIENT_PROCESS_NAME:-cscl-client}"
AGENT_SERVICE_NAMES="${AGENT_SERVICE_NAMES:-cscl-agent-pipeline,cscl-agent-realtime}"

status=0

pass() {
  printf '[PASS] %s\n' "$*"
}

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  status=1
}

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing command: $1"
  fi
}

check_url() {
  local label="$1"
  local url="$2"

  if curl -fsS --max-time 10 "$url" >/dev/null; then
    pass "$label responds: $url"
  else
    fail "$label does not respond: $url"
  fi
}

check_pm2() {
  local description

  if ! command -v pm2 >/dev/null 2>&1; then
    fail "pm2 is not installed or not in PATH"
    return
  fi

  if description="$(pm2 describe "$CLIENT_PROCESS_NAME" 2>/dev/null)" &&
    printf '%s\n' "$description" | grep -Eiq 'status.*online'; then
    pass "PM2 process online: $CLIENT_PROCESS_NAME"
  else
    fail "PM2 process missing or not online: $CLIENT_PROCESS_NAME"
  fi
}

check_systemd_service() {
  local service="$1"

  if systemctl is-active --quiet "$service"; then
    pass "systemd service active: $service"
  else
    fail "systemd service not active: $service"
  fi
}

printf 'Production health check\n'
printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
printf 'LOCAL_URL=%s\n' "$LOCAL_URL"
printf '\n'

check_command curl
check_command systemctl
check_pm2

check_url "local client health" "$LOCAL_URL/api/health"
check_url "public site" "$PUBLIC_URL"
check_url "admin page" "$PUBLIC_URL/admin"

IFS=',' read -r -a services <<< "$AGENT_SERVICE_NAMES"
for service in "${services[@]}"; do
  check_systemd_service "$service"
done

printf '\n'
if [[ "$status" -eq 0 ]]; then
  printf 'Production health check passed.\n'
else
  printf 'Production health check failed.\n' >&2
fi

exit "$status"
