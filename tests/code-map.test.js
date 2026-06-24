// Tests for scripts/code-map.mjs — Tier 1 of the Code Checkpoint
// Architecture. Walks a fixture repo
// and asserts the regex-based import/export/meta extraction produces the
// expected structural-checkpoint.json shape. Runs the script as a real
// subprocess against a temp dir built to look like rig-bench's layout
// (CLAUDE_PROJECT_DIR is honored the same way it is by hooks/lib/hook-utils.mjs
// when the script is invoked directly — see repoRoot()'s fallback, which
// code-map.mjs does NOT use since it always resolves root from its own file
// location, so tests pass an explicit cwd-relative fixture dir as root instead).
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_SRC = join(REPO_ROOT, 'scripts', 'code-map.mjs');

// code-map.mjs resolves its own root from import.meta.url (two levels up
// from scripts/code-map.mjs), not from CLAUDE_PROJECT_DIR — so to point it
// at a fixture, copy the script itself into a fixture repo's scripts/ dir.
function buildFixture(tmp) {
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT_SRC, join(tmp, 'scripts', 'code-map.mjs'));
  return join(tmp, 'scripts', 'code-map.mjs');
}

function runScript(scriptPath) {
  return spawnSync('node', [scriptPath], { encoding: 'utf8' });
}

test('extracts named and listed exports plus static/dynamic imports from a module', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-code-map-'));
  try {
    const scriptPath = buildFixture(tmp);
    mkdirSync(join(tmp, 'hooks'), { recursive: true });
    writeFileSync(
      join(tmp, 'hooks', 'sample.mjs'),
      [
        "import { readFileSync } from 'node:fs';",
        "import helper from './helper.mjs';",
        "const lazy = await import('./lazy.mjs');",
        '',
        'export function doThing() {}',
        'export class Thing {}',
        'const a = 1, b = 2;',
        'export { a, b as renamedB };',
        '',
      ].join('\n')
    );

    const result = runScript(scriptPath);
    assert.equal(result.status, 0);

    const checkpoint = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'structural-checkpoint.json'), 'utf8'));
    const mod = checkpoint.modules.find((m) => m.path === 'hooks/sample.mjs');
    assert.ok(mod, 'expected hooks/sample.mjs to be in the module list');
    assert.deepEqual(mod.exports.sort(), ['Thing', 'a', 'doThing', 'renamedB']);
    assert.deepEqual(mod.imports.sort(), ['./helper.mjs', './lazy.mjs', 'node:fs']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('extracts workflow meta.name and meta.description', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-code-map-'));
  try {
    const scriptPath = buildFixture(tmp);
    mkdirSync(join(tmp, 'workflows'), { recursive: true });
    writeFileSync(
      join(tmp, 'workflows', 'sample.js'),
      "export const meta = {\n  name: 'sample',\n  description: 'does a thing',\n  phases: [],\n}\n"
    );

    const result = runScript(scriptPath);
    assert.equal(result.status, 0);

    const checkpoint = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'structural-checkpoint.json'), 'utf8'));
    assert.deepEqual(checkpoint.workflows, [{ path: 'workflows/sample.js', name: 'sample', description: 'does a thing' }]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('extracts agent frontmatter name/model_tier and the first line of a block-scalar description', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-code-map-'));
  try {
    const scriptPath = buildFixture(tmp);
    mkdirSync(join(tmp, 'subagents', 'sample'), { recursive: true });
    writeFileSync(
      join(tmp, 'subagents', 'sample', 'sample.md'),
      '---\nname: sample\ndescription: |\n  First line of the blurb.\n  Second line.\nmodel_tier: standard\n---\n\nBody.\n'
    );

    const result = runScript(scriptPath);
    assert.equal(result.status, 0);

    const checkpoint = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'structural-checkpoint.json'), 'utf8'));
    assert.deepEqual(checkpoint.agents, [
      { path: 'subagents/sample/sample.md', name: 'sample', description: 'First line of the blurb.', model_tier: 'standard' },
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fixture with no workflows/ or subagents/ dirs produces empty arrays for those, not a crash', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rigbench-code-map-'));
  try {
    const scriptPath = buildFixture(tmp);
    const result = runScript(scriptPath);
    assert.equal(result.status, 0);

    const checkpoint = JSON.parse(readFileSync(join(tmp, '.claude', 'session-state', 'structural-checkpoint.json'), 'utf8'));
    // The fixture's own scripts/code-map.mjs (copied in by buildFixture) is
    // itself a module under scripts/, so it shows up here — only
    // workflows/subagents are genuinely absent in this fixture.
    assert.deepEqual(checkpoint.modules.map((m) => m.path), ['scripts/code-map.mjs']);
    assert.deepEqual(checkpoint.workflows, []);
    assert.deepEqual(checkpoint.agents, []);
    assert.ok(checkpoint.generated_at);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
