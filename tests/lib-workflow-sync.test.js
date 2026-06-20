// Guards the two pieces of state that workflows/*.js mirror inline because
// workflow scripts have no filesystem/Node API access and can't `import`
// lib/*.mjs or read config/*.json directly (see lib/agent-wrapper.mjs and
// workflows/research.js's "TIER_MODELS are mirrored everywhere else"
// comments). todo.md High — architecture/consistency: nothing previously
// caught the lib/inline copies drifting apart; these tests are that check.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { safeAgent } from '../lib/agent-wrapper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');

function workflowFiles() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(WORKFLOWS_DIR, f));
}

test('lib/agent-wrapper.mjs default maxRetries matches every workflow\'s inline AGENT_MAX_RETRIES', async () => {
  let calls = 0;
  await safeAgent(
    async () => {
      calls += 1;
      return null; // always fail schema validation to exhaust every retry
    },
    'prompt',
    { schema: {}, label: 'probe' }
    // maxRetries omitted — read safeAgent's own default, not a hardcoded "2"
  );
  const libMaxRetries = calls - 1; // calls = maxRetries + 1 (initial attempt + retries)

  for (const file of workflowFiles()) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/const AGENT_MAX_RETRIES\s*=\s*(\d+)/);
    assert.ok(match, `${file} has no AGENT_MAX_RETRIES constant to compare against lib/agent-wrapper.mjs`);
    assert.equal(
      Number(match[1]),
      libMaxRetries,
      `${file}'s AGENT_MAX_RETRIES (${match[1]}) has drifted from lib/agent-wrapper.mjs's safeAgent default (${libMaxRetries})`
    );
  }
});

test('every workflow\'s inline TIER_MODELS matches config/model-tiers.json', () => {
  const tiers = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'model-tiers.json'), 'utf8'));
  const expected = Object.fromEntries(Object.entries(tiers).map(([tier, cfg]) => [tier, cfg.model]));

  for (const file of workflowFiles()) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/const TIER_MODELS\s*=\s*(\{[^}]*\})/);
    if (!match) continue; // not every workflow necessarily calls models by tier

    // TIER_MODELS is a plain object literal of string:string pairs — safe to
    // recover with a targeted regex rather than a full JS parser.
    const pairs = [...match[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)];
    const actual = Object.fromEntries(pairs.map(([, k, v]) => [k, v]));

    assert.deepEqual(
      actual,
      expected,
      `${file}'s inline TIER_MODELS has drifted from config/model-tiers.json (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
    );
  }
});
