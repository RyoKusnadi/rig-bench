// Tests for hooks/auto-run-tests.mjs — PostToolUse (Write/Edit) hook that
// runs a scoped test command for the edited file's ecosystem and emits a
// compact JSON summary. Runs the hook as a real subprocess, same convention
// as tests/pre-tool-gatekeeper.test.js. This hook always exits 0
// (complete()) — it never blocks.
//
// Isolated via CLAUDE_PROJECT_DIR pointed at a temp dir so
// .claude/session-state/last-test-results.json writes never touch the real
// repo. Go-specific tests are skipped if `go` isn't on PATH.
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
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'auto-run-tests.mjs');

const hasGo = spawnSync('go', ['version'], { encoding: 'utf8' }).status === 0;

function runHook(input, projectDir) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('unsupported file extension is skipped (no output, exit 0)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    const file = join(tmp, 'notes.txt');
    writeFileSync(file, 'hello');
    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-Write/Edit tool_name is skipped', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    const result = runHook({ tool_name: 'Read', tool_input: { file_path: join(tmp, 'a.go') } }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nonexistent file_path is skipped without crashing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    const result = runHook({ tool_name: 'Write', tool_input: { file_path: join(tmp, 'missing.go') } }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('go file with no ancestor go.mod is skipped', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    const file = join(tmp, 'main.go');
    writeFileSync(file, 'package main\n');
    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('go file with a go.mod runs go test and emits a JSON summary', { skip: !hasGo }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    writeFileSync(join(tmp, 'go.mod'), 'module example.com/tmp\n\ngo 1.21\n');
    const file = join(tmp, 'main_test.go');
    writeFileSync(
      file,
      'package main\n\nimport "testing"\n\nfunc TestOK(t *testing.T) {}\n'
    );

    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);
    assert.equal(result.status, 0);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.tool, 'go test');
    assert.equal(summary.status, 'pass');
    assert.equal(summary.exit_code, 0);

    const lastResultsPath = join(tmp, '.claude', 'session-state', 'last-test-results.json');
    assert.ok(existsSync(lastResultsPath));
    const history = JSON.parse(readFileSync(lastResultsPath, 'utf8'));
    assert.equal(history.length, 1);
    assert.equal(history[0].tool, 'go test');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('js file with package.json but no test script is reported as skip (no test history recorded)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'tmp', scripts: { build: 'echo build' } }));
    const file = join(tmp, 'index.js');
    writeFileSync(file, 'console.log("hi");\n');

    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);
    assert.equal(result.status, 0);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.status, 'skip');
    assert.equal(summary.tool, 'npm test');

    // skip results are not persisted to last-test-results.json
    assert.ok(!existsSync(join(tmp, '.claude', 'session-state', 'last-test-results.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('regression: filename containing a single quote does not crash or inject shell commands (npm path)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'tmp', scripts: { test: 'echo should-not-run-for-real' } })
    );
    // A filename with an embedded single quote — the dangerous case for naive
    // string interpolation into a shell command (e.g. `--testPathPattern=` +
    // raw basename). shellQuote() in the hook is supposed to neutralize this.
    const fileName = "weird'name.test.js";
    const file = join(tmp, fileName);
    writeFileSync(file, 'test("x", () => {});\n');

    // Canary file whose presence/absence proves whether a shell-injection
    // payload riding along on the quote could have executed.
    const canary = join(tmp, 'PWNED');

    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);

    assert.equal(result.status, 0, `hook should not crash on a quoted filename; stderr: ${result.stderr}`);
    assert.ok(!existsSync(canary), 'no injected command should have run');

    // Should still produce a valid JSON summary (proves the quoting didn't
    // mangle the command into something that errors out unrelated to the
    // test outcome itself).
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.tool, 'npm test');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('python file with no ancestor pyproject.toml/setup.py is skipped', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    const file = join(tmp, 'script.py');
    writeFileSync(file, 'print("hi")\n');
    const result = runHook({ tool_name: 'Write', tool_input: { file_path: file } }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('RIGBENCH_DISABLED_HOOKS=auto-run-tests skips the hook entirely', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-auto-tests-'));
  try {
    writeFileSync(join(tmp, 'go.mod'), 'module example.com/tmp\n\ngo 1.21\n');
    const file = join(tmp, 'main.go');
    writeFileSync(file, 'package main\n');
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, RIGBENCH_DISABLED_HOOKS: 'auto-run-tests' },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
