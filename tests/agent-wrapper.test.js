// Direct unit tests for lib/agent-wrapper.mjs's safeAgent()/
// buildCorrectionPrompt() behavior, enforcing zero-tolerance for schema
// failures. The cross-file drift check against workflows/*.js's
// inline AGENT_MAX_RETRIES mirror lives in tests/lib-workflow-sync.test.js —
// this file only exercises safeAgent's own retry/correction-prompt logic in
// isolation.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeAgent, buildCorrectionPrompt } from '../lib/agent-wrapper.mjs';

// ── buildCorrectionPrompt() ──────────────────────────────────────────────

test('buildCorrectionPrompt: includes the original prompt verbatim', () => {
  const prompt = buildCorrectionPrompt('do the thing', { type: 'object' });
  assert.match(prompt, /^do the thing/);
});

test('buildCorrectionPrompt: includes the schema as JSON', () => {
  const schema = { type: 'object', required: ['agent'], properties: { agent: { const: 'researcher' } } };
  const prompt = buildCorrectionPrompt('do the thing', schema);
  assert.ok(prompt.includes(JSON.stringify(schema)));
});

test('buildCorrectionPrompt: includes the [SYSTEM CORRECTION] marker and no-markdown instruction', () => {
  const prompt = buildCorrectionPrompt('do the thing', {});
  assert.match(prompt, /\[SYSTEM CORRECTION\]/);
  assert.match(prompt, /must output a valid JSON object matching this exact schema/);
  assert.match(prompt, /Do not include any markdown formatting outside the JSON\./);
});

// ── safeAgent(): success paths ───────────────────────────────────────────

test('safeAgent: returns the result immediately on first-attempt success without retrying', async () => {
  let calls = 0;
  const callAgent = async () => {
    calls += 1;
    return { ok: true };
  };
  const result = await safeAgent(callAgent, 'prompt', { schema: {}, label: 'probe' });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 1);
});

test('safeAgent: retries after a null result and succeeds on attempt 2', async () => {
  let calls = 0;
  const seenPrompts = [];
  const seenOpts = [];
  const callAgent = async (prompt, opts) => {
    calls += 1;
    seenPrompts.push(prompt);
    seenOpts.push(opts);
    return calls < 2 ? null : { ok: true, attempt: calls };
  };
  const schema = { type: 'object' };
  const result = await safeAgent(callAgent, 'original prompt', { schema, label: 'probe' });

  assert.deepEqual(result, { ok: true, attempt: 2 });
  assert.equal(calls, 2);
  // First attempt uses the original prompt and opts untouched.
  assert.equal(seenPrompts[0], 'original prompt');
  assert.deepEqual(seenOpts[0], { schema, label: 'probe' });
  // Retry attempt uses the correction prompt and a relabeled opts object.
  assert.match(seenPrompts[1], /\[SYSTEM CORRECTION\]/);
  assert.equal(seenOpts[1].label, 'probe-retry1');
});

// ── safeAgent(): exhaustion path ─────────────────────────────────────────

test('safeAgent: returns null after exhausting all retries (default maxRetries)', async () => {
  let calls = 0;
  const callAgent = async () => {
    calls += 1;
    return null;
  };
  const result = await safeAgent(callAgent, 'prompt', { schema: {}, label: 'probe' });
  assert.equal(result, null);
  assert.equal(calls, 3); // default maxRetries = 2 -> initial attempt + 2 retries
});

test('safeAgent: respects a custom maxRetries argument', async () => {
  let calls = 0;
  const callAgent = async () => {
    calls += 1;
    return null;
  };
  const result = await safeAgent(callAgent, 'prompt', { schema: {}, label: 'probe' }, 0);
  assert.equal(result, null);
  assert.equal(calls, 1); // maxRetries = 0 -> only the initial attempt, no retries
});

test('safeAgent: with maxRetries = 4, retries up to 4 times before giving up', async () => {
  let calls = 0;
  const callAgent = async () => {
    calls += 1;
    return null;
  };
  const result = await safeAgent(callAgent, 'prompt', { schema: {}, label: 'probe' }, 4);
  assert.equal(result, null);
  assert.equal(calls, 5); // initial + 4 retries
});

// ── safeAgent(): label suffixing across multiple retries ────────────────

test('safeAgent: each retry attempt gets a distinct -retryN label suffix', async () => {
  const labels = [];
  const callAgent = async (_prompt, opts) => {
    labels.push(opts.label);
    return null;
  };
  await safeAgent(callAgent, 'prompt', { schema: {}, label: 'probe' }, 2);
  assert.deepEqual(labels, ['probe', 'probe-retry1', 'probe-retry2']);
});

// ── safeAgent(): correction prompt carries the original prompt, not the previous correction ──

test('safeAgent: every retry\'s correction prompt is built from the ORIGINAL prompt, not the prior correction', async () => {
  const prompts = [];
  const callAgent = async (prompt) => {
    prompts.push(prompt);
    return null;
  };
  await safeAgent(callAgent, 'original', { schema: { type: 'string' }, label: 'probe' }, 2);

  // buildCorrectionPrompt always wraps `prompt` (the original), so attempt 1
  // and attempt 2's correction prompts should be identical, both starting
  // with "original" and not nesting a second [SYSTEM CORRECTION] block.
  assert.equal(prompts[1], prompts[2]);
  assert.equal((prompts[1].match(/\[SYSTEM CORRECTION\]/g) || []).length, 1);
});
