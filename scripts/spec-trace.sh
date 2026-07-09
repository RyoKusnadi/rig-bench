#!/usr/bin/env bash
# spec-trace.sh — read-only query view over verification traces: the raw execution
# record spec-verify captures per attempt (the commands it ran and their full output,
# plus per-criterion PASS/FAIL evidence). Traces live at
# specs/<project>/.traces/<id>/attempt-<n>.md and are the raw complement to a spec's
# compressed `## Verification Failures` summary — the signal that summary drops. The
# fix loop (spec-exec) reads them; a human can grep them.
#
# Usage:
#   scripts/spec-trace.sh <project>                  # list specs that have traces (attempts, latest)
#   scripts/spec-trace.sh <project> <id>             # show the latest attempt's trace for <id>
#   scripts/spec-trace.sh <project> <id> <n>         # show attempt <n> for <id>
#   scripts/spec-trace.sh diff <project> <id> [a b]  # diff two attempts (default: last two)
#   scripts/spec-trace.sh                            # single-project shorthand (list)
#
# The diff mode exists for the second failure: when a spec fails verification again after a
# fix, diffing the two attempts' traces shows exactly what the fix changed in the observed
# behavior — which criteria flipped, which command output moved — before deciding what to
# try next (Meta-Harness, Appendix D: the log CLI should "diff code and results between
# pairs of runs").
#
# Dependency-free bash per memory/decisions.md — grep is the query engine by design.
# Introduced in PR #102 (trace capture; diff subcommand added in the same PR).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

usage() {
  echo "Usage: scripts/spec-trace.sh [project] [id] [attempt]" >&2
  echo "       scripts/spec-trace.sh diff <project> <id> [attempt_a attempt_b]" >&2
}

