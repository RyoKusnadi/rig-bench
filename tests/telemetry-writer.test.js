// Tests for hooks/telemetry-writer.mjs — PostToolUse (matcher: Workflow) hook
// that writes a JSONL run log under telemetry/runs/. Runs the hook as a real
// subprocess, same convention as tests/pre-tool-gatekeeper.test.js.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so this never writes
// into the real repo's telemetry/runs/.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'telemetry-writer.mjs');

function runHook(input, projectDir) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('writes a JSONL file to telemetry/runs/ for a Workflow tool_response', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-telemetry-'));
  try {
    const result = runHook(
      {
        tool_name: 'Workflow',
        tool_input: { name: 'research' },
        tool_response: {
          result: {
            pipeline: 'research',
            outcome: 'success',
            token_telemetry: [{ label: 'stage-1', tokens: 123 }],
            escalations: [{ state: 'low-confidence', from: 'tier1', to: 'tier2', reason: 'ambiguous' }],
          },
        },
      },
      tmp
    );
    assert.equal(result.status, 0);

    const runsDir = join(tmp, 'telemetry', 'runs');
    assert.ok(existsSync(runsDir), 'expected telemetry/runs/ to be created');
    const files = readdirSync(runsDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /-research\.jsonl$/);

    const lines = readFileSync(join(runsDir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3); // 1 token_telemetry entry + 1 escalation + 1 run_summary

    const tokenLine = lines.find((l) => l.label === 'stage-1');
    assert.ok(tokenLine);
    assert.equal(tokenLine.output_tokens, 123);
    assert.equal(tokenLine.workflow_name, 'research');

    const escLine = lines.find((l) => l.event === 'escalation');
    assert.ok(escLine);
    assert.equal(escLine.from_tier, 'tier1');
    assert.equal(escLine.to_tier, 'tier2');

    const summaryLine = lines.find((l) => l.event === 'run_summary');
    assert.ok(summaryLine);
    assert.equal(summaryLine.total_output_tokens, 123);
    assert.equal(summaryLine.escalation_count, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('no-ops for non-Workflow tool_name (no telemetry directory created)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-telemetry-'));
  try {
    const result = runHook({ tool_name: 'Bash', tool_input: {}, tool_response: {} }, tmp);
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, 'telemetry')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Workflow result with no token_telemetry/escalations still writes a run_summary line', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-telemetry-'));
  try {
    const result = runHook(
      {
        tool_name: 'Workflow',
        tool_input: { name: 'bare' },
        tool_response: { result: { pipeline: 'bare', outcome: 'success' } },
      },
      tmp
    );
    assert.equal(result.status, 0);
    const runsDir = join(tmp, 'telemetry', 'runs');
    const files = readdirSync(runsDir);
    assert.equal(files.length, 1);
    const lines = readFileSync(join(runsDir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].event, 'run_summary');
    assert.equal(lines[0].escalation_count, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=telemetry-writer skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-telemetry-'));
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({
        tool_name: 'Workflow',
        tool_input: { name: 'research' },
        tool_response: { result: { pipeline: 'research', outcome: 'success' } },
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, RIGBENCH_DISABLED_HOOKS: 'telemetry-writer' },
    });
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, 'telemetry')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
