// Tests for hooks/read-budget.mjs — PreToolUse (Read) context-budget guard.
// Runs the hook as a real subprocess, same convention as
// tests/pre-tool-gatekeeper.test.js, using the exit-code protocol (block()/
// allow()).
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so telemetry writes
// never touch the real repo's .claude/agent-telemetry.json.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'read-budget.mjs');

function runHook(input, projectDir, extraEnv = {}) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...extraEnv },
  });
}

test('under budget: Read calls are allowed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-read-budget-'));
  try {
    const result = runHook(
      { tool_name: 'Read', tool_input: { file_path: 'a.js' }, session_id: 'sess-1' },
      tmp,
      { RIGBENCH_MAX_READS: '2' }
    );
    assert.equal(result.status, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('exceeding RIGBENCH_MAX_READS blocks', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-read-budget-'));
  try {
    const sessionId = 'sess-2';
    const env = { RIGBENCH_MAX_READS: '2' };
    // 1st and 2nd reads are within budget (count becomes 1, 2).
    let result = runHook({ tool_name: 'Read', tool_input: { file_path: 'a.js' }, session_id: sessionId }, tmp, env);
    assert.equal(result.status, 0);
    result = runHook({ tool_name: 'Read', tool_input: { file_path: 'b.js' }, session_id: sessionId }, tmp, env);
    assert.equal(result.status, 0);
    // 3rd read pushes count to 3 > budget of 2 — blocked.
    result = runHook({ tool_name: 'Read', tool_input: { file_path: 'c.js' }, session_id: sessionId }, tmp, env);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /BLOCKED:/);
    assert.match(result.stdout, /budget: 2/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('telemetry is written under the temp CLAUDE_PROJECT_DIR, not the real repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-read-budget-'));
  try {
    const result = runHook(
      { tool_name: 'Read', tool_input: { file_path: 'a.js' }, session_id: 'sess-3' },
      tmp,
      { RIGBENCH_MAX_READS: '50' }
    );
    assert.equal(result.status, 0);

    const telemetryPath = join(tmp, '.claude', 'agent-telemetry.json');
    assert.ok(existsSync(telemetryPath), 'expected agent-telemetry.json in temp project dir');
    const telemetry = JSON.parse(readFileSync(telemetryPath, 'utf8'));
    assert.equal(telemetry.sessions['sess-3'].count, 1);
    assert.deepEqual(telemetry.sessions['sess-3'].files, ['a.js']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-Read tool_name is allowed without tracking', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-read-budget-'));
  try {
    const result = runHook({ tool_name: 'Write', tool_input: {}, session_id: 'sess-4' }, tmp, {
      RIGBENCH_MAX_READS: '1',
    });
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'agent-telemetry.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=read-budget skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-read-budget-'));
  try {
    const result = runHook(
      { tool_name: 'Read', tool_input: { file_path: 'a.js' }, session_id: 'sess-5' },
      tmp,
      { RIGBENCH_MAX_READS: '0', RIGBENCH_DISABLED_HOOKS: 'read-budget' }
    );
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'agent-telemetry.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
