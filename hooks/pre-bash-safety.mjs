#!/usr/bin/env node
// PreToolUse hook — blocks destructive Bash commands before every Bash tool
// invocation. Merges what used to be two separate processes
// (branch-safety.mjs + block-dangerous-commands.mjs) into one, since both
// fire on every single Bash call — halves the Node spawn overhead on the
// hot path without changing behavior.
//
// Stdin: JSON with tool_name and tool_input.command
// Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot, block, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Bash') allow();

const cmd = input.tool_input?.command || '';
const root = repoRoot(import.meta.url);

// ── Git branch safety ───────────────────────────────────────────────────
if (/git push/.test(cmd)) {
  // Detect the default branch — always against the project repo, regardless
  // of whatever cwd the triggering Bash call happened to drift to.
  let defaultBranch = 'main';
  try {
    const out = execSync('git remote show origin', { cwd: root, encoding: 'utf8' });
    const m = out.match(/HEAD branch:\s*(\S+)/);
    if (m) defaultBranch = m[1];
  } catch {
    // no origin configured (yet) — fall back to "main"
  }

  // Block direct push to default branch
  const pushDefaultRe = new RegExp(
    `git push( -u)?( origin)?( ${defaultBranch})?$|git push( -u)? origin ${defaultBranch}`
  );
  if (pushDefaultRe.test(cmd)) {
    block(
      `by pre-bash-safety hook: direct push to '${defaultBranch}' is not allowed.\n` +
        "Use the operator agent's SHIP mode to create a PR instead.",
      cmd
    );
  }

  // Block --force and --force-with-lease to any branch
  if (/git push.*(--force|--force-with-lease|-f )/.test(cmd)) {
    block(
      'by pre-bash-safety hook: force push is not allowed without explicit user approval.\n' +
        'If you genuinely need this, ask the user to run the command manually.',
      cmd
    );
  }
}

// Match only when `git reset --hard` is the actual command being run, not
// when the string appears inside a commit message or comment.
if (/^\s*git reset --hard\b/.test(cmd)) {
  block(
    "by pre-bash-safety hook: 'git reset --hard' is not allowed.\n" +
      'This permanently discards uncommitted changes and cannot be undone.\n' +
      'If you genuinely need this, ask the user to run the command manually.',
    cmd
  );
}

// ── Generic destructive commands (filesystem/working-tree wipes) ─────────
const fail = (reason) => block(`by pre-bash-safety hook: ${reason}`, cmd);

if (/rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|\/\*|~|~\/|\.|\.\/\*|\$HOME)(\s|$)/.test(cmd)) {
  fail("'rm -rf' against / , ~ , or . is not allowed.");
}

if (/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/.test(cmd)) {
  fail('fork bomb pattern detected.');
}

if (/\bdd\b.*of=\/dev\//.test(cmd)) {
  fail("'dd' writing directly to a block device is not allowed.");
}
if (/\bmkfs(\.[a-zA-Z0-9]+)?\b/.test(cmd)) {
  fail("'mkfs' is not allowed.");
}

if (/\bchmod\b\s+-[a-zA-Z]*R[a-zA-Z]*\s+[0-7]{3,4}\s+\/(\s|$)/.test(cmd)) {
  fail('recursive chmod on / is not allowed.');
}

if (/>\s*\/dev\/sd[a-z][0-9]*\b/.test(cmd)) {
  fail('redirecting output into a raw block device is not allowed.');
}

if (/\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(cmd)) {
  fail(
    'piping a downloaded script directly into a shell is not allowed — download it, read it, then run it explicitly.'
  );
}

if (/\bgit\s+clean\b.*-[a-zA-Z]*f[a-zA-Z]*d/.test(cmd)) {
  fail("'git clean -fd' (and variants like -fdx) permanently deletes untracked files. Ask the user to run it manually if truly needed.");
}
if (/\bgit\s+(checkout|restore)\b\s+(--\s+)?\.(\s|$)/.test(cmd)) {
  fail("'git checkout -- .' / 'git restore .' discards all uncommitted changes. Ask the user to run it manually if truly needed.");
}

allow();
