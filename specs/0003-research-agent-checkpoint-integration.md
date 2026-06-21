---
id: 0003
title: Wire Code Checkpoints into the research agent's iterative loop
status: draft
depends_on: []
source: todo.md#part-4-integration-with-the-research-agent-ralph-loop
---

## Problem

The Code Checkpoint Architecture (Tier 1 structural map, Tier 2 working-set
snapshot — both already shipped, see `scripts/code-map.mjs` and
`hooks/pre-compact.mjs`) isn't yet used by `workflows/research.js`'s Ralph
loop. As the loop iterates (hypothesize → search → validate → refine), its
growing `validated_facts`/`loop_log` state has nowhere to persist across a
`PreCompact` event the way `operator`/`inspector` working sets do.

## Acceptance Criteria

- The researcher subagent consults the Tier 1 structural checkpoint before
  proposing a hypothesis, to avoid re-discovering architecture that's
  already mapped.
- The Ralph loop's iterative state (current hypothesis, last N validated
  facts) is written to a research-task-scoped working-set checkpoint so a
  `PreCompact` event mid-loop doesn't lose the current hypothesis.
- No regression to `tests/lib-workflow-sync.test.js`'s tier/retry constant
  checks.

## Out of Scope

- Building a new checkpoint format — reuse the existing
  `working-set-checkpoint.json` shape from `hooks/pre-compact.mjs`, namespaced
  per research topic rather than per active file.

## Implementation Notes

Blocked in practice until the `researcher` agent type is registered in
whatever environment runs this workflow — confirmed during this session that
the Claude Code agent registry here only exposes built-in types (`claude`,
`Explore`, `general-purpose`, `Plan`, etc.), not this repo's custom
`subagents/researcher/researcher.md`. Verify agent-type availability before
starting implementation work on this spec.
