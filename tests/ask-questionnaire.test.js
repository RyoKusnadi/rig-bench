// Tests for scripts/ask-questionnaire.mjs.
//
// parseTemplateYaml() is exported and tested directly via import — it's a
// hand-rolled parser for the constrained YAML subset used by
// intake/research-questionnaire.yaml (one level of nested mapping, scalars,
// quoted strings, numbers, flow-style `[]` arrays, comments).
//
// main() itself (file I/O, interactive prompting, schema validation, and
// writing research/{topic}/intake.json) is exercised as a subprocess via
// spawnSync, using `--file` to point at fixture YAML files in a temp dir
// and a non-TTY stdin (spawnSync's stdin is never a TTY) so the script
// skips interactive prompting and validates/writes immediately — same
// pattern as tests/pre-tool-gatekeeper.test.js.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseTemplateYaml } from '../scripts/ask-questionnaire.mjs';
import { withResearchDirLock } from './helpers/memory-db-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'ask-questionnaire.mjs');

// ── parseTemplateYaml() ────────────────────────────────────────────────────

test('parseTemplateYaml: parses top-level empty string scalar', () => {
  const result = parseTemplateYaml('topic: ""\n');
  assert.equal(result.topic, '');
});

test('parseTemplateYaml: parses quoted string scalar, stripping quotes', () => {
  const result = parseTemplateYaml('topic: "React Redux"\n');
  assert.equal(result.topic, 'React Redux');
});

test('parseTemplateYaml: parses unquoted string scalar', () => {
  const result = parseTemplateYaml('target_outcome: implementation_guide\n');
  assert.equal(result.target_outcome, 'implementation_guide');
});

test('parseTemplateYaml: parses integer and float numbers', () => {
  const result = parseTemplateYaml('max_iterations: 5\nvalidation_threshold: 0.85\n');
  assert.equal(result.max_iterations, 5);
  assert.equal(typeof result.max_iterations, 'number');
  assert.equal(result.validation_threshold, 0.85);
  assert.equal(typeof result.validation_threshold, 'number');
});

test('parseTemplateYaml: parses flow-style array of bare words', () => {
  const result = parseTemplateYaml('focus_areas: [async middleware, tooling setup]\n');
  assert.deepEqual(result.focus_areas, ['async middleware', 'tooling setup']);
});

test('parseTemplateYaml: parses empty flow-style array', () => {
  const result = parseTemplateYaml('focus_areas: []\n');
  assert.deepEqual(result.focus_areas, []);
});

test('parseTemplateYaml: parses quoted strings inside a flow array', () => {
  const result = parseTemplateYaml('must_include: ["official docs", "GitHub examples"]\n');
  assert.deepEqual(result.must_include, ['official docs', 'GitHub examples']);
});

test('parseTemplateYaml: parses one level of nested mapping', () => {
  const text = [
    'constraints:',
    '  tech_stack: []',
    '  version_policy: "latest_stable"',
  ].join('\n');
  const result = parseTemplateYaml(text);
  assert.deepEqual(result.constraints, { tech_stack: [], version_policy: 'latest_stable' });
});

test('parseTemplateYaml: ignores full-line comments', () => {
  const text = [
    '# This is a comment',
    'topic: "x"',
    '# Another comment',
  ].join('\n');
  const result = parseTemplateYaml(text);
  assert.deepEqual(result, { topic: 'x' });
});

test('parseTemplateYaml: strips trailing inline comments from scalar values', () => {
  const result = parseTemplateYaml('depth: "moderate_detail" # one of: high_level_overview | moderate_detail\n');
  assert.equal(result.depth, 'moderate_detail');
});

test('parseTemplateYaml: strips trailing inline comments from nested scalar values', () => {
  const text = [
    'constraints:',
    '  version_policy: "latest_stable" # one of: latest_stable | lts_only',
  ].join('\n');
  const result = parseTemplateYaml(text);
  assert.equal(result.constraints.version_policy, 'latest_stable');
});

test('parseTemplateYaml: full research-questionnaire.yaml shape parses end to end', () => {
  const text = [
    'topic: ""',
    'focus_areas: []',
    'current_baseline: ""',
    'target_outcome: "implementation_guide"',
    'constraints:',
    '  tech_stack: []',
    '  version_policy: "latest_stable"',
    '  must_include: []',
    '  must_exclude: []',
    'depth: "moderate_detail"',
    'validation_threshold: 0.85',
    'max_iterations: 5',
  ].join('\n');
  const result = parseTemplateYaml(text);
  assert.deepEqual(result, {
    topic: '',
    focus_areas: [],
    current_baseline: '',
    target_outcome: 'implementation_guide',
    constraints: {
      tech_stack: [],
      version_policy: 'latest_stable',
      must_include: [],
      must_exclude: [],
    },
    depth: 'moderate_detail',
    validation_threshold: 0.85,
    max_iterations: 5,
  });
});

