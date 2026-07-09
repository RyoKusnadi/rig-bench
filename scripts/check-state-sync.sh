#!/usr/bin/env bash
# check-state-sync.sh — enforce that the spec-lifecycle state facts agree across
# their two documented sources:
#
#   1. workflows/state.yaml           (machine-readable mirror — states + retry constant)
#   2. specs/README.md                (canonical prose: State Transitions table + MAX_VERIFY_ATTEMPTS)
#
# This closes the "Known gap" previously documented in specs/README.md's State
# Transitions section: the two were hand-maintained with nothing enforcing sync.
#
# Deliberately dependency-free (bash/awk/grep/sed only) — the whole reason a
# separately-maintained copy existed was to avoid a YAML-parser dependency, so
# the enforcement must not reintroduce one. state.yaml is parsed line-oriented,
# which is safe for its current flat structure.
#
# Exit codes: 0 = in sync, 1 = drift found. Runs via `make check`, which CI
# executes on every PR (.github/workflows/checks.yml).
#
# Spec: specs/template/*/0001-state-sync-check.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STATE_YAML="workflows/state.yaml"
README="specs/README.md"

if [[ ! -f "$STATE_YAML" ]]; then
  echo "Error: $STATE_YAML is missing — it is the machine-readable source of the state table." >&2
  exit 1
fi
if [[ ! -f "$README" ]]; then
  echo "Error: $README is missing." >&2
  exit 1
fi

# ── Parse state.yaml ─────────────────────────────────────────────────────────
# States are "  - name: <word>" lines; the retry constant is "max_verify_attempts: <n>".
YAML_STATES="$(awk '/^[[:space:]]*-[[:space:]]*name:/ { print $NF }' "$STATE_YAML" | sort)"
YAML_MAX="$(awk '/^[[:space:]]*max_verify_attempts:/ { print $NF; exit }' "$STATE_YAML")"

if [[ -z "$YAML_STATES" ]]; then
  echo "Error: no states parsed from $STATE_YAML — file present but yields no '- name:' entries." >&2
  exit 1
fi

# ── Parse specs/README.md ────────────────────────────────────────────────────
# State rows in the State Transitions table all look like: | `state` | `folder/` | ...
README_STATES="$(grep -E '^\|[[:space:]]*`[a-z_]+`[[:space:]]*\|' "$README" \
  | sed -E 's/^\|[[:space:]]*`([a-z_]+)`.*/\1/' | sort -u)"
README_MAX="$(grep -Eo 'MAX_VERIFY_ATTEMPTS = [0-9]+' "$README" | head -1 | grep -Eo '[0-9]+' || true)"

ISSUES=0

# ── Compare state sets ───────────────────────────────────────────────────────
MISSING_IN_README="$(comm -23 <(printf '%s\n' "$YAML_STATES") <(printf '%s\n' "$README_STATES"))"
MISSING_IN_YAML="$(comm -13 <(printf '%s\n' "$YAML_STATES") <(printf '%s\n' "$README_STATES"))"

if [[ -n "$MISSING_IN_README" ]]; then
  while IFS= read -r s; do
    echo "ISSUE [state-drift]: state '$s' is in $STATE_YAML but has no row in $README's State Transitions table."
    ISSUES=$((ISSUES + 1))
  done <<< "$MISSING_IN_README"
fi
if [[ -n "$MISSING_IN_YAML" ]]; then
  while IFS= read -r s; do
    echo "ISSUE [state-drift]: state '$s' has a row in $README's State Transitions table but is not in $STATE_YAML."
    ISSUES=$((ISSUES + 1))
  done <<< "$MISSING_IN_YAML"
fi

# ── Compare retry constant ───────────────────────────────────────────────────
if [[ -z "$YAML_MAX" ]]; then
  echo "ISSUE [retry-drift]: $STATE_YAML has no max_verify_attempts value."
  ISSUES=$((ISSUES + 1))
elif [[ -z "$README_MAX" ]]; then
  echo "ISSUE [retry-drift]: $README does not state 'MAX_VERIFY_ATTEMPTS = <n>' anywhere."
  ISSUES=$((ISSUES + 1))
elif [[ "$YAML_MAX" != "$README_MAX" ]]; then
  echo "ISSUE [retry-drift]: max_verify_attempts is $YAML_MAX in $STATE_YAML but MAX_VERIFY_ATTEMPTS = $README_MAX in $README."
  ISSUES=$((ISSUES + 1))
fi

# ── Compare dispatch constant ────────────────────────────────────
YAML_DISPATCH="$(awk '/^[[:space:]]*max_concurrent:/ { print $NF; exit }' "$STATE_YAML")"
README_DISPATCH="$(grep -Eo 'MAX_CONCURRENT_DISPATCH = [0-9]+' "$README" | head -1 | grep -Eo '[0-9]+' || true)"
if [[ -z "$YAML_DISPATCH" ]]; then
  echo "ISSUE [dispatch-drift]: $STATE_YAML has no dispatch.max_concurrent value."
  ISSUES=$((ISSUES + 1))
elif [[ -z "$README_DISPATCH" ]]; then
  echo "ISSUE [dispatch-drift]: $README does not state 'MAX_CONCURRENT_DISPATCH = <n>' anywhere."
  ISSUES=$((ISSUES + 1))
elif [[ "$YAML_DISPATCH" != "$README_DISPATCH" ]]; then
  echo "ISSUE [dispatch-drift]: max_concurrent is $YAML_DISPATCH in $STATE_YAML but MAX_CONCURRENT_DISPATCH = $README_DISPATCH in $README."
  ISSUES=$((ISSUES + 1))
fi

echo ""
if [[ "$ISSUES" -eq 0 ]]; then
  echo "State facts in sync across $STATE_YAML and $README."
  exit 0
else
  echo "$ISSUES sync issue(s) found."
  exit 1
fi
