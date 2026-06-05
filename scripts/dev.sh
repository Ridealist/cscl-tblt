#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-auto}"
PIDS=()
STATUS_DIR="$(mktemp -d)"
STATUS_PIPE="$STATUS_DIR/exit"
mkfifo "$STATUS_PIPE"

usage() {
  cat <<'EOF'
Usage: pnpm dev[:mode]

Modes:
  pnpm dev                    Read config.json and run the matching agent with Next.js client
  pnpm dev:pipeline           Run pipeline-agent and Next.js client
  pnpm dev:realtime           Run realtime dominant agent and Next.js client
  pnpm dev:realtime:collaborative
                              Run realtime collaborative agent and Next.js client
  pnpm dev:all                Run pipeline, realtime dominant, realtime collaborative, and Next.js client

First setup:
  pnpm setup
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 127
  fi
}

resolve_auto_mode() {
  python3 - "$ROOT_DIR/config.json" <<'PY'
import json
import sys

config_path = sys.argv[1]

try:
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
except (OSError, json.JSONDecodeError):
    print("pipeline")
    raise SystemExit(0)

mode = config.get("agentMode")
role = config.get("agentRole", config.get("agentStance"))

if mode == "realtime":
    print("realtime-collaborative" if role in ("collaborative", "passive") else "realtime")
else:
    print("pipeline")
PY
}

cleanup() {
  local status=$?
  trap - INT TERM EXIT

  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    echo
    echo "Stopping local dev processes..."
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi

  rm -rf "$STATUS_DIR"
  exit "$status"
}

start_process() {
  local name="$1"
  shift

  echo "Starting $name..."
  (
    set +e
    local_child=0
    trap 'if [[ "$local_child" -ne 0 ]]; then kill "$local_child" 2>/dev/null || true; wait "$local_child" 2>/dev/null || true; fi; exit 143' INT TERM

    "$@" &
    local_child=$!
    wait "$local_child"
    local_status=$?

    printf '%s\t%s\n' "$name" "$local_status" > "$STATUS_PIPE"
    exit "$local_status"
  ) &

  PIDS+=("$!")
}

start_client() {
  start_process "next-client" bash -c 'cd "$1" && exec pnpm dev' _ "$ROOT_DIR/client"
}

start_pipeline_agent() {
  start_process "pipeline-agent" bash -c 'cd "$1" && exec env AGENT_WORKER_MODE=pipeline uv run python main.py dev' _ "$ROOT_DIR/agent"
}

start_realtime_agent() {
  local role="$1"
  start_process "realtime-${role}-agent" bash -c 'cd "$1" && exec env AGENT_WORKER_MODE=realtime AGENT_ROLE="$2" uv run python main.py dev' _ "$ROOT_DIR/agent" "$role"
}

trap cleanup INT TERM EXIT

if [[ "$MODE" == "-h" || "$MODE" == "--help" || "$MODE" == "help" ]]; then
  usage
  exit 0
fi

if [[ "$MODE" == "auto" ]]; then
  require_command python3
  MODE="$(resolve_auto_mode)"
  echo "Resolved dev mode from config.json: $MODE"
fi

require_command python3
python3 "$ROOT_DIR/scripts/check_realtime_prompts.py"

case "$MODE" in
  pipeline)
    require_command pnpm
    require_command uv
    start_pipeline_agent
    start_client
    ;;
  realtime|realtime-dominant)
    require_command pnpm
    require_command uv
    start_realtime_agent dominant
    start_client
    ;;
  realtime-collaborative|realtime-passive)
    require_command pnpm
    require_command uv
    start_realtime_agent collaborative
    start_client
    ;;
  all)
    require_command pnpm
    require_command uv
    start_pipeline_agent
    start_realtime_agent dominant
    start_realtime_agent collaborative
    start_client
    ;;
  *)
    echo "Unknown dev mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac

echo
echo "Local app is starting. Open http://localhost:3000"
echo "Press Ctrl+C to stop all processes."
echo

set +e
{ IFS=$'\t' read -r exited_name exited_status < "$STATUS_PIPE"; } 2>/dev/null
read_status=$?
set -e

if [[ "$read_status" -ne 0 ]]; then
  exit 130
fi

echo "$exited_name exited with status $exited_status."
exit "$exited_status"
