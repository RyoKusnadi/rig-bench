// Tests for scripts/report.mjs — aggregates telemetry/runs/*.jsonl into a
// console-printed summary (avg cost per workflow, top stages by tokens,
// escalation frequency, outcome breakdown). report.mjs resolves
// telemetry/runs relative to its own file location (one level up from
// scripts/), so we can't redirect it to a temp dir without an env var the
// script doesn't support — instead we drive the real
// `<repoRoot>/telemetry/runs/` directory (gitignored, see .gitignore),
// snapshotting and restoring its contents around each test so we never lose
// real telemetry.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'report.mjs');
const RUNS_DIR = join(REPO_ROOT, 'telemetry', 'runs');

function runReport() {
  return spawnSync('node', [SCRIPT_PATH], { encoding: 'utf8' });
}

// Move any pre-existing telemetry/runs/*.jsonl files aside into a temp dir,
// run `fn`, then move them back — so the real directory is empty (or
// removed) during the test and untouched afterward.
function withEmptyRunsDir(fn) {
  const backupDir = mkdtempSync(join(tmpdir(), 'rigbench-runs-backup-'));
  const hadDir = existsSync(RUNS_DIR);
  let existingFiles = [];
  if (hadDir) {
    existingFiles = readdirSync(RUNS_DIR);
    for (const f of existingFiles) {
      writeFileSync(join(backupDir, f), readFileSync(join(RUNS_DIR, f)));
    }
    rmSync(RUNS_DIR, { recursive: true, force: true });
  }
  try {
    return fn();
  } finally {
    rmSync(RUNS_DIR, { recursive: true, force: true });
    if (hadDir) {
      mkdirSync(RUNS_DIR, { recursive: true });
      for (const f of existingFiles) {
        writeFileSync(join(RUNS_DIR, f), readFileSync(join(backupDir, f)));
      }
    }
    rmSync(backupDir, { recursive: true, force: true });
  }
}

test('no telemetry directory: prints "no telemetry found" message', () => {
  withEmptyRunsDir(() => {
    const result = runReport();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No telemetry found under telemetry\/runs\//);
  });
});

test('aggregates run_summary entries into per-workflow average tokens and outcomes', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    const lines = [
      JSON.stringify({ event: 'run_summary', workflow_name: 'research', total_output_tokens: 100, outcome: 'PASSED' }),
      JSON.stringify({ event: 'run_summary', workflow_name: 'research', total_output_tokens: 300, outcome: 'PASSED' }),
      JSON.stringify({ event: 'run_summary', workflow_name: 'autotune', total_output_tokens: 50, outcome: 'FAILED' }),
    ];
    writeFileSync(join(RUNS_DIR, 'a.jsonl'), lines.join('\n') + '\n');

    const result = runReport();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Average output-token cost per workflow ===/);
    assert.match(result.stdout, /research: 2 run\(s\), avg 200 tokens, outcomes: \{"PASSED":2\}/);
    assert.match(result.stdout, /autotune: 1 run\(s\), avg 50 tokens, outcomes: \{"FAILED":1\}/);
    assert.match(result.stdout, /=== Outcome breakdown \(all workflows\) ===/);
    assert.match(result.stdout, /PASSED: 2/);
    assert.match(result.stdout, /FAILED: 1/);
  });
});

test('ranks stages by total output tokens, top 10 only, descending', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    const lines = [
      JSON.stringify({ label: 'plan', output_tokens: 10 }),
      JSON.stringify({ label: 'plan', output_tokens: 20 }),
      JSON.stringify({ label: 'execute', output_tokens: 500 }),
    ];
    writeFileSync(join(RUNS_DIR, 'b.jsonl'), lines.join('\n') + '\n');

    const result = runReport();
    assert.match(result.stdout, /=== Top stages by total output tokens ===/);
    const executeIdx = result.stdout.indexOf('execute: 500');
    const planIdx = result.stdout.indexOf('plan: 30');
    assert.ok(executeIdx !== -1, 'expected execute total of 500');
    assert.ok(planIdx !== -1, 'expected plan total of 30 (10+20)');
    assert.ok(executeIdx < planIdx, 'execute (higher tokens) should be listed before plan');
  });
});

test('reports escalation events grouped by state', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    const lines = [
      JSON.stringify({ event: 'escalation', state: 'review' }),
      JSON.stringify({ event: 'escalation', state: 'review' }),
      JSON.stringify({ event: 'escalation', state: 'plan' }),
    ];
    writeFileSync(join(RUNS_DIR, 'c.jsonl'), lines.join('\n') + '\n');

    const result = runReport();
    assert.match(result.stdout, /=== Escalation events ===/);
    assert.match(result.stdout, /review: escalated 2 time\(s\)/);
    assert.match(result.stdout, /plan: escalated 1 time\(s\)/);
  });
});

test('no escalation events: prints "None recorded" message', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(
      join(RUNS_DIR, 'd.jsonl'),
      JSON.stringify({ event: 'run_summary', workflow_name: 'x', total_output_tokens: 1, outcome: 'PASSED' }) + '\n'
    );

    const result = runReport();
    assert.match(result.stdout, /None recorded — every stage stayed on its default tier\./);
  });
});

test('skips malformed JSON lines without crashing', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    const content = [
      'not valid json {{{',
      JSON.stringify({ event: 'run_summary', workflow_name: 'research', total_output_tokens: 42, outcome: 'PASSED' }),
      '',
    ].join('\n');
    writeFileSync(join(RUNS_DIR, 'e.jsonl'), content);

    const result = runReport();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /research: 1 run\(s\), avg 42 tokens/);
  });
});

test('reads multiple .jsonl files and ignores non-.jsonl files', () => {
  withEmptyRunsDir(() => {
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(
      join(RUNS_DIR, 'f1.jsonl'),
      JSON.stringify({ event: 'run_summary', workflow_name: 'a', total_output_tokens: 10, outcome: 'PASSED' }) + '\n'
    );
    writeFileSync(
      join(RUNS_DIR, 'f2.jsonl'),
      JSON.stringify({ event: 'run_summary', workflow_name: 'b', total_output_tokens: 20, outcome: 'PASSED' }) + '\n'
    );
    writeFileSync(join(RUNS_DIR, 'ignore.txt'), 'should not be read');

    const result = runReport();
    assert.match(result.stdout, /a: 1 run\(s\), avg 10 tokens/);
    assert.match(result.stdout, /b: 1 run\(s\), avg 20 tokens/);
  });
});
