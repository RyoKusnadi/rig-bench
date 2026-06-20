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
// Optional allowlist mode (todo.md P0 "Trivially Bypassable Regex-Based Bash
// Security"): set RIGBENCH_ALLOWED_COMMANDS to a comma-separated list of
// command names (e.g. "git,npm,node,cargo,go,test") to switch from
// blocklisting to default-deny. When set, every `&&`/`||`/`;`/`|`/newline-
// separated segment of the command must resolve to an allowlisted binary
// (after skipping leading `VAR=value` assignments and any path prefix) or
// the whole command is blocked — this is what actually defeats variable-
// expansion (`CMD="rm -rf /"; $CMD`) and base64/pipe-to-shell tricks
// (`echo ... | base64 -d | bash`): the bypass payload's final executed
// token (`$CMD`, `bash`) just isn't a literal name on the allowlist, so it
// fails closed instead of needing a smarter regex to detect the *encoding*.
// This is still not full AST parsing — a regex-split on shell metacharacters
// can't perfectly tokenize every quoting edge case — but it closes the
// specific bypasses regex-blocklisting can't: false negatives now fail
// *closed* (blocked) instead of *open* (allowed), since nothing reaches the
// allowlist check by default. Unset (the default) preserves today's
// blocklist-only behavior unchanged.
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

  // ── Optional allowlist mode (RIGBENCH_ALLOWED_COMMANDS) ────────────────
  const allowedCommandsRaw = process.env.RIGBENCH_ALLOWED_COMMANDS;
  if (allowedCommandsRaw) {
    const allowed = new Set(
      allowedCommandsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );

    // Split on shell command separators. Order matters: `\|\|` must be
    // tried before the single-`|` alternative, or `||` would be cut in half.
    const segments = cmd.split(/&&|\|\||;|\n|\|/).map((s) => s.trim()).filter(Boolean);

    for (const segment of segments) {
      // Skip leading `VAR=value` assignments (e.g. `CMD="rm -rf /"`) to find
      // the actual command token — an assignment-only segment has no real
      // command token and falls through to the "not allowlisted" block
      // below, same as `$CMD` itself does in a later segment.
      const match = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S+)/);
      const token = match ? match[1] : segment;
      // Strip a path prefix (e.g. `/usr/bin/git` -> `git`) so allowlisting
      // by name still works regardless of how the binary was invoked.
      const command = token.split('/').pop();

      if (!allowed.has(command)) {
        fail(
          `command '${command}' is not in RIGBENCH_ALLOWED_COMMANDS (${[...allowed].join(', ')}).\n` +
            `Full segment blocked: ${segment}`
        );
      }
    }
  }

  allow();
});
