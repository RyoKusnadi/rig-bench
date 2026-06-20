// Tests for lib/research-state.mjs — the canonical researchState shape,
// merge logic, confidence scoring, and stagnation/mutation helpers for the
// questionnaire-driven research loop.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initFromQuestionnaire,
  mergeAgentOutput,
  calculateConfidence,
  nextStagnantStreak,
  mutateQuery,
  STAGNATION_THRESHOLD,
  STAGNATION_STREAK_LIMIT,
  QUERY_MUTATION_SUFFIXES,
} from '../lib/research-state.mjs';

function validAgentOutput(overrides = {}) {
  return {
    agent: 'researcher',
    mode: 'RESEARCH',
    pipeline_gate: 'PASS',
    blocking: false,
    findings: [],
    summary: 'did some research',
    current_hypothesis: 'hypothesis A',
    validated_facts: [],
    next_search_query: 'next query',
    ...overrides,
  };
}

// ── initFromQuestionnaire() ──────────────────────────────────────────────

test('initFromQuestionnaire: returns the documented initial shape', () => {
  const intake = { topic: 'widgets', focus_areas: ['pricing'] };
  const state = initFromQuestionnaire(intake);
  assert.deepEqual(state, {
    questionnaire: intake,
    current_hypothesis: '',
    validated_facts: [],
    next_search_query: 'widgets',
    confidence_score: 0,
    iteration_count: 0,
    loop_log: [],
    completed: false,
  });
});

// ── mergeAgentOutput(): schema validation gate ───────────────────────────

test('mergeAgentOutput: invalid output (missing required field) returns state unchanged with valid:false', () => {
  const state = initFromQuestionnaire({ topic: 'widgets' });
  const badOutput = { agent: 'researcher' }; // missing required fields
  const { state: nextState, valid, errors } = mergeAgentOutput(state, badOutput);
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
  assert.equal(nextState, state);
});

test('mergeAgentOutput: valid output merges and increments iteration_count', () => {
  const state = initFromQuestionnaire({ topic: 'widgets' });
  const { state: nextState, valid, errors } = mergeAgentOutput(state, validAgentOutput());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(nextState.iteration_count, 1);
  assert.equal(nextState.current_hypothesis, 'hypothesis A');
  assert.equal(nextState.next_search_query, 'next query');
  assert.deepEqual(nextState.loop_log, ['did some research']);
});

test('mergeAgentOutput: current_hypothesis falls back to existing state when output omits it', () => {
  const state = { ...initFromQuestionnaire({ topic: 'widgets' }), current_hypothesis: 'existing' };
  const output = validAgentOutput({ current_hypothesis: '' });
  const { state: nextState } = mergeAgentOutput(state, output);
  assert.equal(nextState.current_hypothesis, 'existing');
});

// ── mergeAgentOutput(): validated_facts merge (overwrite + append) ──────

test('mergeAgentOutput: new facts (new source_url+extracted_fact key) are appended', () => {
  const state = initFromQuestionnaire({ topic: 'widgets' });
  const output = validAgentOutput({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'fact A', validation_status: 'pending' },
    ],
  });
  const { state: nextState } = mergeAgentOutput(state, output);
  assert.equal(nextState.validated_facts.length, 1);
  assert.equal(nextState.validated_facts[0].validation_status, 'pending');
});

test('mergeAgentOutput: existing fact with same key is overwritten in place (pending -> verified)', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets' }),
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'fact A', validation_status: 'pending' },
    ],
  };
  const output = validAgentOutput({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'fact A', validation_status: 'verified' },
    ],
  });
  const { state: nextState } = mergeAgentOutput(state, output);
  assert.equal(nextState.validated_facts.length, 1);
  assert.equal(nextState.validated_facts[0].validation_status, 'verified');
});

test('mergeAgentOutput: a fact with a different key is appended alongside the existing one (not overwritten)', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets' }),
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'fact A', validation_status: 'pending' },
    ],
  };
  const output = validAgentOutput({
    validated_facts: [
      { source_url: 'http://b.com', extracted_fact: 'fact B', validation_status: 'verified' },
    ],
  });
  const { state: nextState } = mergeAgentOutput(state, output);
  assert.equal(nextState.validated_facts.length, 2);
  assert.deepEqual(
    nextState.validated_facts.map((f) => f.extracted_fact).sort(),
    ['fact A', 'fact B']
  );
});

