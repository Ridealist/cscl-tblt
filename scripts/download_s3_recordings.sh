#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
OUTPUT_DIR="${1:-$ROOT_DIR/downloads/recordings}"
S3_PREFIX="${S3_PREFIX:-recordings}"

usage() {
  cat <<'EOF'
Usage: scripts/download_s3_recordings.sh [output_dir]

Downloads all recording files from the configured S3 bucket/prefix into a local directory.

Environment:
  ENV_FILE   Path to an env file to source before download (default: ./.env)
  S3_BUCKET  S3 bucket name
  S3_REGION  S3 region
  S3_PREFIX  Prefix inside the bucket to sync (default: recordings)
  SINCE_YYYYMMDD  Download only files whose names contain a date on/after this value
  AWS_ACCESS_KEY / AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  S3_ENDPOINT  Optional custom endpoint for S3-compatible storage

Examples:
  scripts/download_s3_recordings.sh
  scripts/download_s3_recordings.sh /tmp/recordings
  SINCE_YYYYMMDD=20260701 scripts/download_s3_recordings.sh
  ENV_FILE=/opt/cscl-tblt/.env scripts/download_s3_recordings.sh
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

validate_since_filter() {
  if [[ -z "${SINCE_YYYYMMDD:-}" ]]; then
    return
  fi

  if [[ ! "$SINCE_YYYYMMDD" =~ ^[0-9]{8}$ ]]; then
    echo "SINCE_YYYYMMDD must be in YYYYMMDD format" >&2
    exit 1
  fi
}

download_all() {
  local s3_uri="$1"
  local output_dir="$2"
  local -a cmd=(aws s3 sync "$s3_uri" "$output_dir")

  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    cmd+=(--endpoint-url "$S3_ENDPOINT")
  fi

  echo "Downloading recordings from $s3_uri to $output_dir"
  "${cmd[@]}"
}

download_filtered() {
  local bucket="$1"
  local prefix="$2"
  local output_dir="$3"
  local cutoff="$4"

  local -a list_cmd=(aws s3 ls "s3://$bucket/$prefix/" --recursive)
  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    list_cmd+=(--endpoint-url "$S3_ENDPOINT")
  fi

  echo "Downloading recordings from s3://$bucket/$prefix/ to $output_dir (since $cutoff)"

  "${list_cmd[@]}" | while read -r date time size key; do
    [[ -n "${key:-}" ]] || continue

    if [[ "$key" =~ -([0-9]{8})_[0-9]{6}\.mp3$ ]]; then
      if [[ "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
        continue
      fi
    else
      continue
    fi

    mkdir -p "$output_dir/$(dirname "$key")"

    local -a cp_cmd=(aws s3 cp "s3://$bucket/$key" "$output_dir/$key")
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
      cp_cmd+=(--endpoint-url "$S3_ENDPOINT")
    fi

    "${cp_cmd[@]}"
  done
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
  validate_since_filter

  mkdir -p "$OUTPUT_DIR"

  local s3_uri="s3://$S3_BUCKET/$S3_PREFIX"
  if [[ -n "${SINCE_YYYYMMDD:-}" ]]; then
    download_filtered "$S3_BUCKET" "$S3_PREFIX" "$OUTPUT_DIR" "$SINCE_YYYYMMDD"
    return
  fi

  download_all "$s3_uri" "$OUTPUT_DIR"
}

main "$@"
