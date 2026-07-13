#!/usr/bin/env bash
# worktree-status.sh — read-only view of concurrent-dispatch worktrees.
#
# Lists every git worktree matching the dispatch naming convention (branch
# `spec-<id>-<slug>`, or path `*-wt-<id>` — see spec-exec's "Concurrent dispatch"),
# resolves each spec's current lifecycle state from spec.db (via scripts/spec-db.mjs),
# and flags worktrees whose spec is no longer in_progress as stale — printing the exact
# cleanup command WITHOUT running it. Deliberately performs no mutation of any kind:
# per CLAUDE.md's non-negotiables, destructive cleanup stays a human-executed command;
# this script's job ends at printing it. The failure mode of wrong staleness logic is
# therefore a human being shown a wrong suggestion they still have to run themselves.
#
# Usage: scripts/worktree-status.sh        (also: make worktrees)
#
# bash-3.2 compatible per the gotchas notebook. Spec: 0019 (worktree hygiene).

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
  # A spec the DB doesn't know reports as unknown — its worktree definitely shouldn't
  # exist, so unknown is treated as stale like any non-in_progress state. Lookup is a
  # grep over `spec-db.mjs list` output (`project/<id>  [state]  ...`), first match wins
  # when the same id exists in multiple projects; a missing DB or node yields unknown.
  state="$(node --no-warnings scripts/spec-db.mjs list 2>/dev/null \
    | awk -v id="$id" '$1 ~ ("/" id "$") { gsub(/[][]/, "", $2); print $2; exit }')"
  [[ -z "$state" ]] && state="unknown"
  printf "  %s\n    branch=%s  spec=%s  state=%s\n" "$wpath" "${wbranch:-(detached)}" "$id" "$state"
  if [[ "$state" != "in_progress" ]]; then
    STALE=$((STALE + 1))
    echo "    STALE — spec is not in_progress. Suggested cleanup (not executed here):"
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