test('mergeAgentOutput: loop_log appends summary across multiple merges', () => {
  let state = initFromQuestionnaire({ topic: 'widgets' });
  ({ state } = mergeAgentOutput(state, validAgentOutput({ summary: 'round 1' })));
  ({ state } = mergeAgentOutput(state, validAgentOutput({ summary: 'round 2' })));
  assert.deepEqual(state.loop_log, ['round 1', 'round 2']);
  assert.equal(state.iteration_count, 2);
});

// ── calculateConfidence() ────────────────────────────────────────────────

test('calculateConfidence: returns 0 when there are no validated_facts and no focus_areas', () => {
  const state = initFromQuestionnaire({ topic: 'widgets' });
  assert.equal(calculateConfidence(state), 0);
});

test('calculateConfidence: with no focus_areas, returns fraction of facts that are verified', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets' }),
    validated_facts: [
      { source_url: 'a', extracted_fact: 'x', validation_status: 'verified' },
      { source_url: 'b', extracted_fact: 'y', validation_status: 'pending' },
    ],
  };
  assert.equal(calculateConfidence(state), 0.5);
});

test('calculateConfidence: with focus_areas, returns fraction of focus areas covered by a verified fact (case-insensitive substring match)', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets', focus_areas: ['Pricing', 'Support'] }),
    validated_facts: [
      { source_url: 'a', extracted_fact: 'The PRICING model is tiered', validation_status: 'verified' },
      { source_url: 'b', extracted_fact: 'Some other fact', validation_status: 'pending' },
    ],
  };
  assert.equal(calculateConfidence(state), 0.5); // 1 of 2 focus areas covered
});

test('calculateConfidence: focus area not mentioned in any verified fact contributes 0 coverage', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets', focus_areas: ['pricing'] }),
    validated_facts: [
      { source_url: 'a', extracted_fact: 'unrelated fact', validation_status: 'verified' },
    ],
  };
  assert.equal(calculateConfidence(state), 0);
});

test('calculateConfidence: pending/debunked facts do not count toward focus-area coverage', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets', focus_areas: ['pricing'] }),
    validated_facts: [
      { source_url: 'a', extracted_fact: 'pricing info here', validation_status: 'pending' },
    ],
  };
  assert.equal(calculateConfidence(state), 0);
});

test('calculateConfidence: empty questionnaire.focus_areas array falls back to verified-fraction branch', () => {
  const state = {
    ...initFromQuestionnaire({ topic: 'widgets', focus_areas: [] }),
    validated_facts: [
      { source_url: 'a', extracted_fact: 'x', validation_status: 'verified' },
    ],
  };
  assert.equal(calculateConfidence(state), 1);
});

// ── nextStagnantStreak() ──────────────────────────────────────────────────

test('nextStagnantStreak: increments when confidence delta is below the stagnation threshold', () => {
  assert.equal(nextStagnantStreak(0, STAGNATION_THRESHOLD - 0.01), 1);
  assert.equal(nextStagnantStreak(1, 0), 2);
});

test('nextStagnantStreak: resets to 0 when confidence delta meets or exceeds the threshold', () => {
  assert.equal(nextStagnantStreak(1, STAGNATION_THRESHOLD), 0);
  assert.equal(nextStagnantStreak(3, STAGNATION_THRESHOLD + 0.1), 0);
});

test('STAGNATION_STREAK_LIMIT: reaching the limit is the documented stop condition (sanity check on constant)', () => {
  let streak = 0;
  streak = nextStagnantStreak(streak, 0);
  streak = nextStagnantStreak(streak, 0);
  assert.equal(streak, STAGNATION_STREAK_LIMIT);
});

// ── mutateQuery() ──────────────────────────────────────────────────────────

test('mutateQuery: appends the suffix at mutationIndex 0', () => {
  assert.equal(mutateQuery('widgets', 0), `widgets${QUERY_MUTATION_SUFFIXES[0]}`);
});

test('mutateQuery: cycles through suffixes with modulo when index exceeds list length', () => {
  const idx = QUERY_MUTATION_SUFFIXES.length; // wraps back to index 0
  assert.equal(mutateQuery('widgets', idx), `widgets${QUERY_MUTATION_SUFFIXES[0]}`);
});

test('mutateQuery: different mutationIndex values produce different suffixes', () => {
  const a = mutateQuery('widgets', 0);
  const b = mutateQuery('widgets', 1);
  assert.notEqual(a, b);
});
