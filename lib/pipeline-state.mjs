// Canonical `pipeline_state` shape — structured data only, never
// conversational text or a transcript. This is "state-passing" (Anthropic's
// context-engineering term): agents get the *results* of prior stages, not
// the *reasoning process* that produced them.
//
// IMPORTANT: workflow scripts (workflows/*.js) cannot `import` this file —
// they have no filesystem/Node API access (same constraint documented for
// config/model-tiers.json and the telemetry hook). This module exists as
// the documented reference and is usable by hooks/scripts that DO have
// Node access; every workflow mirrors the same shape and merge logic
// inline as a small local `pipelineState` object + `mergeState()` helper.
// Keep both in sync if the shape changes.

/** @returns the empty starting state for a new pipeline run. */
export function createPipelineState(taskId = null) {
  return {
    task_id: taskId,
    current_mode: null,
    files_changed: [],
    test_status: null,
    last_error_message: null,
    inspector_findings: [],
    iteration_count: 0,
  };
}

/**
 * Merge an agent's structured result into pipeline state. `role` is
 * 'operator' | 'inspector' — passed explicitly by the caller (the workflow
 * already knows which agent it just called) rather than read off a
 * result.agent field, so this works against the minimal GATE_SCHEMA subset
 * every workflow actually uses.
 */
export function mergeState(state, result, role) {
  if (!result) return state;
  return {
    ...state,
    current_mode: result.mode || state.current_mode,
    files_changed: Array.isArray(result.files_changed)
      ? Array.from(new Set([...state.files_changed, ...result.files_changed]))
      : state.files_changed,
    test_status: result.test_status || state.test_status,
    last_error_message: result.last_error_message ?? state.last_error_message,
    inspector_findings: role === 'inspector' && result.findings ? result.findings : state.inspector_findings,
  };
}
