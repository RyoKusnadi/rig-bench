#!/usr/bin/env bash
# read-worktree-diff.sh
#
# Prints the diff between the current branch/worktree and `main`, falling
# back to the diff against the previous commit if `main` does not exist.
# Truncates output to 10,000 lines to keep verification reads cheap.
#
# Usage: bash scripts/read-worktree-diff.sh
# No arguments required.

set -euo pipefail

TRUNCATE_LIMIT=10000

if git rev-parse --verify --quiet main >/dev/null; then
  diff_output="$(git diff main...HEAD 2>/dev/null || true)"
  diff_label="main...HEAD"
else
  diff_output="$(git diff HEAD~1...HEAD 2>/dev/null || true)"
  diff_label="HEAD~1...HEAD"
fi

if [ -z "$diff_output" ]; then
  echo "No changes — worktree is clean relative to main."
  exit 0
fi

total_lines="$(printf '%s\n' "$diff_output" | wc -l | tr -d ' ')"

echo "# Worktree diff (${diff_label}):"
{ printf '%s\n' "$diff_output" || true; } | head -n "$TRUNCATE_LIMIT"

if [ "$total_lines" -gt "$TRUNCATE_LIMIT" ]; then
  echo "# [TRUNCATED at ${TRUNCATE_LIMIT} lines]"
fi
