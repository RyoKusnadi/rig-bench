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
import { spawnSync, execSync } from 'node:child_process';
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

test('writes a working-set-checkpoint.json with full content for small active files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    execSync('git init -q', { cwd: tmp });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', { cwd: tmp });
    writeFileSync(join(tmp, 'small.js'), 'export const x = 1;\n');
    execSync('git add small.js', { cwd: tmp });

    const result = runHook({ compaction_type: 'manual', reason: '' }, tmp);
    assert.equal(result.status, 0);

    const wsPath = join(tmp, '.claude', 'session-state', 'working-set-checkpoint.json');
    assert.ok(existsSync(wsPath));
    const ws = JSON.parse(readFileSync(wsPath, 'utf8'));
    assert.equal(ws.files.length, 1);
    assert.equal(ws.files[0].path, 'small.js');
    assert.equal(ws.files[0].mode, 'full');
    assert.equal(ws.files[0].content, 'export const x = 1;\n');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('working-set-checkpoint.json uses signature mode for files over 200 lines', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    execSync('git init -q', { cwd: tmp });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', { cwd: tmp });
    const big = Array.from({ length: 250 }, (_, i) => `// line ${i}`).join('\n') + '\nexport function bigFn() {}\n';
    writeFileSync(join(tmp, 'big.js'), big);
    execSync('git add big.js', { cwd: tmp });

    const result = runHook({ compaction_type: 'manual', reason: '' }, tmp);
    assert.equal(result.status, 0);

    const ws = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'working-set-checkpoint.json'), 'utf8'));
    assert.equal(ws.files[0].mode, 'signatures');
    assert.ok(ws.files[0].signatures.some((s) => s.includes('bigFn')));
    assert.equal(ws.files[0].content, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('working-set-checkpoint.json skips a deleted active file without crashing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-pre-compact-'));
  try {
    execSync('git init -q', { cwd: tmp });
    writeFileSync(join(tmp, 'gone.js'), 'export const y = 1;\n');
    execSync('git add gone.js', { cwd: tmp });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: tmp });
    rmSync(join(tmp, 'gone.js'));

    const result = runHook({ compaction_type: 'manual', reason: '' }, tmp);
    assert.equal(result.status, 0);

    const ws = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'working-set-checkpoint.json'), 'utf8'));
    assert.deepEqual(ws.files, []);
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
