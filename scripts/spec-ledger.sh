#!/usr/bin/env bash
# spec-ledger.sh — append-only, structured record of terminal spec outcomes (finished or
# blocked), one JSON line per spec, so a future planning or verification pass can see what's
# already shipped or already failed without re-reading every spec file. This is the same
# problem `evolution_summary.jsonl` solves in Meta-Harness's benchmarked setting — "what's
# been tried, what happened" — adapted to a harness with pass/fail verification instead of a
# numeric score.
#
# Usage:
#   scripts/spec-ledger.sh append <project> <id> <title> <outcome> <verify_attempts>
#   scripts/spec-ledger.sh list [project] [outcome]
#
#   <outcome> is "finished" or "blocked".
#   `list` with no args prints every record; a project and/or outcome narrows it.
#
# Dependency-free bash per memory/decisions.md. No jq (not assumed present) — JSON lines are
# built and read with plain string handling, one flat object per line, so `grep`/`cut` work
# directly on the file too.
#
# Spec: specs/template/*/0025-spec-outcome-ledger.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LEDGER_FILE="memory/spec-ledger.jsonl"

usage() {
  cat >&2 << 'EOF'
Usage:
  scripts/spec-ledger.sh append <project> <id> <title> <outcome> <verify_attempts>
  scripts/spec-ledger.sh list [project] [outcome]
EOF
}

# Minimal JSON string escaping: backslash, then double-quote. No control-character handling
# beyond that — spec titles are plain single-line text by convention (spec-template.md).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

CMD="$1"
shift

case "$CMD" in
  append)
    if [[ $# -ne 5 ]]; then
      usage
      exit 1
    fi
    project="$1"; id="$2"; title="$3"; outcome="$4"; attempts="$5"

    if [[ "$outcome" != "finished" && "$outcome" != "blocked" ]]; then
      echo "Error: outcome must be 'finished' or 'blocked' (got '${outcome}')." >&2
      exit 1
    fi
    if ! [[ "$attempts" =~ ^[0-9]+$ ]]; then
      echo "Error: verify_attempts must be a non-negative integer (got '${attempts}')." >&2
      exit 1
    fi

    mkdir -p "$(dirname "$LEDGER_FILE")"
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"project":"%s","id":"%s","title":"%s","outcome":"%s","verify_attempts":%s,"timestamp":"%s"}\n' \
      "$(json_escape "$project")" "$(json_escape "$id")" "$(json_escape "$title")" \
      "$outcome" "$attempts" "$ts" >> "$LEDGER_FILE"
    echo "Recorded: ${project}/${id} — ${outcome} (attempt ${attempts})"
    ;;

  list)
    if [[ $# -gt 2 ]]; then
      usage
      exit 1
    fi
    filter_project="${1:-}"
    filter_outcome="${2:-}"

    if [[ ! -f "$LEDGER_FILE" ]]; then
      echo "No spec outcomes recorded yet."
      exit 0
    fi

    found=0
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      # Cheap field extraction — flat, single-line JSON objects only (this file's own format).
      line_project="$(printf '%s' "$line" | sed -n 's/.*"project":"\([^"]*\)".*/\1/p')"
      line_outcome="$(printf '%s' "$line" | sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p')"

      if [[ -n "$filter_project" && "$line_project" != "$filter_project" ]]; then
        continue
      fi
      if [[ -n "$filter_outcome" && "$line_outcome" != "$filter_outcome" ]]; then
        continue
      fi
      found=1
      echo "$line"
    done < "$LEDGER_FILE"

    if [[ "$found" -eq 0 ]]; then
      echo "No matching spec outcomes recorded."
    fi
    ;;

  *)
    usage
    exit 1
    ;;
esac