# ── Resolve project (mirrors spec-status.sh's single-project shorthand) ───────
resolve_project() {
  local given="${1:-}"
  if [[ -n "$given" ]]; then
    printf '%s\n' "$given"
    return
  fi
  local projects=()
  while IFS= read -r -d '' d; do
    projects+=("$(basename "$d")")
  done < <(find specs -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)
  if [[ ${#projects[@]} -ne 1 ]]; then
    echo "Error: no project given, and specs/ does not have exactly one project folder (found: ${projects[*]:-none})." >&2
    usage
    exit 1
  fi
  printf '%s\n' "${projects[0]}"
}

# Highest attempt number present under a spec's trace dir, or empty if none.
latest_attempt() {
  local trace_dir="$1"
  local max=""
  local f n
  for f in "$trace_dir"/attempt-*.md; do
    [[ -e "$f" ]] || continue
    n="$(basename "$f")"; n="${n#attempt-}"; n="${n%.md}"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    if [[ -z "$max" || "$n" -gt "$max" ]]; then
      max="$n"
    fi
  done
  printf '%s\n' "$max"
}

# ── Diff mode: compare two attempts of one spec (default: the last two) ───────
if [[ $# -ge 1 && "$1" == "diff" ]]; then
  shift
  if [[ $# -lt 2 || $# -gt 4 || $# -eq 3 ]]; then
    usage
    exit 1
  fi
  PROJECT="$(resolve_project "$1")"
  ID="$2"
  A="${3:-}"
  B="${4:-}"
  TRACE_DIR="specs/${PROJECT}/.traces/${ID}"
  if [[ ! -d "$TRACE_DIR" ]]; then
    echo "Error: no verification trace for spec ${ID} in '${PROJECT}'." >&2
    exit 1
  fi
  if [[ -z "$A" ]]; then
    B="$(latest_attempt "$TRACE_DIR")"
    if [[ -z "$B" || "$B" -lt 2 ]]; then
      echo "Error: spec ${ID} has fewer than two attempts — nothing to diff." >&2
      exit 1
    fi
    # default: previous attempt vs latest — the "what did the fix change" question
    A=$((B - 1))
    while [[ "$A" -ge 1 && ! -f "$TRACE_DIR/attempt-${A}.md" ]]; do A=$((A - 1)); done
    if [[ "$A" -lt 1 ]]; then
      echo "Error: spec ${ID} has only one attempt on disk — nothing to diff." >&2
      exit 1
    fi
  fi
  FA="$TRACE_DIR/attempt-${A}.md"
  FB="$TRACE_DIR/attempt-${B}.md"
  for f in "$FA" "$FB"; do
    if [[ ! -f "$f" ]]; then
      echo "Error: $(basename "$f") does not exist for spec ${ID} in '${PROJECT}'." >&2
      exit 1
    fi
  done
  echo "Trace diff — spec ${ID}: attempt-${A} vs attempt-${B}"
  # diff exits 1 when files differ; that's the expected, successful case here.
  diff -u "$FA" "$FB" || true
  exit 0
fi

if [[ $# -gt 3 ]]; then
  usage
  exit 1
fi

# First arg may be a project, or (in single-project repos) an id. We only treat it
# as an id-first call when it's numeric AND a project can be resolved with no name.
PROJECT=""
ID=""
ATTEMPT=""

if [[ $# -eq 0 ]]; then
  PROJECT="$(resolve_project "")"
elif [[ $# -eq 1 ]]; then
  PROJECT="$(resolve_project "$1")"
elif [[ $# -eq 2 ]]; then
  PROJECT="$(resolve_project "$1")"
  ID="$2"
else
  PROJECT="$(resolve_project "$1")"
  ID="$2"
  ATTEMPT="$3"
fi

PROJECT_DIR="specs/${PROJECT}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: ${PROJECT_DIR} does not exist." >&2
  exit 1
fi

TRACES_DIR="${PROJECT_DIR}/.traces"

# ── List mode: no id given ───────────────────────────────────────────────────
if [[ -z "$ID" ]]; then
  if [[ ! -d "$TRACES_DIR" ]]; then
    echo "No verification traces recorded for '${PROJECT}'."
    exit 0
  fi
  found=0
  echo "Verification traces — ${PROJECT}"
  while IFS= read -r -d '' d; do
    id="$(basename "$d")"
    count=0
    for f in "$d"/attempt-*.md; do
      [[ -e "$f" ]] && count=$((count + 1))
    done
    [[ "$count" -eq 0 ]] && continue
    found=1
    latest="$(latest_attempt "$d")"
    printf '  %s — %d attempt(s), latest: attempt-%s\n' "$id" "$count" "$latest"
  done < <(find "$TRACES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | sort -z)
  if [[ "$found" -eq 0 ]]; then
    echo "  (none)"
  fi
  exit 0
fi

# ── Show mode: id given ──────────────────────────────────────────────────────
SPEC_TRACE_DIR="${TRACES_DIR}/${ID}"
if [[ ! -d "$SPEC_TRACE_DIR" ]]; then
  echo "Error: no verification trace for spec ${ID} in '${PROJECT}'." >&2
  echo "  (run 'scripts/spec-trace.sh ${PROJECT}' to list specs that have traces)" >&2
  exit 1
fi

if [[ -z "$ATTEMPT" ]]; then
  ATTEMPT="$(latest_attempt "$SPEC_TRACE_DIR")"
  if [[ -z "$ATTEMPT" ]]; then
    echo "Error: spec ${ID} has a trace directory but no attempt files." >&2
    exit 1
  fi
fi

TRACE_FILE="${SPEC_TRACE_DIR}/attempt-${ATTEMPT}.md"
if [[ ! -f "$TRACE_FILE" ]]; then
  echo "Error: no attempt-${ATTEMPT} trace for spec ${ID} in '${PROJECT}'." >&2
  echo "  available:" >&2
  for f in "$SPEC_TRACE_DIR"/attempt-*.md; do
    [[ -e "$f" ]] && echo "    $(basename "$f")" >&2
  done
  exit 1
fi

cat "$TRACE_FILE"
