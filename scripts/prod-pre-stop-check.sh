#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://tblt-agent.net}"
CONFIRM_PRE_STOP="${CONFIRM_PRE_STOP:-0}"

ask_confirmed() {
  local prompt="$1"
  local answer

  printf '%s [y/N] ' "$prompt"
  read -r answer
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

printf 'Production pre-stop checklist\n'
printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
printf '\n'

if curl -fsS --max-time 10 "$PUBLIC_URL/api/health" >/dev/null; then
  printf '[PASS] public health endpoint responds\n'
else
  printf '[WARN] public health endpoint did not respond; investigate before stopping if this is unexpected\n' >&2
fi

cat <<'CHECKLIST'

Before stopping EC2, verify outside this script:

1. No class or experiment is currently in progress.
2. LiveKit Cloud shows no active class rooms/participants.
3. Recording/egress jobs are complete.
4. No admin setup, QA, export, or debugging work is in progress.
5. The next scheduled class has enough time for EC2 to start again.

CHECKLIST

if [[ "$CONFIRM_PRE_STOP" == "1" ]]; then
  printf 'CONFIRM_PRE_STOP=1 set; manual prompts skipped.\n'
  exit 0
fi

if [[ ! -t 0 ]]; then
  printf 'Interactive confirmation is required. Re-run in a terminal, or set CONFIRM_PRE_STOP=1 after checking manually.\n' >&2
  exit 2
fi

ask_confirmed "Have all class/experiment sessions ended?" || exit 1
ask_confirmed "Are LiveKit rooms empty and recordings/egress complete?" || exit 1
ask_confirmed "Is there no admin, QA, export, or debugging work in progress?" || exit 1

printf '\nPre-stop checklist confirmed. It is OK to stop EC2.\n'
