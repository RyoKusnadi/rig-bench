// Canonical state-projection logic for the research loop (todo.md P0 #1,
// "Context Window Bomb"). workflows/research.js used to inject the *entire*
// researchState into every prompt via `JSON.stringify(state)` — by
// iteration 4-5, `validated_facts` and `loop_log` have grown linearly across
// every prior round, so the prompt balloons toward 30k-50k tokens of mostly
// stale facts the current query doesn't need.
//
// IMPORTANT: workflow scripts (workflows/*.js) cannot `import` this file —
// they have no filesystem/Node API access (same constraint documented in
// lib/pipeline-state.mjs and lib/research-state.mjs). This module exists as
// the documented reference; workflows/research.js mirrors the same
// projection logic inline. Keep both in sync if the shape changes.
//
// The orchestrator (workflows/research.js) still keeps the *full* state in
// memory and returns it in full at the end — only the prompt sent to the
// agent is projected.

const LOOP_LOG_TAIL = 2;

function sharesKeyword(fact, query) {
  const queryWords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const factText = fact.extracted_fact.toLowerCase();
  return queryWords.some((w) => factText.includes(w));
}

/**
 * Projects `state` down to what the next `researcher` call actually needs:
 * the last `LOOP_LOG_TAIL` log entries, and only facts that are still
 * `pending` or relevant to `currentQuery` — formatted as Markdown rather
 * than raw JSON, since LLMs parse structured Markdown more reliably than
 * dense JSON blobs.
 */
export function projectStateForPrompt(state, currentQuery) {
  const relevantFacts = state.validated_facts.filter(
    (f) => f.validation_status === 'pending' || sharesKeyword(f, currentQuery || '')
  );
  const recentLog = state.loop_log.slice(-LOOP_LOG_TAIL);

  const factsSection = relevantFacts.length
    ? relevantFacts.map((f) => `- [${f.validation_status}] (${f.source_url}): ${f.extracted_fact}`).join('\n')
    : '(none relevant to the current query)';

  const logSection = recentLog.length ? recentLog.map((entry) => `- ${entry}`).join('\n') : '(none yet)';

  return (
    `### Current Hypothesis\n${state.current_hypothesis || '(none yet)'}\n\n` +
    `### Relevant Facts (${relevantFacts.length}/${state.validated_facts.length} total)\n${factsSection}\n\n` +
    `### Recent Loop Log (last ${recentLog.length})\n${logSection}\n\n` +
    `### Progress\nconfidence_score: ${state.confidence_score}, iteration: ${state.iteration_count}, next_search_query: ${state.next_search_query}`
  );
}
