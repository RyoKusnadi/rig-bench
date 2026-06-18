#!/usr/bin/env bash
# PreToolUse hook — blocks destructive git operations on branches.
# Called by Claude Code before every Bash tool invocation.
# Stdin: JSON with tool_name and tool_input.command
# Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

set -euo pipefail

input=$(cat)
repo_root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
cmd=$(echo "$input"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

# Only inspect Bash calls
if [[ "$tool" != "Bash" ]]; then
  exit 0
fi

# ── Check: git push ────────────────────────────────────────────────────────
if echo "$cmd" | grep -q "git push"; then
  # Detect the default branch — always against the project repo, regardless of
  # whatever cwd the triggering Bash call happened to drift to.
  default=$(git -C "$repo_root" remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")

  # Block direct push to default branch
  if echo "$cmd" | grep -qE "git push( -u)?( origin)?( ${default})?$|git push( -u)? origin ${default}"; then
    echo "BLOCKED by branch-safety hook: direct push to '${default}' is not allowed."
    echo "Use the operator agent's SHIP mode to create a PR instead."
    echo "Command was: ${cmd}"
    exit 2
  fi

  # Block --force and --force-with-lease to any branch
  if echo "$cmd" | grep -qE "git push.*(--force|--force-with-lease|-f )"; then
    echo "BLOCKED by branch-safety hook: force push is not allowed without explicit user approval."
    echo "If you genuinely need this, ask the user to run the command manually."
    echo "Command was: ${cmd}"
    exit 2
  fi
fi

# ── Check: git reset --hard ────────────────────────────────────────────────
# Match only when `git reset --hard` is the actual command being run, not when
# the string appears inside a commit message or comment.
if echo "$cmd" | grep -qE "^\s*git reset --hard\b"; then
  echo "BLOCKED by branch-safety hook: 'git reset --hard' is not allowed."
  echo "This permanently discards uncommitted changes and cannot be undone."
  echo "If you genuinely need this, ask the user to run the command manually."
  echo "Command was: ${cmd}"
  exit 2
fi

exit 0
