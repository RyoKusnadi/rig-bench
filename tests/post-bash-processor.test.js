// Tests for hooks/post-bash-processor.mjs — PostToolUse hook that appends an
// audit line to .claude/bash.log and emits a condensed summary for known
// verbose tools (go test, npm audit, etc). Runs the hook as a real subprocess,
// same convention as tests/pre-tool-gatekeeper.test.js.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir (see
// hooks/lib/hook-utils.mjs repoRoot()) so this never touches the real repo's
// .claude/bash.log.
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
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'post-bash-processor.mjs');

function runHook(input, projectDir) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('appends an audit log line to .claude/bash.log', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const result = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
        tool_response: { exit_code: 0, stdout: 'hello\n' },
      },
      tmp
    );
    assert.equal(result.status, 0);

    const logFile = join(tmp, '.claude', 'bash.log');
    assert.ok(existsSync(logFile), 'expected .claude/bash.log to be created');
    const contents = readFileSync(logFile, 'utf8');
    assert.match(contents, /exit=0 cmd=echo hello/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('go test output produces a condensed summary on stdout', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const goTestOutput = [
      'ok      example.com/pkg/foo   0.012s',
      '--- FAIL: TestBar (0.00s)',
      'FAIL',
      'FAIL    example.com/pkg/bar   0.003s',
    ].join('\n');

    const result = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'go test ./...' },
        tool_response: { exit_code: 1, stdout: goTestOutput },
      },
      tmp
    );
    assert.equal(result.status, 0);

    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(parsed.command, 'go test');
    // Both the bare "FAIL" line and "FAIL    example.com/pkg/bar..." start
    // with ^FAIL, so the hook's count(/^FAIL/gm) regex counts 2, not 1.
    assert.match(parsed.summary, /1 ok, 2 FAIL/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('npm audit output produces a condensed summary on stdout', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const npmAuditOutput = '5 vulnerabilities (2 moderate, 2 high, 1 critical)\n1 critical, 2 high severity vulnerability';
    const result = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'npm audit' },
        tool_response: { exit_code: 1, stdout: npmAuditOutput },
      },
      tmp
    );
    assert.equal(result.status, 0);

    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(parsed.command, 'npm audit');
    assert.match(parsed.summary, /1 critical/);
    assert.match(parsed.summary, /2 high/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a long go test failure line is truncated with an ellipsis marker', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const longFail = `--- FAIL: TestBar (0.00s) ${'x'.repeat(250)}`;
    const goTestOutput = ['ok      example.com/pkg/foo   0.012s', longFail, 'FAIL'].join('\n');

    const result = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'go test ./...' },
        tool_response: { exit_code: 1, stdout: goTestOutput },
      },
      tmp
    );
    assert.equal(result.status, 0);

    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.match(parsed.summary, /\.\.\.$/);
    assert.ok(parsed.summary.length < longFail.length, 'expected the line to be capped, not passed through whole');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-Bash tool_name no-ops (no log write, exit 0)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const result = runHook({ tool_name: 'Read', tool_input: {} }, tmp);
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'bash.log')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('command with no matching verbose-tool pattern produces no JSON summary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-post-bash-'));
  try {
    const result = runHook(
      { tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { exit_code: 0, stdout: 'hi\n' } },
      tmp
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
