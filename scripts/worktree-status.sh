#!/usr/bin/env bash
# worktree-status.sh — read-only view of concurrent-dispatch worktrees.
#
# Lists every git worktree matching the dispatch naming convention (branch
# `spec-<id>-<slug>`, or path `*-wt-<id>` — see spec-exec's "Concurrent dispatch"),
# resolves each spec's current lifecycle folder, and flags worktrees whose spec is no
# longer in in_progress/ as stale — printing the exact cleanup command WITHOUT running
# it. Deliberately performs no mutation of any kind: per CLAUDE.md's non-negotiables,
# destructive cleanup stays a human-executed command; this script's job ends at
# printing it. The failure mode of wrong staleness logic is therefore a human being
# shown a wrong suggestion they still have to run themselves.
#
# Usage: scripts/worktree-status.sh        (also: make worktrees)
#
# Dependency-free bash/awk per memory/decisions.md, bash-3.2 compatible per
# memory/gotchas.md. Spec: specs/template/*/0019-worktree-hygiene.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "Dispatch worktrees — ${REPO_ROOT}"
echo ""

LIST="$(git worktree list --porcelain 2>/dev/null || true)"
if [[ -z "$LIST" ]]; then
  echo "  (not a git repository, or git worktree unavailable)"
  exit 0
fi

# Porcelain stanzas -> "path<TAB>branch" rows, skipping the main checkout.
ROWS="$(printf '%s\n' "$LIST" | awk -v root="$REPO_ROOT" '
  /^worktree / { path = substr($0, 10) }
  /^branch /   { branch = substr($0, 8); sub(/^refs\/heads\//, "", branch) }
  /^detached$/ { branch = "" }
  /^$/ {
    if (path != "" && path != root) printf "%s\t%s\n", path, branch
    path = ""; branch = ""
  }
  END { if (path != "" && path != root) printf "%s\t%s\n", path, branch }
')"

FOUND=0
STALE=0
while IFS='	' read -r wpath wbranch; do
  [[ -z "$wpath" ]] && continue
  id=""
  case "$wbranch" in
    spec-[0-9][0-9][0-9][0-9]-*)
      id="${wbranch#spec-}"
      id="${id%%-*}"
      ;;
  esac
  if [[ -z "$id" ]]; then
    case "$wpath" in
      *-wt-[0-9][0-9][0-9][0-9]) id="${wpath##*-wt-}" ;;
    esac
  fi
  [[ -z "$id" ]] && continue
  FOUND=$((FOUND + 1))
  # A spec found in no lifecycle folder reports as unknown — its worktree definitely
  # shouldn't exist, so unknown is treated as stale like any non-in_progress state.
  spec_file="$(find specs -mindepth 3 -maxdepth 3 -name "${id}-*.md" 2>/dev/null | head -1 || true)"
  if [[ -n "$spec_file" ]]; then
    state="$(basename "$(dirname "$spec_file")")"
  else
    state="unknown"
  fi
  printf "  %s\n    branch=%s  spec=%s  state=%s\n" "$wpath" "${wbranch:-(detached)}" "$id" "$state"
  if [[ "$state" != "in_progress" ]]; then
    STALE=$((STALE + 1))
    echo "    STALE — spec is not in in_progress/. Suggested cleanup (not executed here):"
    echo "      git worktree remove ${wpath}"
  fi
done <<EOF
$ROWS
EOF

if [[ "$FOUND" -eq 0 ]]; then
  echo "  (no dispatch worktrees found)"
else
  echo ""
  echo "  ${FOUND} dispatch worktree(s), ${STALE} stale."
fi
