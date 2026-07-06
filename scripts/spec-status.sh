#!/usr/bin/env bash
# spec-status.sh — read-only status view over one project's spec lifecycle:
# per-state counts (states from workflows/state.yaml, lifecycle order) plus
# attention items (waiting_verification specs with failed attempts, blocked specs,
# and an advisory verification-failure-rate line over finished/ — spec 0011).
#
# Usage: scripts/spec-status.sh <project>
#        scripts/spec-status.sh          (only valid if exactly one specs/<project>/ exists)
#
# Dependency-free bash/awk per memory/decisions.md. Spec: specs/template/*/0006-spec-status.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STATE_YAML="workflows/state.yaml"
if [[ ! -f "$STATE_YAML" ]]; then
  echo "Error: $STATE_YAML is missing — it is the source of the state list." >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  PROJECT="$1"
elif [[ $# -eq 0 ]]; then
  PROJECTS=()
  while IFS= read -r -d '' d; do
    PROJECTS+=("$(basename "$d")")
  done < <(find specs -mindepth 1 -maxdepth 1 -type d -print0)
  if [[ ${#PROJECTS[@]} -ne 1 ]]; then
    echo "Error: no project given, and specs/ does not have exactly one project folder (found: ${PROJECTS[*]:-none})." >&2
    echo "Usage: scripts/spec-status.sh <project>" >&2
    exit 1
  fi
  PROJECT="${PROJECTS[0]}"
else
  echo "Usage: scripts/spec-status.sh [project]" >&2
  exit 1
fi

PROJECT_DIR="specs/${PROJECT}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: ${PROJECT_DIR} does not exist." >&2
  exit 1
fi

frontmatter() { awk '/^---$/{c++; next} c==1' "$1"; }
# First value of a frontmatter field, quotes stripped: fm_field <frontmatter> <key>.
# awk (always exit 0) rather than grep|head|sed — under `set -o pipefail`, the grep
# pipeline returns 1 when the field is absent and kills the script, which is exactly
# the common case here (waiting_verification specs without verify_attempts yet).
fm_field() {
  printf '%s\n' "$1" | awk -v key="$2" '
    !done && $0 ~ "^" key ":" {
      sub("^" key ":[ \t]*", "")
      gsub(/^["\047]|["\047]$/, "")
      print
      done = 1
    }'
}

echo "Spec status — ${PROJECT_DIR}/"
echo ""

# Per-state counts, in state.yaml (lifecycle) order.
TOTAL=0
while IFS= read -r state; do
  dir="$PROJECT_DIR/$state"
  count=0
  if [[ -d "$dir" ]]; then
    count="$(find "$dir" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
  fi
  TOTAL=$((TOTAL + count))
  printf "  %-22s %s\n" "$state" "$count"
done < <(awk '/^[[:space:]]*-[[:space:]]*name:/ { print $NF }' "$STATE_YAML")
printf "  %-22s %s\n" "total" "$TOTAL"

# Attention items.
echo ""
echo "Needs attention:"
ATTENTION=0

if [[ -d "$PROJECT_DIR/waiting_verification" ]]; then
  while IFS= read -r -d '' f; do
    fm="$(frontmatter "$f")"
    attempts="$(fm_field "$fm" verify_attempts)"
    [[ -z "$attempts" || "$attempts" == "0" ]] && continue
    id="$(fm_field "$fm" id)"
    title="$(fm_field "$fm" title)"
    echo "  - $id — $title: waiting_verification with $attempts failed attempt(s) — needs a fix pass (see its ## Verification Failures)."
    ATTENTION=$((ATTENTION + 1))
  done < <(find "$PROJECT_DIR/waiting_verification" -maxdepth 1 -name '*.md' -print0 | sort -z)
fi

if [[ -d "$PROJECT_DIR/blocked" ]]; then
  while IFS= read -r -d '' f; do
    fm="$(frontmatter "$f")"
    id="$(fm_field "$fm" id)"
    title="$(fm_field "$fm" title)"
    echo "  - $id — $title: BLOCKED — needs human review (see specs/README.md \"Un-blocking a spec\")."
    ATTENTION=$((ATTENTION + 1))
  done < <(find "$PROJECT_DIR/blocked" -maxdepth 1 -name '*.md' -print0 | sort -z)
fi

# Advisory verification-failure-rate check: the share of finished specs that failed
# verification at least once (verify_attempts > 0), compared against
# attention.verify_failure_rate_threshold_pct in workflows/state.yaml. Fail-open by
# design: a missing threshold key or an empty finished/ skips the check entirely.
THRESHOLD="$(awk '/^[[:space:]]*verify_failure_rate_threshold_pct:/ { print $NF; exit }' "$STATE_YAML")"
if [[ "$THRESHOLD" =~ ^[0-9]+$ && -d "$PROJECT_DIR/finished" ]]; then
  FINISHED_TOTAL=0
  ATTEMPTED=0
  while IFS= read -r -d '' f; do
    FINISHED_TOTAL=$((FINISHED_TOTAL + 1))
    fm="$(frontmatter "$f")"
    attempts="$(fm_field "$fm" verify_attempts)"
    [[ -z "$attempts" || "$attempts" == "0" ]] && continue
    ATTEMPTED=$((ATTEMPTED + 1))
  done < <(find "$PROJECT_DIR/finished" -maxdepth 1 -name '*.md' -print0)
  if [[ "$FINISHED_TOTAL" -gt 0 ]]; then
    RATE_PCT="$(awk -v a="$ATTEMPTED" -v t="$FINISHED_TOTAL" 'BEGIN { print int(a * 100 / t) }')"
    if [[ "$RATE_PCT" -gt "$THRESHOLD" ]]; then
      echo "  - verification failure rate: ${RATE_PCT}% of finished specs have verify_attempts > 0, above the ${THRESHOLD}% threshold (attention.verify_failure_rate_threshold_pct in ${STATE_YAML})."
      ATTENTION=$((ATTENTION + 1))
    fi
  fi
fi

if [[ "$ATTENTION" -eq 0 ]]; then
  echo "  (none)"
fi
