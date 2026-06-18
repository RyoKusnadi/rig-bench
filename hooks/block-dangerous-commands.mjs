#!/usr/bin/env node
// PreToolUse hook — blocks generically destructive shell commands.
// Complements branch-safety.mjs (which only handles git push/reset --hard) —
// this one covers filesystem and working-tree wipes that have nothing to do
// with git branches.
// Called by Claude Code before every Bash tool invocation.
// Stdin: JSON with tool_name and tool_input.command
// Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

import { readStdinJson, block, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Bash') allow();

const cmd = input.tool_input?.command || '';

const fail = (reason) => block(`by block-dangerous-commands hook: ${reason}`, cmd);

// ── rm -rf against the filesystem root, home, or cwd ───────────────────────
if (/rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|\/\*|~|~\/|\.|\.\/\*|\$HOME)(\s|$)/.test(cmd)) {
  fail("'rm -rf' against / , ~ , or . is not allowed.");
}

// ── Fork bomb ────────────────────────────────────────────────────────────
if (/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/.test(cmd)) {
  fail('fork bomb pattern detected.');
}

// ── dd / mkfs against a block device ───────────────────────────────────────
if (/\bdd\b.*of=\/dev\//.test(cmd)) {
  fail("'dd' writing directly to a block device is not allowed.");
}
if (/\bmkfs(\.[a-zA-Z0-9]+)?\b/.test(cmd)) {
  fail("'mkfs' is not allowed.");
}

// ── Recursive chmod on root ──────────────────────────────────────────────
if (/\bchmod\b\s+-[a-zA-Z]*R[a-zA-Z]*\s+[0-7]{3,4}\s+\/(\s|$)/.test(cmd)) {
  fail('recursive chmod on / is not allowed.');
}

// ── Redirect into a raw block device ────────────────────────────────────
if (/>\s*\/dev\/sd[a-z][0-9]*\b/.test(cmd)) {
  fail('redirecting output into a raw block device is not allowed.');
}

// ── Piping a remote script straight into a shell ────────────────────────
if (/\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(cmd)) {
  fail(
    'piping a downloaded script directly into a shell is not allowed — download it, read it, then run it explicitly.'
  );
}

// ── Mass destructive working-tree wipes ──────────────────────────────────
if (/\bgit\s+clean\b.*-[a-zA-Z]*f[a-zA-Z]*d/.test(cmd)) {
  fail("'git clean -fd' (and variants like -fdx) permanently deletes untracked files. Ask the user to run it manually if truly needed.");
}
if (/\bgit\s+(checkout|restore)\b\s+(--\s+)?\.(\s|$)/.test(cmd)) {
  fail("'git checkout -- .' / 'git restore .' discards all uncommitted changes. Ask the user to run it manually if truly needed.");
}

allow();
