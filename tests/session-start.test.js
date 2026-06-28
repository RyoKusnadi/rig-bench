// Tests for hooks/session-start.mjs — SessionStart hook that injects
// additionalContext from pending instincts, the PreCompact snapshot, and the
// project memory index. Runs the hook as a real subprocess, same convention
// as tests/pre-tool-gatekeeper.test.js. This hook always exits 0 (complete())
// and communicates via the additionalContext JSON shape on stdout.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so this never reads
// the real repo's .claude/instincts, .claude/session-state, or .claude/memory.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'session-start.mjs');

function runHook(input, projectDir, extraEnv = {}) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...extraEnv },
  });
}

function parseContext(result) {
  const out = JSON.parse(result.stdout.trim());
  return out.hookSpecificOutput.additionalContext;
}

test('no state present: exits 0 with no additionalContext output', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const result = runHook({ session_id: 's1', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('injects top pending instincts ranked by occurrence count', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const instinctsDir = join(tmp, '.claude', 'instincts', 'pending');
    mkdirSync(instinctsDir, { recursive: true });
    writeFileSync(
      join(instinctsDir, 'INST-aaa.md'),
      '---\nkeyword: GATE_FAIL\noccurrences: 5\n---\n\n> snippet about gate failures\n'
    );
    writeFileSync(
      join(instinctsDir, 'INST-bbb.md'),
      '---\nkeyword: NO_TESTS\noccurrences: 1\n---\n\n> snippet about missing tests\n'
    );

    const result = runHook({ session_id: 's2', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.match(ctx, /Active Project Instincts/);
    assert.match(ctx, /GATE_FAIL, seen 5x/);
    // Higher-occurrence instinct should appear before the lower one.
    assert.ok(ctx.indexOf('GATE_FAIL') < ctx.indexOf('NO_TESTS'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('injects the PreCompact snapshot when present', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'compact.json'),
      JSON.stringify({
        branch: 'feature/x',
        recent_user_messages: ['fix the bug in foo.js'],
        active_files: ['foo.js'],
        last_test_results: [{ status: 'fail', tool: 'go test' }],
        git_diff_stat: '1 file changed',
      })
    );

    const result = runHook({ session_id: 's3', source: 'compact' }, tmp);
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.match(ctx, /Resumed Context/);
    assert.match(ctx, /Branch: feature\/x/);
    assert.match(ctx, /fix the bug in foo\.js/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('skips a stale PreCompact snapshot past the TTL and logs why', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'compact.json'),
      JSON.stringify({
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        branch: 'feature/old',
        recent_user_messages: ['stale request'],
      })
    );

    const result = runHook({ session_id: 's4', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /Resumed Context/);
    assert.match(result.stderr, /stale/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('malformed compact.json is skipped with a logged warning, not silently', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'compact.json'), '{ not valid json');

    const result = runHook({ session_id: 's5', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /Resumed Context/);
    assert.match(result.stderr, /malformed compact\.json/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('injects the working-set checkpoint wrapped in <working_set_checkpoint> tags', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'working-set-checkpoint.json'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        files: [{ path: 'hooks/sample.mjs', mode: 'full', content: "export const x = 1;\n", diff: '+export const x = 1;' }],
      })
    );

    const result = runHook({ session_id: 'ws1', source: 'compact' }, tmp);
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.match(ctx, /<working_set_checkpoint>/);
    assert.match(ctx, /hooks\/sample\.mjs \(full\)/);
    assert.match(ctx, /export const x = 1;/);
    assert.match(ctx, /<\/working_set_checkpoint>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('skips a stale working-set checkpoint past the TTL', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'working-set-checkpoint.json'),
      JSON.stringify({
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        files: [{ path: 'old.js', mode: 'full', content: 'stale' }],
      })
    );

    const result = runHook({ session_id: 'ws2', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /working_set_checkpoint/);
    assert.match(result.stderr, /working-set-checkpoint\.json is stale/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('injects the structural checkpoint wrapped in <structural_checkpoint> tags', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'structural-checkpoint.json'),
      JSON.stringify({
        generated_at: '2026-01-01T00:00:00.000Z',
        modules: [{ path: 'hooks/sample.mjs', imports: ['node:fs'], exports: ['doThing'] }],
        workflows: [{ path: 'workflows/sample.js', name: 'sample', description: 'does a thing' }],
        agents: [{ path: 'subagents/sample/sample.md', name: 'sample', model_tier: 'standard' }],
      })
    );

    const result = runHook({ session_id: 'sc1', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.match(ctx, /<structural_checkpoint>/);
    assert.match(ctx, /hooks\/sample\.mjs: exports \[doThing\]/);
    assert.match(ctx, /workflows\/sample\.js: sample/);
    assert.match(ctx, /subagents\/sample\/sample\.md: sample \(standard\)/);
    assert.match(ctx, /<\/structural_checkpoint>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('malformed structural-checkpoint.json is skipped with a logged warning', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const stateDir = join(tmp, '.claude', 'session-state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'structural-checkpoint.json'), '{ not valid json');

    const result = runHook({ session_id: 'sc2', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /structural_checkpoint/);
    assert.match(result.stderr, /malformed structural-checkpoint\.json/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('injects the project memory index when present', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const memoryDir = join(tmp, '.claude', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'MEMORY.md'), '# Memory Index\n- some fact');

    const result = runHook({ session_id: 's4', source: 'startup' }, tmp);
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.match(ctx, /Project Memory Index/);
    assert.match(ctx, /some fact/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('truncates output to fit RIGBENCH_SESSION_START_MAX_CHARS', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const memoryDir = join(tmp, '.claude', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'MEMORY.md'), 'x'.repeat(5000));

    const instinctsDir = join(tmp, '.claude', 'instincts', 'pending');
    mkdirSync(instinctsDir, { recursive: true });
    writeFileSync(
      join(instinctsDir, 'INST-ccc.md'),
      '---\nkeyword: GATE_FAIL\noccurrences: 9\n---\n\n> a short snippet\n'
    );

    const result = runHook({ session_id: 's5', source: 'startup' }, tmp, {
      RIGBENCH_SESSION_START_MAX_CHARS: '100',
    });
    assert.equal(result.status, 0);
    const ctx = parseContext(result);
    assert.ok(ctx.length <= 100);
    // Highest-priority section (instincts) survives truncation preference.
    assert.match(ctx, /Active Project Instincts/);
    assert.match(result.stderr, /context truncated/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=session-start skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-session-start-'));
  try {
    const memoryDir = join(tmp, '.claude', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'MEMORY.md'), '# Memory Index');

    const result = runHook({ session_id: 's6', source: 'startup' }, tmp, {
      RIGBENCH_DISABLED_HOOKS: 'session-start',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
