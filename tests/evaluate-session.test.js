// Tests for hooks/evaluate-session.mjs — Stop hook that scans an assistant
// transcript for failure-vocabulary keywords (GATE_FAIL, NO_TESTS, etc.) and
// captures them as instincts under .claude/instincts/pending/. Runs the hook
// as a real subprocess, same convention as tests/pre-tool-gatekeeper.test.js.
// This hook always exits 0 (complete()) — it is purely observational.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so this never writes
// into the real repo's .claude/instincts/.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'evaluate-session.mjs');

function writeTranscript(tmp, lines) {
  const transcriptPath = join(tmp, 'transcript.jsonl');
  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return transcriptPath;
}

function runHook(input, projectDir) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('GATE_FAIL keyword in an assistant message creates a pending instinct', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const transcriptPath = writeTranscript(tmp, [
      { role: 'assistant', content: 'Verdict: GATE_FAIL because tests did not pass.' },
    ]);

    const result = runHook({ transcript_path: transcriptPath, session_id: 'sess-1' }, tmp);
    assert.equal(result.status, 0);

    const instinctsDir = join(tmp, '.claude', 'instincts', 'pending');
    assert.ok(existsSync(instinctsDir));
    const files = readdirSync(instinctsDir);
    assert.equal(files.length, 1);
    const body = readFileSync(join(instinctsDir, files[0]), 'utf8');
    assert.match(body, /keyword: GATE_FAIL/);
    assert.match(body, /occurrences: 1/);
    assert.match(body, /session_id: sess-1/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('NO_TESTS keyword in an assistant message creates a pending instinct', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const transcriptPath = writeTranscript(tmp, [
      { role: 'assistant', content: 'NO_TESTS were added for this change.' },
    ]);

    const result = runHook({ transcript_path: transcriptPath, session_id: 'sess-2' }, tmp);
    assert.equal(result.status, 0);

    const instinctsDir = join(tmp, '.claude', 'instincts', 'pending');
    const files = readdirSync(instinctsDir);
    assert.equal(files.length, 1);
    const body = readFileSync(join(instinctsDir, files[0]), 'utf8');
    assert.match(body, /keyword: NO_TESTS/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('re-seeing the same keyword+snippet increments occurrences on the existing instinct', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const transcriptPath = writeTranscript(tmp, [
      { role: 'assistant', content: 'Verdict: GATE_FAIL because tests did not pass.' },
    ]);

    let result = runHook({ transcript_path: transcriptPath, session_id: 'sess-3' }, tmp);
    assert.equal(result.status, 0);
    result = runHook({ transcript_path: transcriptPath, session_id: 'sess-3' }, tmp);
    assert.equal(result.status, 0);

    const instinctsDir = join(tmp, '.claude', 'instincts', 'pending');
    const files = readdirSync(instinctsDir);
    assert.equal(files.length, 1, 'expected the second run to update the same instinct file, not create a new one');
    const body = readFileSync(join(instinctsDir, files[0]), 'utf8');
    assert.match(body, /occurrences: 2/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('transcript with no failure keywords creates no instincts', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const transcriptPath = writeTranscript(tmp, [{ role: 'assistant', content: 'All tests passed, looks good.' }]);

    const result = runHook({ transcript_path: transcriptPath, session_id: 'sess-4' }, tmp);
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'instincts', 'pending')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing transcript_path exits 0 without crashing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const result = runHook({ session_id: 'sess-5' }, tmp);
    assert.equal(result.status, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=evaluate-session skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-eval-session-'));
  try {
    const transcriptPath = writeTranscript(tmp, [{ role: 'assistant', content: 'GATE_FAIL happened.' }]);
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: transcriptPath, session_id: 'sess-6' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, RIGBENCH_DISABLED_HOOKS: 'evaluate-session' },
    });
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'instincts')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
