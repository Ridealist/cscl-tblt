#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
S3_PREFIX="${S3_PREFIX:-recordings}"
BEFORE_YYYYMMDD="${BEFORE_YYYYMMDD:-}"
APPLY="${APPLY:-false}"

usage() {
  cat <<'EOF'
Usage: scripts/delete_s3_recordings.sh

Lists or deletes recording files from the configured S3 bucket/prefix based on
the date embedded in the file name: recordings/{room}--YYYYMMDD_HHMMSS.mp3

Environment:
  ENV_FILE   Path to an env file to source before delete (default: ./.env)
  S3_BUCKET  S3 bucket name
  S3_REGION  S3 region
  S3_PREFIX  Prefix inside the bucket to inspect (default: recordings)
  BEFORE_YYYYMMDD  Match files whose names contain a date before this value
  BEFORE_LAST_MODIFIED  Match files whose S3 LastModified is before this UTC timestamp
  APPLY      Set to true to actually delete files; default is dry run
  AWS_ACCESS_KEY / AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  S3_ENDPOINT  Optional custom endpoint for S3-compatible storage

Examples:
  BEFORE_YYYYMMDD=20260601 scripts/delete_s3_recordings.sh
  BEFORE_LAST_MODIFIED=2026-06-01T00:00:00Z scripts/delete_s3_recordings.sh
  BEFORE_YYYYMMDD=20260601 APPLY=true scripts/delete_s3_recordings.sh
  ENV_FILE=/opt/cscl-tblt/.env BEFORE_YYYYMMDD=20260701 scripts/delete_s3_recordings.sh
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 127
  fi
}

load_env_file() {
  local env_path="$1"
  if [[ -f "$env_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_path"
    set +a
  fi
}

normalize_aws_env() {
  if [[ -n "${AWS_ACCESS_KEY:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
    export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY"
  fi

  if [[ -n "${S3_REGION:-}" ]]; then
    export AWS_DEFAULT_REGION="$S3_REGION"
  fi
}

validate_env() {
  local missing=()

  [[ -n "${S3_BUCKET:-}" ]] || missing+=("S3_BUCKET")
  [[ -n "${S3_REGION:-}" ]] || missing+=("S3_REGION")
  [[ -n "${AWS_ACCESS_KEY_ID:-}" ]] || missing+=("AWS_ACCESS_KEY or AWS_ACCESS_KEY_ID")
  [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || missing+=("AWS_SECRET_ACCESS_KEY")

  if [[ "${#missing[@]}" -gt 0 ]]; then
    printf 'Missing required environment values: %s\n' "${missing[*]}" >&2
    exit 1
  fi
}

validate_filters() {
  if [[ -n "${BEFORE_YYYYMMDD:-}" && -n "${BEFORE_LAST_MODIFIED:-}" ]]; then
    echo "Set only one of BEFORE_YYYYMMDD or BEFORE_LAST_MODIFIED" >&2
    exit 1
  fi

  if [[ -z "${BEFORE_YYYYMMDD:-}" && -z "${BEFORE_LAST_MODIFIED:-}" ]]; then
    echo "Set BEFORE_YYYYMMDD or BEFORE_LAST_MODIFIED" >&2
    exit 1
  fi

  if [[ -n "${BEFORE_YYYYMMDD:-}" && ! "$BEFORE_YYYYMMDD" =~ ^[0-9]{8}$ ]]; then
    echo "BEFORE_YYYYMMDD must be in YYYYMMDD format" >&2
    exit 1
  fi

  if [[ -n "${BEFORE_LAST_MODIFIED:-}" && ! "$BEFORE_LAST_MODIFIED" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    echo "BEFORE_LAST_MODIFIED must be in UTC ISO-8601 format like 2026-06-01T00:00:00Z" >&2
    exit 1
  fi

  if [[ "$APPLY" != "true" && "$APPLY" != "false" ]]; then
    echo "APPLY must be true or false" >&2
    exit 1
  fi
}

list_matching_keys_by_filename_date() {
  local bucket="$1"
  local prefix="$2"
  local cutoff="$3"

  local -a list_cmd=(aws s3 ls "s3://$bucket/$prefix/" --recursive)
  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    list_cmd+=(--endpoint-url "$S3_ENDPOINT")
  fi

  "${list_cmd[@]}" | while read -r date time size key; do
    [[ -n "${key:-}" ]] || continue

    if [[ "$key" =~ --([0-9]{8})_[0-9]{6}\.mp3$ ]] && [[ "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
      printf '%s\n' "$key"
    fi
  done
}

list_matching_keys_by_last_modified() {
  local bucket="$1"
  local prefix="$2"
  local cutoff="$3"

  local -a list_cmd=(aws s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix/" --query 'Contents[].[Key,LastModified]' --output text)
  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    list_cmd+=(--endpoint-url "$S3_ENDPOINT")
  fi

  "${list_cmd[@]}" | while IFS=$'\t' read -r key last_modified; do
    [[ -n "${key:-}" ]] || continue
    [[ -n "${last_modified:-}" ]] || continue

    if [[ "$last_modified" < "$cutoff" ]]; then
      printf '%s\n' "$key"
    fi
  done
}

delete_matching_keys() {
  local bucket="$1"
  local prefix="$2"
  local mode="$3"
  local cutoff="$4"

  local matched=0

  while read -r key; do
    [[ -n "$key" ]] || continue
    matched=1

    if [[ "$APPLY" == "true" ]]; then
      local -a rm_cmd=(aws s3 rm "s3://$bucket/$key")
      if [[ -n "${S3_ENDPOINT:-}" ]]; then
        rm_cmd+=(--endpoint-url "$S3_ENDPOINT")
      fi
      echo "Deleting s3://$bucket/$key"
      "${rm_cmd[@]}"
    else
      echo "DRY RUN s3://$bucket/$key"
    fi
  done < <(
    if [[ "$mode" == "filename_date" ]]; then
      list_matching_keys_by_filename_date "$bucket" "$prefix" "$cutoff"
    else
      list_matching_keys_by_last_modified "$bucket" "$prefix" "$cutoff"
    fi
  )

  if [[ "$matched" -eq 0 ]]; then
    echo "No matching files found under s3://$bucket/$prefix/ before $cutoff"
    return
  fi

  if [[ "$APPLY" == "true" ]]; then
    echo "Deletion completed for files before $cutoff under s3://$bucket/$prefix/"
  else
    echo "Dry run completed. Re-run with APPLY=true to delete files before $cutoff."
  fi
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_command aws
  load_env_file "$ENV_FILE"
  normalize_aws_env
  validate_env
  validate_filters

  if [[ -n "${BEFORE_LAST_MODIFIED:-}" ]]; then
    delete_matching_keys "$S3_BUCKET" "$S3_PREFIX" "last_modified" "$BEFORE_LAST_MODIFIED"
    return
  fi

  delete_matching_keys "$S3_BUCKET" "$S3_PREFIX" "filename_date" "$BEFORE_YYYYMMDD"
}

main "$@"
