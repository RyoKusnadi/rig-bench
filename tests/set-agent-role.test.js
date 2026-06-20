// Tests for scripts/set-agent-role.mjs — writes/clears the
// .claude/hook-state/agent-role.json file that hooks/pre-tool-gatekeeper.mjs
// reads to enforce RBAC for the research role. The script resolves its
// target root from process.env.CLAUDE_PROJECT_DIR (falling back to cwd), so
// we point it at a temp directory via that env var rather than touching the
// real repo's .claude/hook-state/agent-role.json.
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
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'set-agent-role.mjs');

function withTempProjectDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rigbench-agent-role-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runScript(args, projectDir) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test('research: writes agent-role.json with role, set_at, ttl_ms', () => {
  withTempProjectDir((dir) => {
    const result = runScript(['research'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent role set to 'research' \(expires in 30m unless cleared first\)/);

    const roleFile = join(dir, '.claude', 'hook-state', 'agent-role.json');
    assert.ok(existsSync(roleFile), 'expected agent-role.json to be created');
    const parsed = JSON.parse(readFileSync(roleFile, 'utf8'));
    assert.equal(parsed.role, 'research');
    assert.equal(parsed.ttl_ms, 30 * 60 * 1000);
    assert.ok(typeof parsed.set_at === 'string' && !Number.isNaN(Date.parse(parsed.set_at)), 'set_at should be a valid ISO date string');
  });
});

test('clear: removes an existing agent-role.json', () => {
  withTempProjectDir((dir) => {
    runScript(['research'], dir);
    const roleFile = join(dir, '.claude', 'hook-state', 'agent-role.json');
    assert.ok(existsSync(roleFile), 'precondition: role file should exist before clearing');

    const result = runScript(['clear'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent role cleared/);
    assert.ok(!existsSync(roleFile), 'expected agent-role.json to be removed');
  });
});

test('clear: no-op (still exits 0) when no agent-role.json exists', () => {
  withTempProjectDir((dir) => {
    const roleFile = join(dir, '.claude', 'hook-state', 'agent-role.json');
    assert.ok(!existsSync(roleFile), 'precondition: role file should not exist');

    const result = runScript(['clear'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent role cleared/);
  });
});

test('unknown command prints usage and exits 1', () => {
  withTempProjectDir((dir) => {
    const result = runScript(['bogus'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage: node scripts\/set-agent-role\.mjs <research\|clear>/);
  });
});

test('no command prints usage and exits 1', () => {
  withTempProjectDir((dir) => {
    const result = runScript([], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage: node scripts\/set-agent-role\.mjs <research\|clear>/);
  });
});
