// Canonical schema-correction retry logic for agent() calls (todo.md P0 #2,
// "Zero-Tolerance for Schema Failures"). agent() returns `null` when the
// subagent's output fails the Workflow tool's StructuredOutput validation —
// before this, every workflow treated that as an immediate terminal BLOCK,
// discarding all tokens already spent on the run over what's often a single
// malformed response.
//
// IMPORTANT: workflow scripts (workflows/*.js) cannot `import` this file —
// they have no filesystem/Node API access (same constraint documented in
// lib/pipeline-state.mjs and lib/research-state.mjs). This module exists as
// the documented reference; every workflow mirrors the same retry logic
// inline inside its local `trackedAgent()` helper. Keep both in sync if the
// retry policy changes.

/** Appended to the original prompt on a retry so the subagent sees exactly
 *  what went wrong without the orchestrator re-explaining the whole task. */
export function buildCorrectionPrompt(originalPrompt, schema) {
  return (
    `${originalPrompt}\n\n[SYSTEM CORRECTION]: Your previous output failed schema validation. ` +
    `You must output a valid JSON object matching this exact schema:\n${JSON.stringify(schema)}\n` +
    `Do not include any markdown formatting outside the JSON.`
  );
}

/**
 * Wraps a raw `agent(prompt, opts)` call with up to `maxRetries` schema-
 * correction retries. `callAgent` is the workflow's own `agent()`/
 * `trackedAgent()` function, passed in so this stays runnable outside the
 * Workflow sandbox (e.g. tests) without a global `agent`.
 *
 * Returns `null` only after every retry is exhausted — same contract as a
 * bare `agent()` call, so callers don't need to change their `if (!result)`
 * handling.
 */
export async function safeAgent(callAgent, prompt, opts, maxRetries = 2) {
  let currentPrompt = prompt;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callAgent(currentPrompt, attempt === 0 ? opts : { ...opts, label: `${opts.label}-retry${attempt}` });
    if (result !== null) return result;
    if (attempt === maxRetries) return null;
    currentPrompt = buildCorrectionPrompt(prompt, opts.schema);
  }
  return null;
}
