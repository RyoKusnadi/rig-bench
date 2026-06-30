#!/usr/bin/env bash
# write-file-summary.sh — save a summary + Git blob hash for a file to the
# summary cache, so future reads via read-file-summary.sh return the
# cached summary until the file content changes.
#
# Usage:
#   scripts/write-file-summary.sh <file-path> "<summary text>"
#   echo "<summary text>" | scripts/write-file-summary.sh <file-path>
#
# Summary text is taken from $2 if provided, otherwise read from stdin.

set -euo pipefail

usage() {
  echo "Usage: $0 <file-path> [summary-text]" >&2
  echo "       echo '<summary>' | $0 <file-path>" >&2
  exit 1
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
fi

FILE_PATH="$1"

if [[ ! -f "$FILE_PATH" ]]; then
  echo "Error: file not found: $FILE_PATH" >&2
  exit 1
fi

if [[ $# -eq 2 ]]; then
  SUMMARY_TEXT="$2"
else
  SUMMARY_TEXT="$(cat -)"
fi

if [[ -z "$SUMMARY_TEXT" ]]; then
  echo "Error: summary text is empty" >&2
  exit 1
fi

cache_key_for_path() {
  local path="$1"
  if command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$path" | md5sum | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then
    printf '%s' "$path" | md5 -q
  else
    echo "Error: no md5 utility found (need md5sum or md5)" >&2
    exit 1
  fi
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SUMMARY_DIR="${REPO_ROOT}/memory/archive/summaries"
CACHE_KEY="$(cache_key_for_path "$FILE_PATH")"
SUMMARY_FILE="${SUMMARY_DIR}/${CACHE_KEY}.md"
HASH_FILE="${SUMMARY_DIR}/${CACHE_KEY}.hash"

mkdir -p "$SUMMARY_DIR"

CURRENT_HASH="$(git hash-object "$FILE_PATH")"

printf '%s\n' "$SUMMARY_TEXT" > "$SUMMARY_FILE"
printf '%s' "$CURRENT_HASH" > "$HASH_FILE"

echo "Saved summary for $FILE_PATH -> $SUMMARY_FILE (hash: $CURRENT_HASH)"
exit 0