test('parseTemplateYaml: blank lines are skipped', () => {
  const text = '\ntopic: "x"\n\n\nmax_iterations: 1\n';
  const result = parseTemplateYaml(text);
  assert.deepEqual(result, { topic: 'x', max_iterations: 1 });
});

// ── main() via subprocess ──────────────────────────────────────────────────

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rigbench-questionnaire-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function validYamlFixture(topic = 'React Redux state management') {
  return [
    `topic: "${topic}"`,
    'focus_areas: [async middleware]',
    'current_baseline: "knows React hooks"',
    'target_outcome: "implementation_guide"',
    'constraints:',
    '  tech_stack: [React 19]',
    '  version_policy: "latest_stable"',
    '  must_include: []',
    '  must_exclude: []',
    'depth: "moderate_detail"',
    'validation_threshold: 0.85',
    'max_iterations: 5',
  ].join('\n');
}

test('main: missing --file template path exits 1 with an error', () => {
  withTempDir((dir) => {
    const templatePath = join(dir, 'does-not-exist.yaml');
    const result = spawnSync('node', [SCRIPT_PATH, '--file', templatePath], {
      encoding: 'utf8',
      input: '',
      cwd: dir,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Template not found/);
  });
});

test('main: valid filled-in template writes research/{slug}/intake.json relative to repo root', () => {
  // The script resolves `root` from its own file location (scripts/../),
  // so research/{slug}/ is always created under the real repo root — clean
  // up the directory this test creates afterward. tests/ingest-memory.test.js
  // also creates/removes directories under research/, so hold the shared
  // lock for the duration (see tests/helpers/memory-db-lock.mjs).
  withResearchDirLock(() => {
    const topic = `Test Topic ${Date.now()}`;
    const slug = topic.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const researchDir = join(REPO_ROOT, 'research');
    const researchDirPreexisted = existsSync(researchDir);
    const outDir = join(researchDir, slug);
    withTempDir((dir) => {
      const templatePath = join(dir, 'template.yaml');
      writeFileSync(templatePath, validYamlFixture(topic));

      try {
        const result = spawnSync('node', [SCRIPT_PATH, '--file', templatePath], {
          encoding: 'utf8',
          input: '',
        });
        assert.equal(result.status, 0, result.stderr);
        const outPath = join(outDir, 'intake.json');
        assert.ok(existsSync(outPath), 'expected intake.json to be written');
        const written = JSON.parse(readFileSync(outPath, 'utf8'));
        assert.equal(written.topic, topic);
        assert.equal(written.target_outcome, 'implementation_guide');
      } finally {
        rmSync(outDir, { recursive: true, force: true });
        // Clean up the parent research/ dir too if this test created it.
        if (!researchDirPreexisted && existsSync(researchDir) && readdirSync(researchDir).length === 0) {
          rmSync(researchDir, { recursive: true, force: true });
        }
      }
    });
  });
});

test('main: template failing schema validation exits 1 and reports errors', () => {
  withTempDir((dir) => {
    const templatePath = join(dir, 'template.yaml');
    // Invalid: target_outcome is not one of the allowed enum values.
    const text = [
      'topic: "x"',
      'focus_areas: [a]',
      'target_outcome: "not_a_real_outcome"',
      'constraints:',
      '  version_policy: "latest_stable"',
      'depth: "moderate_detail"',
      'validation_threshold: 0.85',
      'max_iterations: 5',
    ].join('\n');
    writeFileSync(templatePath, text);

    const result = spawnSync('node', [SCRIPT_PATH, '--file', templatePath], {
      encoding: 'utf8',
      input: '',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Intake failed schema validation/);
  });
});

test('main: template missing topic exits 1 with a "no topic" error even if otherwise valid', () => {
  withTempDir((dir) => {
    const templatePath = join(dir, 'template.yaml');
    // topic stays "" and stdin is non-TTY so it's never filled in
    // interactively; schema requires topic as a string (empty string still
    // satisfies type:string) so it passes schema validation but fails the
    // explicit `!intake.topic` check afterward.
    const text = [
      'topic: ""',
      'focus_areas: [a]',
      'target_outcome: "implementation_guide"',
      'constraints:',
      '  version_policy: "latest_stable"',
      'depth: "moderate_detail"',
      'validation_threshold: 0.85',
      'max_iterations: 5',
    ].join('\n');
    writeFileSync(templatePath, text);

    const result = spawnSync('node', [SCRIPT_PATH, '--file', templatePath], {
      encoding: 'utf8',
      input: '',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No topic provided/);
  });
});
