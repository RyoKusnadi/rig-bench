#!/usr/bin/env node
// PreToolUse hook (matcher: "" — fires for every tool) — Role-Based Access
// Control gatekeeper (todo.md "Implement Role-Based Access Control (RBAC)
// via PreToolUse Hook"). Reads RIGBENCH_AGENT_ROLE and enforces a strict
// read-only boundary for the autonomous `research` role (the Ralph loop
// must never edit src/ or run arbitrary code), while staying out of the way
// for the interactive `developer` role, which keeps relying on
// .claude/settings.local.json + the existing pre-bash-safety/read-budget/
// pre-webfetch-security hooks for its own checks.
//
// Unlike block()/allow() (exit-code protocol, used by the other PreToolUse
// hooks), a `research`-role decision needs to skip the permission prompt
// entirely so the Ralph loop can run unattended — that requires the JSON
// `permissionDecision` protocol (see permissionAllow/permissionDeny in
// hook-utils.mjs). Anything ambiguous calls noDecision(), which falls back
// to the standard prompt/settings-based flow exactly like exit 0 with no
// stdout always has.
//
// Role resolution checks two sources, in order:
//   1. .claude/hook-state/agent-role.json — written by
//      `node scripts/set-agent-role.mjs research` immediately before the
//      main session invokes the `research` workflow, and cleared right
//      after. This is the boundary that actually applies to this harness:
//      Workflow-driven subagents (agent() in workflows/*.js) run in-process,
//      sharing this session's environment, so there's no per-call `spawn()`
//      to set an env var on. The file carries a TTL (set by that script,
//      default 30 min) so a crashed/forgotten `clear` doesn't permanently
//      lock the session into read-only mode.
//   2. RIGBENCH_AGENT_ROLE env var — for a genuinely separate process (e.g.
//      a headless `RIGBENCH_AGENT_ROLE=research claude -p ...` invocation),
//      where an env var actually does scope to that process.
// Defaults to 'developer' if neither source says 'research'.
//
// Respects RIGBENCH_DISABLED_HOOKS=pre-tool-gatekeeper.
//
// Stdin: JSON with tool_name and tool_input.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson, repoRoot, runHook, permissionAllow, permissionDeny, noDecision } from './lib/hook-utils.mjs';

const HOOK_NAME = 'pre-tool-gatekeeper';
const EVENT = 'PreToolUse';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

function resolveRole() {
  const roleFile = join(root, '.claude', 'hook-state', 'agent-role.json');
  try {
    if (existsSync(roleFile)) {
      const { role, set_at, ttl_ms } = JSON.parse(readFileSync(roleFile, 'utf8'));
      const ttl = typeof ttl_ms === 'number' ? ttl_ms : 30 * 60 * 1000;
      if (role === 'research' && Date.now() - new Date(set_at).getTime() < ttl) return 'research';
    }
  } catch {
    // corrupt/unreadable state file — fall through to the env var
  }
  return process.env.RIGBENCH_AGENT_ROLE === 'research' ? 'research' : 'developer';
}

const role = resolveRole();

const RESEARCH_READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
const RESEARCH_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const RESEARCH_EDIT_PATH_RE = /(^|[\\/])TITLE\.MD$/i;
const RESEARCH_OUTPUT_DIR_RE = /research_output[\\/]/;

// Read-only/search commands the research role's Ralph loop needs — anything
// whose base command isn't on this list is denied by default (deny-by-
// default, not a blocklist — same posture as pre-bash-safety's
// RIGBENCH_ALLOWED_COMMANDS opt-in mode, but mandatory for this role).
const RESEARCH_ALLOWED_BASH = new Set(['cat', 'grep', 'rg', 'find', 'curl']);
// `git` is allowed only for these read-only subcommands, never `git push`/
// `git add`/etc.
const RESEARCH_ALLOWED_GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch']);

// Self-clear carve-out: the research role blocks `node` outright, which
// means a crashed/interrupted Ralph loop had no in-session way to lift its
// own lock before the 30-min TTL in set-agent-role.mjs. This regex allows
// only that exact invocation (with or without a leading `cd ... &&`,
// matched per-segment below) — never `node` generally.
const RESEARCH_SELF_CLEAR_RE = /^node\s+(?:\.\/)?scripts\/set-agent-role\.mjs\s+clear$/;

function researchBashDecision(cmd) {
  const segments = cmd.split(/&&|\|\||;|\n|\|/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    return { allow: false, reason: `BLOCKED: 'research' agent role: empty/unparseable command '${cmd}'.` };
  }

  if (segments.every((s) => RESEARCH_SELF_CLEAR_RE.test(s) || /^cd\s+\S+$/.test(s))) {
    return { allow: true, reason: "research role: self-clear carve-out for 'node scripts/set-agent-role.mjs clear'." };
  }

  for (const segment of segments) {
    const match = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S+)/);
    const token = match ? match[1] : segment;
    const command = token.split('/').pop();

    if (command === 'git') {
      const subcommand = segment.trim().split(/\s+/)[1];
      if (!RESEARCH_ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
        return {
          allow: false,
          reason: `BLOCKED: 'research' agent role is forbidden from using 'git ${subcommand}' — only read-only git subcommands (${[...RESEARCH_ALLOWED_GIT_SUBCOMMANDS].join(', ')}) are allowed.`,
        };
      }
      continue;
    }

    if (!RESEARCH_ALLOWED_BASH.has(command)) {
      return {
        allow: false,
        reason: `BLOCKED: 'research' agent role is forbidden from running '${command}' — only read-only/search commands (${[...RESEARCH_ALLOWED_BASH].join(', ')}, git status/log/diff/show/branch) are allowed.`,
      };
    }
  }

  return { allow: true, reason: 'research role: command resolves to read-only/search commands only.' };
}

function researchEditPath(toolInput) {
  return toolInput?.file_path || toolInput?.notebook_path || '';
}

function decideForResearch(toolName, toolInput) {
  if (RESEARCH_READ_TOOLS.has(toolName)) {
    return { allow: true, reason: `research role: '${toolName}' is a read-only tool.` };
  }

  if (RESEARCH_EDIT_TOOLS.has(toolName)) {
    const path = researchEditPath(toolInput);
    if (RESEARCH_EDIT_PATH_RE.test(path) || RESEARCH_OUTPUT_DIR_RE.test(path)) {
      return { allow: true, reason: `research role: '${toolName}' on '${path}' is within the allowed TITLE.MD/research_output/ output path.` };
    }
    return {
      allow: false,
      reason: `BLOCKED: 'research' agent role is forbidden from using tool '${toolName}' on path '${path}'.`,
    };
  }

  if (toolName === 'Bash') {
    return researchBashDecision(toolInput?.command || '');
  }

  return null; // ambiguous — fall back to standard prompt/settings
}

runHook(HOOK_NAME, EVENT, root, input.tool_name, () => {
  if (role !== 'research') {
    // developer role: no opinion — settings.local.json + the existing
    // pre-bash-safety/read-budget/pre-webfetch-security hooks already cover
    // this role's checks. Adding redundant allow/deny logic here would just
    // duplicate them.
    noDecision();
    return;
  }

  const decision = decideForResearch(input.tool_name, input.tool_input);
  if (decision === null) {
    noDecision();
    return;
  }

  if (decision.allow) {
    permissionAllow(EVENT, decision.reason);
  } else {
    permissionDeny(EVENT, decision.reason);
  }
});
