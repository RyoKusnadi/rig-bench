#!/usr/bin/env bash
# PreToolUse hook — blocks git push to the default branch (main/master).
# Called by Claude Code before every Bash tool invocation.
# Stdin: JSON with tool_name and tool_input.command
# Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

set -euo pipefail

input=$(cat)

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
cmd=$(echo "$input"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

# Only inspect Bash calls that contain "git push"
if [[ "$tool" != "Bash" ]] || ! echo "$cmd" | grep -q "git push"; then
  exit 0
fi

# Detect the default branch
default=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")

# Block direct push to default branch (git push, git push origin <default>, git push -u origin <default>)
if echo "$cmd" | grep -qE "git push( -u)?( origin)?( ${default})?$|git push( -u)? origin ${default}"; then
  echo "BLOCKED by branch-safety hook: direct push to '${default}' is not allowed."
  echo "Use the git-assistant agent to create a PR instead."
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

exit 0
