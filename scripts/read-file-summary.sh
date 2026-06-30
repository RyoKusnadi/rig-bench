#!/usr/bin/env bash
# read-file-summary.sh — print a cached summary for a file, or the raw file
# content if no fresh cache exists. Cache freshness is determined by
# comparing the file's current Git blob hash against a stored hash.
#
# Usage: scripts/read-file-summary.sh <file-path>
#
# This script never calls an LLM. Summary generation/writing is the
# responsibility of the caller (see scripts/write-file-summary.sh).

set -euo pipefail

usage() {
  echo "Usage: $0 <file-path>" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

FILE_PATH="$1"

if [[ ! -f "$FILE_PATH" ]]; then
  echo "Error: file not found: $FILE_PATH" >&2
  exit 1
fi

# Compute an MD5 hash of the file path to use as the cache key.
# Detect platform: GNU coreutils (md5sum) vs BSD/macOS (md5).
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

CURRENT_HASH="$(git hash-object "$FILE_PATH")"

if [[ -f "$HASH_FILE" && -f "$SUMMARY_FILE" ]]; then
  CACHED_HASH="$(cat "$HASH_FILE")"
  if [[ "$CACHED_HASH" == "$CURRENT_HASH" ]]; then
    cat "$SUMMARY_FILE"
    exit 0
  fi
fi

echo "# No cached summary — raw file content follows:"
cat "$FILE_PATH"
exit 0
