// Tests for lib/schema-validator.mjs — the zero-dependency draft-07-subset
// JSON schema validator used at agent boundaries.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, extractJsonBlock, validateAgentResponse } from '../lib/schema-validator.mjs';

// ── validate(): type ────────────────────────────────────────────────────

test('validate: matching type passes with no errors', () => {
  const { valid, errors } = validate({ type: 'string' }, 'hello');
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validate: mismatched type fails with a descriptive error', () => {
  const { valid, errors } = validate({ type: 'string' }, 42);
  assert.equal(valid, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /expected type "string", got "number"/);
});

test('validate: array type is distinguished from object', () => {
  assert.equal(validate({ type: 'array' }, []).valid, true);
  assert.equal(validate({ type: 'object' }, []).valid, false);
});

test('validate: null type is distinguished from object', () => {
  assert.equal(validate({ type: 'null' }, null).valid, true);
  assert.equal(validate({ type: 'object' }, null).valid, false);
});

// ── validate(): required + properties (nested objects) ─────────────────

test('validate: object missing a required field fails', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
  const { valid, errors } = validate(schema, {});
  assert.equal(valid, false);
  assert.match(errors[0], /missing required field "name"/);
});

test('validate: object with all required fields present passes', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
  const { valid, errors } = validate(schema, { name: 'rig' });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validate: nested object properties are validated recursively', () => {
  const schema = {
    type: 'object',
    required: ['user'],
    properties: {
      user: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  };
  const { valid, errors } = validate(schema, { user: { id: 123 } });
  assert.equal(valid, false);
  assert.match(errors[0], /\$\.user\.id: expected type "string", got "number"/);
});

test('validate: extra properties not in schema are ignored', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const { valid } = validate(schema, { a: 'x', extra: 'unchecked' });
  assert.equal(valid, true);
});

test('validate: property absent from value (and not required) is skipped, not validated', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const { valid } = validate(schema, {});
  assert.equal(valid, true);
});

// ── validate(): arrays of objects ───────────────────────────────────────

test('validate: array items are each validated against `items` schema', () => {
  const schema = { type: 'array', items: { type: 'string' } };
  const { valid, errors } = validate(schema, ['a', 'b', 3]);
  assert.equal(valid, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /\$\[2\]: expected type "string", got "number"/);
});

test('validate: array of objects validates each object\'s required fields', () => {
  const schema = {
    type: 'array',
    items: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
  };
  const { valid, errors } = validate(schema, [{ url: 'a' }, {}]);
  assert.equal(valid, false);
  assert.match(errors[0], /\$\[1\]: missing required field "url"/);
});

test('validate: empty array passes when items schema given', () => {
  const schema = { type: 'array', items: { type: 'string' } };
  assert.equal(validate(schema, []).valid, true);
});

// ── validate(): enum ─────────────────────────────────────────────────────

test('validate: enum passes when value is one of the allowed options', () => {
  const schema = { enum: ['a', 'b', 'c'] };
  assert.equal(validate(schema, 'b').valid, true);
});

test('validate: enum fails when value is not in the list', () => {
  const schema = { enum: ['a', 'b', 'c'] };
  const { valid, errors } = validate(schema, 'z');
  assert.equal(valid, false);
  assert.match(errors[0], /"z" is not one of \[a, b, c\]/);
});

test('validate: enum short-circuits before the type check', () => {
  // enum check happens before type check in validateNode — a type mismatch
  // alongside a failing enum should only report the enum error.
  const schema = { type: 'string', enum: ['a', 'b'] };
  const { errors } = validate(schema, 5);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not one of/);
});

// ── validate(): const ─────────────────────────────────────────────────────

test('validate: const passes when value matches exactly', () => {
  const schema = { const: 'researcher' };
  assert.equal(validate(schema, 'researcher').valid, true);
});

test('validate: const fails when value differs', () => {
  const schema = { const: 'researcher' };
  const { valid, errors } = validate(schema, 'operator');
  assert.equal(valid, false);
  assert.match(errors[0], /expected const "researcher", got "operator"/);
});

