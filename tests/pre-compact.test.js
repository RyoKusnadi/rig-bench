// Tests for hooks/pre-compact.mjs — PreCompact hook that snapshots git
// branch/diff/active-files plus recent user messages and last test results
// into .claude/session-state/compact.json. Runs the hook as a real
// subprocess, same convention as tests/pre-tool-gatekeeper.test.js. This hook
// always exits 0 (complete()) — it is observation-only.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so this never writes
// into the real repo's .claude/session-state/. The temp dir is not a git
// repo, so git commands inside the hook fail and leave branch/diff blank —
// that's intentional coverage of the "not a git repo" fallback path.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'pre-compact.mjs');

function runHook(input, projectDir) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('writes compact.json snapshot with compaction_type and reason', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    const result = runHook({ compaction_type: 'manual', reason: 'user requested' }, tmp);
    assert.equal(result.status, 0);

    const snapshotPath = join(tmp, '.claude', 'session-state', 'compact.json');
    assert.ok(existsSync(snapshotPath));
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.equal(snapshot.compaction_type, 'manual');
    assert.equal(snapshot.reason, 'user requested');
    assert.ok(Array.isArray(snapshot.active_files));
    assert.ok(Array.isArray(snapshot.last_test_results));
    assert.ok(Array.isArray(snapshot.recent_user_messages));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('folds in last-test-results.json if present', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'last-test-results.json'),
      JSON.stringify([{ status: 'pass', tool: 'go test' }])
    );

    const result = runHook({ compaction_type: 'auto', reason: '' }, tmp);
    assert.equal(result.status, 0);

    const snapshot = JSON.parse(readFileSync(join(stateDir, 'compact.json'), 'utf8'));
    assert.deepEqual(snapshot.last_test_results, [{ status: 'pass', tool: 'go test' }]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('extracts recent user messages from a transcript file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    const transcriptPath = join(tmp, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ role: 'user', content: 'please fix the bug' }),
      JSON.stringify({ role: 'assistant', content: 'working on it' }),
      JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'also add a test' }] }),
    ];
    writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const result = runHook({ compaction_type: 'manual', reason: '', transcript_path: transcriptPath }, tmp);
    assert.equal(result.status, 0);

    const snapshot = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'compact.json'), 'utf8'));
    assert.deepEqual(snapshot.recent_user_messages, ['please fix the bug', 'also add a test']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing transcript_path leaves recent_user_messages empty without crashing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    const result = runHook({ compaction_type: 'manual', reason: '' }, tmp);
    assert.equal(result.status, 0);
    const snapshot = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'compact.json'), 'utf8'));
    assert.deepEqual(snapshot.recent_user_messages, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=pre-compact skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ compaction_type: 'manual', reason: '' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, RIGBENCH_DISABLED_HOOKS: 'pre-compact' },
    });
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(tmp, '.claude', 'session-state', 'compact.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
