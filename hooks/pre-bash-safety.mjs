#!/usr/bin/env node
// PreToolUse hook — blocks destructive Bash commands before every Bash tool
// invocation. Merges what used to be two separate processes
// (branch-safety.mjs + block-dangerous-commands.mjs) into one, since both
// fire on every single Bash call — halves the Node spawn overhead on the
// hot path without changing behavior.
//
// Respects RIGBENCH_DISABLED_HOOKS=pre-bash-safety to skip entirely, and
// RIGBENCH_HOOK_PROFILE=minimal|standard|strict to scale the check set:
//   minimal  — git branch-safety checks only
//   standard — + generic destructive-command blocking (default)
//   strict   — + blocks `git add .`/`git add -A` and `--no-verify`
//
// Stdin: JSON with tool_name and tool_input.command
// Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot, block, allow, runHook, hookProfile, cached } from './lib/hook-utils.mjs';

const HOOK_NAME = 'pre-bash-safety';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

runHook(HOOK_NAME, 'PreToolUse', root, input.tool_name, () => {
  if (input.tool_name !== 'Bash') allow();

  const cmd = input.tool_input?.command || '';
  const profile = hookProfile();

  // ── Git branch safety (all profiles) ──────────────────────────────────
  if (/git push/.test(cmd)) {
    // Resolving the default branch hits the network (git remote show
    // origin) — cache it for an hour so a flurry of git push attempts in
    // one session doesn't pay that cost every time.
    const defaultBranch = cached(root, 'default-branch', 60 * 60 * 1000, () => {
      try {
        const out = execSync('git remote show origin', { cwd: root, encoding: 'utf8' });
        const m = out.match(/HEAD branch:\s*(\S+)/);
        return m ? m[1] : 'main';
      } catch {
        return 'main'; // no origin configured (yet)
      }
    });

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

    if (/git push.*(--force|--force-with-lease|-f )/.test(cmd)) {
      block(
        'by pre-bash-safety hook: force push is not allowed without explicit user approval.\n' +
          'If you genuinely need this, ask the user to run the command manually.',
        cmd
      );
    }
  }

  if (/^\s*git reset --hard\b/.test(cmd)) {
    block(
      "by pre-bash-safety hook: 'git reset --hard' is not allowed.\n" +
        'This permanently discards uncommitted changes and cannot be undone.\n' +
        'If you genuinely need this, ask the user to run the command manually.',
      cmd
    );
  }

  if (profile === 'minimal') allow();

  // ── Generic destructive commands (standard + strict) ───────────────────
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

  // ── Strict-only checks ───────────────────────────────────────────────
  if (profile === 'strict') {
    if (/\bgit\s+add\s+(\.|-A|--all)(\s|$)/.test(cmd)) {
      fail("'git add .' / 'git add -A' is not allowed under the strict profile — stage specific files only.");
    }
    if (/--no-verify\b/.test(cmd)) {
      fail("'--no-verify' is not allowed under the strict profile — fix the failing hook instead of skipping it.");
    }
  }

  allow();
});
