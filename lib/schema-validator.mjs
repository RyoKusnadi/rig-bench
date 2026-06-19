// Zero-dependency JSON schema validator for agent output. Supports the
// subset of draft-07 used by config/schemas/*.json: type, required,
// properties, items, enum, const. Not a general-purpose ajv replacement —
// just enough to catch missing fields and wrong enum values at agent
// boundaries for direct/manual invocation (Workflow-driven `agent()` calls
// already get this for free via the `schema` option's StructuredOutput
// layer — see workflows/README.md "Already true by construction").

const JSON_BLOCK_RE = /```json\n([\s\S]*?)\n```/g;

export function extractJsonBlock(text) {
  let match;
  let last = null;
  while ((match = JSON_BLOCK_RE.exec(text)) !== null) {
    last = match[1];
  }
  if (last === null) return { ok: false, error: 'No ```json``` block found in response.' };
  try {
    return { ok: true, value: JSON.parse(last) };
  } catch (err) {
    return { ok: false, error: `Malformed JSON in trailing block: ${err.message}` };
  }
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function validateNode(schema, value, path, errors) {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const "${schema.const}", got "${value}"`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: "${value}" is not one of [${schema.enum.join(', ')}]`);
    return;
  }
  if (schema.type && typeOf(value) !== schema.type) {
    errors.push(`${path}: expected type "${schema.type}", got "${typeOf(value)}"`);
    return;
  }
  if (schema.type === 'object' && schema.properties) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}: missing required field "${key}"`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in value) validateNode(subSchema, value[key], `${path}.${key}`, errors);
    }
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`, errors));
  }
}

/** Validate `value` against a draft-07-subset JSON schema object. Returns { valid, errors }. */
export function validate(schema, value) {
  const errors = [];
  validateNode(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}

/** Convenience: extract the trailing ```json``` block from agent response text and validate it. */
export function validateAgentResponse(schema, responseText) {
  const extracted = extractJsonBlock(responseText);
  if (!extracted.ok) return { valid: false, errors: [extracted.error] };
  const { valid, errors } = validate(schema, extracted.value);
  return { valid, errors, value: extracted.value };
}
