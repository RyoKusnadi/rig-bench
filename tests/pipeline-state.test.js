// Tests for lib/pipeline-state.mjs — the canonical pipeline_state shape and
// merge logic that every workflows/*.js mirrors inline.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineState, mergeState } from '../lib/pipeline-state.mjs';

// ── createPipelineState() ───────────────────────────────────────────────

test('createPipelineState: returns the documented empty shape with no taskId', () => {
  const state = createPipelineState();
  assert.deepEqual(state, {
    task_id: null,
    current_mode: null,
    files_changed: [],
    test_status: null,
    last_error_message: null,
    inspector_findings: [],
    iteration_count: 0,
    repo_manifest: null,
    gate_status: null,
  });
});

test('createPipelineState: sets task_id when provided', () => {
  const state = createPipelineState('task-123');
  assert.equal(state.task_id, 'task-123');
});

// ── mergeState(): null result ────────────────────────────────────────────

test('mergeState: returns state unchanged when result is null', () => {
  const state = createPipelineState('t1');
  const merged = mergeState(state, null, 'operator');
  assert.equal(merged, state);
});

// ── mergeState(): current_mode ───────────────────────────────────────────

test('mergeState: operator result.mode updates current_mode', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { mode: 'BUILD' }, 'operator');
  assert.equal(merged.current_mode, 'BUILD');
});

test('mergeState: scout role never updates current_mode even if result.mode is set', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { mode: 'GATE' }, 'scout');
  assert.equal(merged.current_mode, null);
});

test('mergeState: missing result.mode leaves current_mode unchanged', () => {
  const state = { ...createPipelineState(), current_mode: 'BUILD' };
  const merged = mergeState(state, {}, 'operator');
  assert.equal(merged.current_mode, 'BUILD');
});

// ── mergeState(): files_changed (dedup via Set) ──────────────────────────

test('mergeState: files_changed merges and dedupes against existing list', () => {
  const state = { ...createPipelineState(), files_changed: ['a.js'] };
  const merged = mergeState(state, { files_changed: ['a.js', 'b.js'] }, 'operator');
  assert.deepEqual(merged.files_changed, ['a.js', 'b.js']);
});

test('mergeState: files_changed left unchanged when result.files_changed is not an array', () => {
  const state = { ...createPipelineState(), files_changed: ['a.js'] };
  const merged = mergeState(state, { files_changed: 'not-an-array' }, 'operator');
  assert.deepEqual(merged.files_changed, ['a.js']);
});

// ── mergeState(): test_status / last_error_message ──────────────────────

test('mergeState: test_status updates when result provides one', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { test_status: 'PASS' }, 'operator');
  assert.equal(merged.test_status, 'PASS');
});

test('mergeState: test_status falls back to existing state when result omits it', () => {
  const state = { ...createPipelineState(), test_status: 'FAIL' };
  const merged = mergeState(state, {}, 'operator');
  assert.equal(merged.test_status, 'FAIL');
});

test('mergeState: last_error_message uses nullish coalescing — explicit null in result falls through to existing state (not cleared)', () => {
  // `??` only short-circuits on a non-nullish left operand; since
  // result.last_error_message is itself null here, the existing
  // state value is kept rather than being cleared.
  const state = { ...createPipelineState(), last_error_message: 'boom' };
  const merged = mergeState(state, { last_error_message: null }, 'operator');
  assert.equal(merged.last_error_message, 'boom');
});

test('mergeState: last_error_message is set when result provides a non-null value', () => {
  const state = { ...createPipelineState(), last_error_message: 'boom' };
  const merged = mergeState(state, { last_error_message: 'new error' }, 'operator');
  assert.equal(merged.last_error_message, 'new error');
});

test('mergeState: last_error_message preserved when result omits the key entirely (undefined)', () => {
  const state = { ...createPipelineState(), last_error_message: 'boom' };
  const merged = mergeState(state, {}, 'operator');
  assert.equal(merged.last_error_message, 'boom');
});

// ── mergeState(): inspector_findings (role-gated) ────────────────────────

test('mergeState: inspector_findings only updates for role "inspector"', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { findings: ['issue1'] }, 'inspector');
  assert.deepEqual(merged.inspector_findings, ['issue1']);
});

test('mergeState: inspector_findings unchanged when role is operator even if result.findings present', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { findings: ['issue1'] }, 'operator');
  assert.deepEqual(merged.inspector_findings, []);
});

// ── mergeState(): repo_manifest (role-gated to scout) ────────────────────

test('mergeState: repo_manifest only set when role is scout and result.repo_manifest present', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { repo_manifest: { files: ['x'] } }, 'scout');
  assert.deepEqual(merged.repo_manifest, { files: ['x'] });
});

test('mergeState: repo_manifest unchanged for non-scout role', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { repo_manifest: { files: ['x'] } }, 'operator');
  assert.equal(merged.repo_manifest, null);
});

// ── mergeState(): gate_status (role + mode gated) ────────────────────────

test('mergeState: gate_status set when role is scout and mode is GATE', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { mode: 'GATE', pipeline_gate: 'PASS' }, 'scout');
  assert.equal(merged.gate_status, 'PASS');
});

test('mergeState: gate_status unchanged when role is scout but mode is not GATE', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { mode: 'MANIFEST', pipeline_gate: 'PASS' }, 'scout');
  assert.equal(merged.gate_status, null);
});

test('mergeState: gate_status unchanged when mode is GATE but role is not scout', () => {
  const state = createPipelineState();
  const merged = mergeState(state, { mode: 'GATE', pipeline_gate: 'PASS' }, 'operator');
  assert.equal(merged.gate_status, null);
});

// ── mergeState(): does not mutate input state ────────────────────────────

test('mergeState: returns a new object and does not mutate the original state', () => {
  const state = createPipelineState('t1');
  const merged = mergeState(state, { mode: 'BUILD' }, 'operator');
  assert.notEqual(merged, state);
  assert.equal(state.current_mode, null);
  assert.equal(merged.current_mode, 'BUILD');
});