test('validate: const short-circuits before enum and type checks', () => {
  const schema = { const: 'x', enum: ['y', 'z'], type: 'string' };
  const { errors } = validate(schema, 'y');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /expected const "x"/);
});

// ── validate(): combined / realistic schema ─────────────────────────────

test('validate: realistic nested schema with required, properties, arrays, and enum all pass together', () => {
  const schema = {
    type: 'object',
    required: ['agent', 'mode', 'findings'],
    properties: {
      agent: { const: 'researcher' },
      mode: { type: 'string', enum: ['RESEARCH', 'SYNTHESIZE'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['severity', 'message'],
          properties: {
            severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
            message: { type: 'string' },
          },
        },
      },
    },
  };
  const value = {
    agent: 'researcher',
    mode: 'RESEARCH',
    findings: [{ severity: 'High', message: 'found something' }],
  };
  const { valid, errors } = validate(schema, value);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validate: realistic nested schema reports every distinct error, not just the first', () => {
  const schema = {
    type: 'object',
    required: ['agent', 'mode'],
    properties: {
      agent: { const: 'researcher' },
      mode: { type: 'string', enum: ['RESEARCH', 'SYNTHESIZE'] },
    },
  };
  const { valid, errors } = validate(schema, { agent: 'wrong-agent', mode: 'BOGUS' });
  assert.equal(valid, false);
  assert.equal(errors.length, 2);
});

// ── extractJsonBlock() ───────────────────────────────────────────────────

test('extractJsonBlock: extracts a single ```json code block', () => {
  const text = 'Some preamble.\n```json\n{"a": 1}\n```\nTrailing text.';
  const result = extractJsonBlock(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
});

test('extractJsonBlock: uses the LAST ```json block when multiple are present', () => {
  const text = '```json\n{"a": 1}\n```\nSome reasoning in between.\n```json\n{"a": 2}\n```';
  const result = extractJsonBlock(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 2 });
});

test('extractJsonBlock: returns ok:false when no ```json block is present', () => {
  const result = extractJsonBlock('just plain text, no code block here');
  assert.equal(result.ok, false);
  assert.match(result.error, /No ```json``` block found/);
});

test('extractJsonBlock: returns ok:false with a parse error message for malformed JSON', () => {
  const text = '```json\n{not valid json}\n```';
  const result = extractJsonBlock(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /Malformed JSON in trailing block/);
});

test('extractJsonBlock: a non-json code block (e.g. ```js) is not matched', () => {
  const text = '```js\n{"a": 1}\n```';
  const result = extractJsonBlock(text);
  assert.equal(result.ok, false);
});

test('extractJsonBlock: handles multi-line JSON content inside the block', () => {
  const text = '```json\n{\n  "a": 1,\n  "b": 2\n}\n```';
  const result = extractJsonBlock(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1, b: 2 });
});

// ── validateAgentResponse() ──────────────────────────────────────────────

test('validateAgentResponse: extracts, parses, and validates a well-formed agent response', () => {
  const schema = {
    type: 'object',
    required: ['agent'],
    properties: { agent: { const: 'researcher' } },
  };
  const text = 'Here is my output:\n```json\n{"agent": "researcher"}\n```';
  const result = validateAgentResponse(schema, text);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value, { agent: 'researcher' });
});

test('validateAgentResponse: returns valid:false and an extraction error when no json block exists', () => {
  const schema = { type: 'object' };
  const result = validateAgentResponse(schema, 'no code block here');
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /No ```json``` block found/);
  assert.equal(result.value, undefined);
});

test('validateAgentResponse: returns valid:false with schema errors when extracted JSON fails validation', () => {
  const schema = { type: 'object', required: ['agent'], properties: { agent: { type: 'string' } } };
  const text = '```json\n{}\n```';
  const result = validateAgentResponse(schema, text);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /missing required field "agent"/);
  assert.deepEqual(result.value, {});
});
