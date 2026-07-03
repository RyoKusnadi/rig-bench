#!/usr/bin/env bash
# check-specs.sh — consistency checks across one project's specs.
#
# Usage: scripts/check-specs.sh <project>
#        scripts/check-specs.sh          (only valid if exactly one specs/<project>/ folder exists)
#
# Extends the file-conflict grep pattern already documented in specs/README.md
# ("File-conflict gate") to catch the class of bug found reviewing PR #56:
#   - duplicate spec IDs within a project
#   - depends_on entries that don't resolve to any spec ID in the project
#   - specs whose Files/Interfaces Touched list has grown past the
#     "one deliverable" sizing rule (specs/README.md "Rule" section), which
#     nothing currently catches automatically
#   - a spec's frontmatter `status` not matching the lifecycle folder it's
#     physically sitting in (specs/README.md "State Transitions" invariant)
#
# This is advisory, not a hard gate — matching the existing file-conflict scan's
# own severity. Exits 1 if any issue is found so it can be wired into CI later,
# but nothing currently calls it automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SIZING_THRESHOLD="${SIZING_THRESHOLD:-5}"

if [[ $# -eq 1 ]]; then
  PROJECT="$1"
elif [[ $# -eq 0 ]]; then
  PROJECTS=()
  while IFS= read -r -d '' d; do
    PROJECTS+=("$(basename "$d")")
  done < <(find specs -mindepth 1 -maxdepth 1 -type d -print0)
  if [[ ${#PROJECTS[@]} -ne 1 ]]; then
    echo "Error: no project given, and specs/ does not have exactly one project folder (found: ${PROJECTS[*]:-none})." >&2
    echo "Usage: scripts/check-specs.sh <project>" >&2
    exit 1
  fi
  PROJECT="${PROJECTS[0]}"
else
  echo "Usage: scripts/check-specs.sh [project]" >&2
  exit 1
fi

PROJECT_DIR="specs/${PROJECT}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: ${PROJECT_DIR} does not exist." >&2
  exit 1
fi

ISSUES=0

# Collect every spec file across all lifecycle folders for this project.
SPEC_FILES=()
while IFS= read -r -d '' f; do
  SPEC_FILES+=("$f")
done < <(find "$PROJECT_DIR" -mindepth 2 -maxdepth 2 -name '*.md' -print0 | sort -z)

if [[ ${#SPEC_FILES[@]} -eq 0 ]]; then
  echo "No spec files found under ${PROJECT_DIR}/."
  exit 0
fi

echo "Checking ${#SPEC_FILES[@]} spec(s) in ${PROJECT_DIR}/ ..."
echo ""

# ── Extract frontmatter helper ──────────────────────────────────────────────
frontmatter() {
  awk '/^---$/{c++; next} c==1' "$1"
}

# ── Build id -> file map, checking for duplicates ───────────────────────────
declare -A ID_TO_FILE
for f in "${SPEC_FILES[@]}"; do
  fm="$(frontmatter "$f")"
  id="$(printf '%s\n' "$fm" | grep -E '^id:' | head -1 | sed -E 's/^id:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  if [[ -z "$id" ]]; then
    echo "ISSUE [missing-id]: $f has no 'id' field in frontmatter."
    ISSUES=$((ISSUES + 1))
    continue
  fi
  if [[ -n "${ID_TO_FILE[$id]:-}" ]]; then
    echo "ISSUE [duplicate-id]: id '$id' used by both ${ID_TO_FILE[$id]} and $f."
    ISSUES=$((ISSUES + 1))
  else
    ID_TO_FILE[$id]="$f"
  fi
done

# ── Check depends_on resolves within this project ───────────────────────────
# Also collect id → deps and id → status maps for the graph checks below (spec 0005).
declare -A ID_DEPS
declare -A ID_STATUS
for f in "${SPEC_FILES[@]}"; do
  fm="$(frontmatter "$f")"
  id="$(printf '%s\n' "$fm" | grep -E '^id:' | head -1 | sed -E 's/^id:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  status_val="$(printf '%s\n' "$fm" | grep -E '^status:' | head -1 | sed -E 's/^status:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  [[ -n "$id" ]] && ID_STATUS[$id]="$status_val"
  deps_raw="$(printf '%s\n' "$fm" | grep -E '^depends_on:' | head -1 | sed -E 's/^depends_on:[[:space:]]*//')"
  inner="$(echo "$deps_raw" | sed -E 's/^\[//; s/\]$//')"
  if [[ -n "$inner" ]] && [[ "$(echo "$inner" | tr -d '[:space:]')" != "" ]]; then
    IFS=',' read -ra deps <<< "$inner"
    for dep in "${deps[@]}"; do
      dep_clean="$(echo "$dep" | tr -d '[:space:]"'"'"'')"
      [[ -z "$dep_clean" ]] && continue
      if [[ -z "${ID_TO_FILE[$dep_clean]:-}" ]]; then
        echo "ISSUE [dangling-depends_on]: $f depends_on '$dep_clean', which is not any spec's id in ${PROJECT_DIR}/."
        ISSUES=$((ISSUES + 1))
      elif [[ -n "$id" ]]; then
        ID_DEPS[$id]="${ID_DEPS[$id]:-} $dep_clean"
      fi
    done
  fi
done

# ── Dependency-graph checks: cycles, finished-depends-on-unfinished (spec 0005) ──
# Iterative DFS with white(0)/gray(1)/black(2) coloring; a gray hit is a cycle.
# Dangling deps were already reported above and never enter ID_DEPS, so no double-report.
declare -A COLOR
for start in "${!ID_TO_FILE[@]}"; do
  [[ "${COLOR[$start]:-0}" -ne 0 ]] && continue
  STACK=("$start")
  PATH_STACK=()
  while [[ ${#STACK[@]} -gt 0 ]]; do
    node="${STACK[${#STACK[@]}-1]}"
    if [[ "${COLOR[$node]:-0}" -eq 0 ]]; then
      COLOR[$node]=1
      PATH_STACK+=("$node")
      for d in ${ID_DEPS[$node]:-}; do
        case "${COLOR[$d]:-0}" in
          1)
            echo "ISSUE [dep-cycle]: depends_on cycle detected: '$node' -> '$d' (path: ${PATH_STACK[*]})."
            ISSUES=$((ISSUES + 1))
            ;;
          0) STACK+=("$d") ;;
        esac
      done
    else
      # Finished expanding this node (it may appear once more on the stack).
      unset 'STACK[${#STACK[@]}-1]'
      if [[ "${COLOR[$node]:-0}" -eq 1 ]]; then
        COLOR[$node]=2
        [[ ${#PATH_STACK[@]} -gt 0 ]] && unset 'PATH_STACK[${#PATH_STACK[@]}-1]'
      fi
    fi
  done
done

for id in "${!ID_DEPS[@]}"; do
  [[ "${ID_STATUS[$id]:-}" != "finished" ]] && continue
  for d in ${ID_DEPS[$id]:-}; do
    if [[ "${ID_STATUS[$d]:-}" != "finished" ]]; then
      echo "ISSUE [finished-dep-unfinished]: spec '$id' is finished but depends_on '$d' (status: ${ID_STATUS[$d]:-unknown}) is not."
      echo "  spec-exec's dependency gate should have prevented this — the graph and the folders disagree."
      ISSUES=$((ISSUES + 1))
    fi
  done
done

# ── Sizing heuristic: Files/Interfaces Touched growing past one deliverable ──
for f in "${SPEC_FILES[@]}"; do
  count="$(awk '
    /^## Files\/Interfaces Touched/ { infiles=1; next }
    /^## / && infiles { infiles=0 }
    infiles && /^- / { n++ }
    END { print n+0 }
  ' "$f")"
  if [[ "$count" -gt "$SIZING_THRESHOLD" ]]; then
    echo "ISSUE [sizing]: $f lists $count files under Files/Interfaces Touched (threshold: $SIZING_THRESHOLD)."
    echo "  specs/README.md's Rule: one spec = one deliverable. Consider splitting."
    ISSUES=$((ISSUES + 1))
  fi
done

# ── Status/folder mismatch: frontmatter status must match the lifecycle folder ──
# Valid states are derived from workflows/state.yaml (the machine-readable state
# table) rather than hand-maintained here — spec 0001 removed the third copy.
# Parsing stays line-oriented (awk only) to keep this script dependency-free.
STATE_YAML="workflows/state.yaml"
if [[ ! -f "$STATE_YAML" ]]; then
  echo "Error: $STATE_YAML is missing — it is the source of the valid state list." >&2
  exit 1
fi
VALID_STATES=()
while IFS= read -r s; do
  VALID_STATES+=("$s")
done < <(awk '/^[[:space:]]*-[[:space:]]*name:/ { print $NF }' "$STATE_YAML")
if [[ ${#VALID_STATES[@]} -eq 0 ]]; then
  echo "Error: no states parsed from $STATE_YAML — file present but yields no '- name:' entries." >&2
  exit 1
fi
for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"
  fm="$(frontmatter "$f")"
  status="$(printf '%s\n' "$fm" | grep -E '^status:' | head -1 | sed -E 's/^status:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  if [[ -z "$status" ]]; then
    echo "ISSUE [missing-status]: $f has no 'status' field in frontmatter."
    ISSUES=$((ISSUES + 1))
    continue
  fi
  is_valid=0
  for s in "${VALID_STATES[@]}"; do
    [[ "$status" == "$s" ]] && is_valid=1 && break
  done
  if [[ "$is_valid" -eq 0 ]]; then
    echo "ISSUE [unknown-status]: $f has status '$status', which isn't one of: ${VALID_STATES[*]}."
    ISSUES=$((ISSUES + 1))
  elif [[ "$status" != "$folder" ]]; then
    echo "ISSUE [status-mismatch]: $f has status '$status' but sits in '$folder/'."
    echo "  specs/README.md's State Transitions invariant: status must always match the physical folder."
    ISSUES=$((ISSUES + 1))
  fi
done

echo ""
if [[ "$ISSUES" -eq 0 ]]; then
  echo "No issues found."
  exit 0
else
  echo "${ISSUES} issue(s) found."
  exit 1
fi
