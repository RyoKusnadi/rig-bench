// Tests for lib/state-projector.mjs — projects the full researchState down
// to a bounded Markdown prompt fragment for the research loop (todo.md P0
// #1, "Context Window Bomb").
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStateForPrompt } from '../lib/state-projector.mjs';
import { initFromQuestionnaire } from '../lib/research-state.mjs';

function baseState(overrides = {}) {
  return {
    ...initFromQuestionnaire({ topic: 'widgets' }),
    ...overrides,
  };
}

test('projectStateForPrompt: includes current_hypothesis verbatim when set', () => {
  const state = baseState({ current_hypothesis: 'Widgets are popular' });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.match(prompt, /### Current Hypothesis\nWidgets are popular/);
});

test('projectStateForPrompt: falls back to "(none yet)" when current_hypothesis is empty', () => {
  const state = baseState({ current_hypothesis: '' });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.match(prompt, /### Current Hypothesis\n\(none yet\)/);
});

test('projectStateForPrompt: includes pending facts regardless of query relevance', () => {
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'totally unrelated fact', validation_status: 'pending' },
    ],
  });
  const prompt = projectStateForPrompt(state, 'completely different query');
  assert.match(prompt, /\[pending\] \(http:\/\/a\.com\): totally unrelated fact/);
});

test('projectStateForPrompt: includes verified facts only when they share a keyword with currentQuery', () => {
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'widgets are durable', validation_status: 'verified' },
      { source_url: 'http://b.com', extracted_fact: 'gadgets are cheap', validation_status: 'verified' },
    ],
  });
  const prompt = projectStateForPrompt(state, 'durable widgets');
  assert.match(prompt, /widgets are durable/);
  assert.doesNotMatch(prompt, /gadgets are cheap/);
});

test('projectStateForPrompt: short query words (length <= 2) are excluded from the keyword filter', () => {
  // "to" and "a" are length <=2 and filtered out of queryWords by the regex,
  // so a fact containing only those words should NOT be considered relevant.
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'a completely unrelated statement', validation_status: 'verified' },
    ],
  });
  const prompt = projectStateForPrompt(state, 'to a');
  assert.match(prompt, /\(none relevant to the current query\)/);
});

test('projectStateForPrompt: shows "(none relevant to the current query)" when no facts qualify', () => {
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'verified but irrelevant', validation_status: 'verified' },
    ],
  });
  const prompt = projectStateForPrompt(state, 'totally different topic xyz');
  assert.match(prompt, /\(none relevant to the current query\)/);
});

test('projectStateForPrompt: relevant-count header reports relevant/total fact counts', () => {
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'widgets info', validation_status: 'pending' },
      { source_url: 'http://b.com', extracted_fact: 'irrelevant verified fact', validation_status: 'verified' },
    ],
  });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.match(prompt, /### Relevant Facts \(1\/2 total\)/);
});

test('projectStateForPrompt: loop_log is truncated to the last 2 entries (LOOP_LOG_TAIL)', () => {
  const state = baseState({ loop_log: ['round1', 'round2', 'round3'] });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.doesNotMatch(prompt, /round1/);
  assert.match(prompt, /round2/);
  assert.match(prompt, /round3/);
  assert.match(prompt, /Recent Loop Log \(last 2\)/);
});

test('projectStateForPrompt: shows "(none yet)" for an empty loop_log', () => {
  const state = baseState({ loop_log: [] });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.match(prompt, /### Recent Loop Log \(last 0\)\n\(none yet\)/);
});

test('projectStateForPrompt: progress line reports confidence_score, iteration_count, next_search_query', () => {
  const state = baseState({ confidence_score: 0.42, iteration_count: 3, next_search_query: 'widgets v2' });
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.match(prompt, /confidence_score: 0\.42, iteration: 3, next_search_query: widgets v2/);
});

test('projectStateForPrompt: handles a missing/undefined currentQuery without throwing', () => {
  const state = baseState({
    validated_facts: [
      { source_url: 'http://a.com', extracted_fact: 'some fact', validation_status: 'pending' },
    ],
  });
  assert.doesNotThrow(() => projectStateForPrompt(state, undefined));
});

test('projectStateForPrompt: result is a Markdown string with all four section headers, not raw JSON', () => {
  const state = baseState();
  const prompt = projectStateForPrompt(state, 'widgets');
  assert.equal(typeof prompt, 'string');
  for (const header of ['### Current Hypothesis', '### Relevant Facts', '### Recent Loop Log', '### Progress']) {
    assert.ok(prompt.includes(header), `expected prompt to include "${header}"`);
  }
});
