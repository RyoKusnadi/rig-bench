// Tests for hooks/pre-tool-gatekeeper.mjs, which implements Role-Based
// Access Control (RBAC) via a PreToolUse hook. Runs the hook as a real
// subprocess (same invocation Claude Code uses: JSON on stdin, decision on
// stdout) rather than importing it, since the hook's behavior is its
// process boundary contract — env vars in, JSON/exit-code out.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'pre-tool-gatekeeper.mjs');
const ROLE_FILE = join(REPO_ROOT, '.claude', 'hook-state', 'agent-role.json');

function writeRoleFile(overrides = {}) {
  mkdirSync(dirname(ROLE_FILE), { recursive: true });
  writeFileSync(
    ROLE_FILE,
    JSON.stringify({ role: 'research', set_at: new Date().toISOString(), ttl_ms: 30 * 60 * 1000, ...overrides })
  );
}

function clearRoleFile() {
  if (existsSync(ROLE_FILE)) unlinkSync(ROLE_FILE);
}

function runHook(input, env = {}) {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let decision = null;
  try {
    decision = JSON.parse(result.stdout).hookSpecificOutput;
  } catch {
    decision = null; // no JSON on stdout = no opinion (fallback to prompt)
  }
  return { ...result, decision };
}

test('research role: Read tool is allowed', () => {
  const { decision } = runHook(
    { tool_name: 'Read', tool_input: { file_path: 'src/app.js' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'allow');
});

test('research role: Write to src/app.js is denied', () => {
  const { decision } = runHook(
    { tool_name: 'Write', tool_input: { file_path: 'src/app.js', content: 'x' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /forbidden from using tool 'Write'/);
});

test('research role: Write to TITLE.MD is allowed', () => {
  const { decision } = runHook(
    { tool_name: 'Write', tool_input: { file_path: 'research/foo/TITLE.MD', content: 'x' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'allow');
});

test('research role: Write to /tmp is allowed', () => {
  const { decision } = runHook(
    { tool_name: 'Write', tool_input: { file_path: '/tmp/research-scratch/foo.js', content: 'x' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'allow');
});

test('research role: Bash rm -rf is denied', () => {
  const { decision } = runHook(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'deny');
});

test('research role: node scripts/set-agent-role.mjs clear is allowed (self-clear carve-out)', () => {
  const { decision } = runHook(
    { tool_name: 'Bash', tool_input: { command: 'node scripts/set-agent-role.mjs clear' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'allow');
});

test('research role: node scripts/set-agent-role.mjs clear is allowed after a cd prefix', () => {
  const { decision } = runHook(
    {
      tool_name: 'Bash',
      tool_input: { command: 'cd /some/path && node scripts/set-agent-role.mjs clear' },
    },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'allow');
});

test('research role: node scripts/set-agent-role.mjs research (not clear) is still denied', () => {
  const { decision } = runHook(
    { tool_name: 'Bash', tool_input: { command: 'node scripts/set-agent-role.mjs research' } },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'deny');
});

test('research role: node scripts/set-agent-role.mjs clear chained with another command is denied', () => {
  const { decision } = runHook(
    {
      tool_name: 'Bash',
      tool_input: { command: 'node scripts/set-agent-role.mjs clear && rm -rf dist' },
    },
    { RIGBENCH_AGENT_ROLE: 'research' }
  );
  assert.ok(decision, 'expected a permission decision');
  assert.equal(decision.permissionDecision, 'deny');
});

test('research role via .claude/hook-state/agent-role.json: Write to src/app.js is denied even with no env var', () => {
  clearRoleFile();
  writeRoleFile();
  try {
    const { decision } = runHook({ tool_name: 'Write', tool_input: { file_path: 'src/app.js' } });
    assert.ok(decision, 'expected a permission decision');
    assert.equal(decision.permissionDecision, 'deny');
  } finally {
    clearRoleFile();
  }
});

test('expired agent-role.json falls back to developer (no decision) instead of staying locked', () => {
  clearRoleFile();
  writeRoleFile({ set_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), ttl_ms: 30 * 60 * 1000 });
  try {
    const { decision } = runHook({ tool_name: 'SomeUnknownTool', tool_input: {} });
    assert.equal(decision, null);
  } finally {
    clearRoleFile();
  }
});

test('developer role: unknown tool falls back to standard prompt (no decision)', () => {
  const { decision, status } = runHook(
    { tool_name: 'SomeUnknownTool', tool_input: {} },
    { RIGBENCH_AGENT_ROLE: 'developer' }
  );
  assert.equal(decision, null);
  assert.equal(status, 0);
});
