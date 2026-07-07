#!/usr/bin/env bash
# spec-metrics.sh — read-only lifecycle metrics over one project's specs:
# verify_attempts distribution, verification failure rate over finished specs,
# dependency stats (count + max chain depth), and best-effort cycle time for
# finished specs tracked in git (first commit to last commit on the file).
# Everything is computed on demand from the current tree and git history —
# no snapshots, no collection layer, nothing written to disk.
#
# Usage: scripts/spec-metrics.sh <project>
#        scripts/spec-metrics.sh          (only valid if exactly one specs/<project>/ exists)
#
# Dependency-free bash/awk per memory/decisions.md, bash-3.2 compatible per
# memory/gotchas.md. Spec: specs/template/*/0010-spec-metrics.md

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
    echo "Usage: scripts/spec-metrics.sh <project>" >&2
    exit 1
  fi
  PROJECT="${PROJECTS[0]}"
else
  echo "Usage: scripts/spec-metrics.sh [project]" >&2
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
# the common case here (draft specs without verify_attempts yet).
fm_field() {
  printf '%s\n' "$1" | awk -v key="$2" '
    !done && $0 ~ "^" key ":" {
      sub("^" key ":[ \t]*", "")
      gsub(/^["\047]|["\047]$/, "")
      print
      done = 1
    }'
}

# ── Frontmatter facts, one line per spec: file<TAB>id<TAB>state<TAB>attempts<TAB>deps ──
# State is the lifecycle folder the file sits in; missing verify_attempts counts as 0.
SPEC_DATA=""
TOTAL=0
while IFS= read -r -d '' f; do
  fm="$(frontmatter "$f")"
  id="$(fm_field "$fm" id)"
  state="$(basename "$(dirname "$f")")"
  attempts="$(fm_field "$fm" verify_attempts)"
  [[ -z "$attempts" ]] && attempts=0
  deps_raw="$(fm_field "$fm" depends_on)"
  deps="$(printf '%s' "$deps_raw" | sed -E 's/^\[//; s/\]$//' | tr ',' ' ' | tr -d '\042\047')"
  SPEC_DATA+="${f}	${id}	${state}	${attempts}	${deps}
"
  TOTAL=$((TOTAL + 1))
done < <(find "$PROJECT_DIR" -mindepth 2 -maxdepth 2 -name '*.md' -print0 | sort -z)

echo "Spec metrics — ${PROJECT_DIR}/"
echo ""

# ── Verify attempts distribution: count of specs per attempts value ─────────
echo "Verify attempts distribution:"
if [[ "$TOTAL" -eq 0 ]]; then
  echo "  (no specs)"
else
  printf '%s' "$SPEC_DATA" | awk -F'\t' '{ print $4 }' | sort -n | uniq -c |
    while read -r count val; do
      printf "  %-22s %s spec(s)\n" "attempts=$val" "$count"
    done
fi

# ── Verification failure rate: finished specs that needed >0 attempts ───────
echo ""
echo "Verification failure rate:"
counts="$(printf '%s' "$SPEC_DATA" | awk -F'\t' '
  $3 == "finished" { f++; if ($4 + 0 > 0) x++ }
  END { printf "%d %d", f + 0, x + 0 }')"
FINISHED="${counts%% *}"
FAILED="${counts##* }"
if [[ "$FINISHED" -eq 0 ]]; then
  echo "  0 of 0 finished spec(s) failed verification at least once (n/a)"
else
  PCT=$((FAILED * 100 / FINISHED))
  echo "  $FAILED of $FINISHED finished spec(s) failed verification at least once (${PCT}%)"
fi

