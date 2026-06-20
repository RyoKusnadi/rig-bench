// Canonical `researchState` shape and merge logic for the questionnaire-
// driven research loop (todo.md "Ralph Loop"). Same posture as
// lib/pipeline-state.mjs: this module is the documented reference and is
// directly usable by anything with Node/fs access (scripts, hooks); a
// Workflow-tool script driving the actual loop (workflows/research.mjs,
// Phase 4 — not yet built) cannot `import` it and would mirror this shape
// and merge logic inline instead, the same way every workflows/*.js mirrors
// TIER_MODELS and pipelineState's merge logic rather than importing them.
//
// `researcher` agent output is validated against
// config/schemas/researcher-output.schema.json before merging — see
// mergeAgentOutput() below. The full state shape is documented in
// config/schemas/research-state.schema.json.

import { validate } from './schema-validator.mjs';
import researcherOutputSchema from '../config/schemas/researcher-output.schema.json' with { type: 'json' };

/** @returns the initial researchState for a freshly loaded intake.json. */
export function initFromQuestionnaire(intake) {
  return {
    questionnaire: intake,
    current_hypothesis: '',
    validated_facts: [],
    next_search_query: intake.topic,
    confidence_score: 0,
    iteration_count: 0,
    loop_log: [],
    completed: false,
  };
}

function factKey(fact) {
  return `${fact.source_url}::${fact.extracted_fact}`;
}

/**
 * Validate one `researcher` agent RESEARCH-mode response and merge it into
 * `state`. Returns `{ state, valid, errors }` — on `valid: false`, `state`
 * is returned unchanged so a caller can retry rather than merge garbage.
 */
export function mergeAgentOutput(state, agentOutput) {
  const { valid, errors } = validate(researcherOutputSchema, agentOutput);
  if (!valid) return { state, valid, errors };

  // Existing facts get overwritten in place (e.g. pending -> verified on a
  // later iteration); genuinely new facts are appended.
  const incomingByKey = new Map((agentOutput.validated_facts || []).map((f) => [factKey(f), f]));
  const mergedFacts = state.validated_facts.map((f) => incomingByKey.get(factKey(f)) ?? f);
  const mergedKeys = new Set(mergedFacts.map(factKey));
  for (const f of agentOutput.validated_facts || []) {
    if (!mergedKeys.has(factKey(f))) {
      mergedFacts.push(f);
      mergedKeys.add(factKey(f));
    }
  }

  const nextState = {
    ...state,
    current_hypothesis: agentOutput.current_hypothesis || state.current_hypothesis,
    validated_facts: mergedFacts,
    next_search_query: agentOutput.next_search_query || state.next_search_query,
    iteration_count: state.iteration_count + 1,
    loop_log: [...state.loop_log, agentOutput.summary],
  };

  return { state: nextState, valid: true, errors: [] };
}

/**
 * Deterministic confidence score: the fraction of `focus_areas` covered by
 * at least one `verified` fact, where "covered" means the focus area's text
 * appears (case-insensitive) in the fact's `extracted_fact`. If the
 * questionnaire declares no focus areas, falls back to the fraction of all
 * facts that are `verified`.
 */
export function calculateConfidence(state) {
  const verifiedFacts = state.validated_facts.filter((f) => f.validation_status === 'verified');
  const focusAreas = state.questionnaire?.focus_areas || [];

  if (focusAreas.length === 0) {
    if (state.validated_facts.length === 0) return 0;
    return verifiedFacts.length / state.validated_facts.length;
  }

  const covered = focusAreas.filter((area) =>
    verifiedFacts.some((f) => f.extracted_fact.toLowerCase().includes(area.toLowerCase()))
  );
  return covered.length / focusAreas.length;
}
