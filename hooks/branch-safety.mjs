#!/usr/bin/env node
// PreToolUse hook — blocks destructive git operations on branches.
// Called by Claude Code before every Bash tool invocation.
// Stdin: JSON with tool_name and tool_input.command
// Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot, block, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
const root = repoRoot(import.meta.url);

if (input.tool_name !== 'Bash') allow();

const cmd = input.tool_input?.command || '';

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
      `by branch-safety hook: direct push to '${defaultBranch}' is not allowed.\n` +
        "Use the operator agent's SHIP mode to create a PR instead.",
      cmd
    );
  }

  // Block --force and --force-with-lease to any branch
  if (/git push.*(--force|--force-with-lease|-f )/.test(cmd)) {
    block(
      'by branch-safety hook: force push is not allowed without explicit user approval.\n' +
        'If you genuinely need this, ask the user to run the command manually.',
      cmd
    );
  }
}

// Match only when `git reset --hard` is the actual command being run, not
// when the string appears inside a commit message or comment.
if (/^\s*git reset --hard\b/.test(cmd)) {
  block(
    "by branch-safety hook: 'git reset --hard' is not allowed.\n" +
      'This permanently discards uncommitted changes and cannot be undone.\n' +
      'If you genuinely need this, ask the user to run the command manually.',
    cmd
  );
}

allow();
