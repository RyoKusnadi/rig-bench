#!/usr/bin/env bash
# PreToolUse hook — blocks generically destructive shell commands.
# Complements branch-safety.sh (which only handles git push/reset-hard) —
# this one covers filesystem and working-tree wipes that have nothing to do
# with git branches.
# Called by Claude Code before every Bash tool invocation.
# Stdin: JSON with tool_name and tool_input.command
# Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

set -euo pipefail

input=$(cat)

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
cmd=$(echo "$input"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

if [[ "$tool" != "Bash" ]]; then
  exit 0
fi

block() {
  echo "BLOCKED by block-dangerous-commands hook: $1"
  echo "Command was: ${cmd}"
  exit 2
}

# ── rm -rf against the filesystem root, home, or cwd ───────────────────────
if echo "$cmd" | grep -qE 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)[[:space:]]+(/|/\*|~|~/|\.|\./\*|\$HOME)([[:space:]]|$)'; then
  block "'rm -rf' against / , ~ , or . is not allowed."
fi

# ── Fork bomb ────────────────────────────────────────────────────────────
if echo "$cmd" | grep -qE ':\(\)[[:space:]]*\{[[:space:]]*:\|:&[[:space:]]*\}[[:space:]]*;:'; then
  block "fork bomb pattern detected."
fi

# ── dd / mkfs against a block device ───────────────────────────────────────
if echo "$cmd" | grep -qE '\bdd\b.*of=/dev/'; then
  block "'dd' writing directly to a block device is not allowed."
fi
if echo "$cmd" | grep -qE '\bmkfs(\.[a-zA-Z0-9]+)?\b'; then
  block "'mkfs' is not allowed."
fi

# ── Recursive chmod/chown on root ───────────────────────────────────────────
if echo "$cmd" | grep -qE '\bchmod\b[[:space:]]+-[a-zA-Z]*R[a-zA-Z]*[[:space:]]+[0-7]{3,4}[[:space:]]+/([[:space:]]|$)'; then
  block "recursive chmod on / is not allowed."
fi

# ── Redirect into a raw block device ────────────────────────────────────────
if echo "$cmd" | grep -qE '>[[:space:]]*/dev/sd[a-z][0-9]*\b'; then
  block "redirecting output into a raw block device is not allowed."
fi

# ── Piping a remote script straight into a shell ────────────────────────────
if echo "$cmd" | grep -qE '\b(curl|wget)\b.*\|[[:space:]]*(sudo[[:space:]]+)?(sh|bash|zsh)\b'; then
  block "piping a downloaded script directly into a shell is not allowed — download it, read it, then run it explicitly."
fi

# ── Mass destructive working-tree wipes ─────────────────────────────────────
if echo "$cmd" | grep -qE '\bgit[[:space:]]+clean\b.*-[a-zA-Z]*f[a-zA-Z]*d'; then
  block "'git clean -fd' (and variants like -fdx) permanently deletes untracked files. Ask the user to run it manually if truly needed."
fi
if echo "$cmd" | grep -qE '\bgit[[:space:]]+(checkout|restore)\b[[:space:]]+(--[[:space:]]+)?\.([[:space:]]|$)'; then
  block "'git checkout -- .' / 'git restore .' discards all uncommitted changes. Ask the user to run it manually if truly needed."
fi

exit 0