# ── Dependency stats: non-empty depends_on count + max chain depth ──────────
# Depth is iterative fixed-point: depth(spec) = 1 + max depth of its depends_on,
# capped at the spec count as a guard — cycles are check-specs.sh's job, not ours.
echo ""
echo "Dependency stats:"
WITH_DEPS="$(printf '%s' "$SPEC_DATA" | awk -F'\t' '$5 ~ /[^ ]/ { n++ } END { print n + 0 }')"
MAX_DEPTH="$(printf '%s' "$SPEC_DATA" | awk -F'\t' '
  { id = $2; deps[id] = $5; ids[++n] = id; depth[id] = 1 }
  END {
    for (iter = 0; iter < n; iter++) {
      changed = 0
      for (i = 1; i <= n; i++) {
        id = ids[i]
        m = split(deps[id], arr, " ")
        best = 1
        for (j = 1; j <= m; j++) {
          d = arr[j]
          if (d == "") continue
          nd = depth[d] + 1
          if (nd > best) best = nd
        }
        if (best > depth[id]) { depth[id] = best; changed = 1 }
      }
      if (!changed) break
    }
    max = 0
    for (i = 1; i <= n; i++) if (depth[ids[i]] > max) max = depth[ids[i]]
    print max
  }')"
printf "  %-22s %s\n" "specs with depends_on" "$WITH_DEPS"
printf "  %-22s %s spec(s)\n" "max chain depth" "$MAX_DEPTH"

# ── Cycle time: history frontmatter first, git as fallback (spec 0020) ──────
# A spec carrying `history:` entries (flat `- <state> <ISO-8601 UTC>` lines, written
# at each lifecycle move) is measured ready -> finished from those. Specs predating
# the convention fall back to git: --follow rides through the git-mv lifecycle moves;
# an untracked file yields empty output (not an error), which is the skip signal.
# Day arithmetic is a Julian-day-number formula in awk — BSD awk has no mktime, and
# BSD/GNU date flags disagree, so pure integer math is the portable option.
echo ""
echo "Cycle time (finished specs, ready -> finished; * = git-estimated):"
CYCLE_ROWS=0
while IFS='	' read -r f id state attempts deps; do
  [[ "$state" == "finished" ]] || continue
  fm="$(frontmatter "$f")"
  hist="$(printf '%s\n' "$fm" | awk '
    /^history:/ { inh = 1; next }
    inh && /^[[:space:]]*- / { sub(/^[[:space:]]*- +/, ""); print; next }
    inh { inh = 0 }')"
  ready_ts="$(printf '%s\n' "$hist" | awk '$1 == "ready" { print $2; exit }')"
  fin_ts="$(printf '%s\n' "$hist" | awk '$1 == "finished" { print $2; exit }')"
  if [[ "$ready_ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} && "$fin_ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    days="$(awk -v a="$ready_ts" -v b="$fin_ts" '
      function jdn(s,    y, m, d, p) {
        split(substr(s, 1, 10), p, "-")
        y = p[1] + 0; m = p[2] + 0; d = p[3] + 0
        return int((1461 * (y + 4800 + int((m - 14) / 12))) / 4) \
             + int((367 * (m - 2 - 12 * int((m - 14) / 12))) / 12) \
             - int((3 * int((y + 4900 + int((m - 14) / 12)) / 100)) / 4) + d - 32075
      }
      BEGIN { print jdn(b) - jdn(a) }')"
    printf "  %-22s %s day(s)\n" "$id" "$days"
    CYCLE_ROWS=$((CYCLE_ROWS + 1))
    continue
  fi
  times="$(git log --follow --format=%ct -- "$f" 2>/dev/null || true)"
  [[ -z "$times" ]] && continue
  newest="$(printf '%s\n' "$times" | head -1)"
  oldest="$(printf '%s\n' "$times" | tail -1)"
  days=$(((newest - oldest) / 86400))
  printf "  %-22s %s day(s) *\n" "$id" "$days"
  CYCLE_ROWS=$((CYCLE_ROWS + 1))
done <<EOF
$SPEC_DATA
EOF
if [[ "$CYCLE_ROWS" -eq 0 ]]; then
  echo "  (no finished specs with history entries or git tracking)"
fi
