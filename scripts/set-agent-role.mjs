#!/usr/bin/env node
// Sets/clears the agent-role state file that hooks/pre-tool-gatekeeper.mjs
// reads (todo.md "Implement Role-Based Access Control (RBAC) via PreToolUse
// Hook", Task 3). Subagents spawned via the Workflow tool's agent() calls
// run in-process, sharing this session's environment — there's no
// `spawn('claude', ...)` subprocess boundary to set RIGBENCH_AGENT_ROLE on
// per-call. A deterministic state file the main session writes immediately
// before invoking a workflow (and clears immediately after) is the
// equivalent boundary: the gatekeeper hook checks it on every PreToolUse
// event for the rest of the session.
//
// The file carries a TTL (default 30 minutes) so a crashed/forgotten
// `clear` doesn't permanently lock the session into the research role's
// read-only restrictions — see resolveRole() in hooks/pre-tool-gatekeeper.mjs.
//
// Usage:
//   node scripts/set-agent-role.mjs research   # before invoking the research workflow
//   node scripts/set-agent-role.mjs clear       # after the workflow returns

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const roleFile = join(root, '.claude', 'hook-state', 'agent-role.json');
const ROLE_TTL_MS = 30 * 60 * 1000;

const cmd = process.argv[2];

if (cmd === 'clear') {
  if (existsSync(roleFile)) unlinkSync(roleFile);
  console.log('agent role cleared');
  process.exit(0);
}

if (cmd !== 'research') {
  console.error('usage: node scripts/set-agent-role.mjs <research|clear>');
  process.exit(1);
}

mkdirSync(dirname(roleFile), { recursive: true });
writeFileSync(roleFile, JSON.stringify({ role: cmd, set_at: new Date().toISOString(), ttl_ms: ROLE_TTL_MS }));
console.log(`agent role set to '${cmd}' (expires in ${ROLE_TTL_MS / 60000}m unless cleared first)`);
