# Improvement Plan

This file records the plan for hardening and extending the spec-driven lifecycle, and where
things currently stand against it. It exists so the reasoning behind what's built (and what's
deliberately *not* built yet) doesn't live only in PR descriptions and conversation history.

## The core read

Look at what survived three separate strip-passes (see `REMOVED.md`) versus what didn't:

- **Survived:** the `SKILL.md` files, the spec template, the folder-based lifecycle
  (`draft/` → `ready/` → `in_progress/` → `waiting_verification/` → `finished/`), `check-specs.sh`.
- **Didn't survive, twice:** a separate `workflows/*.js` orchestration layer. Both times it
  died because it was coupled to agent definitions (operator/inspector/scout, then
  operator/inspector/shipper) that didn't have a settled design yet — the workflow layer
  became dead weight the moment its agents got reverted.

The pattern: prose-in-skills + folder state has been robust; code-in-workflows + agents has
failed twice. So the plan is to strengthen what's already working before reintroducing what's
failed — deliberately smaller than what got torn down before, not a rebuild of it.

## Phase 1 — harden what exists (no new subsystem, low risk)

**Status: done.** Merged via PR #59 (`harden-spec-lifecycle-phase-1`).

1. **Retry contract + blocked escalation.** `spec-verify` tracks `verify_attempts` in
   frontmatter and writes a structured `## Verification Failures` section on each failed run.
   After `MAX_VERIFY_ATTEMPTS` (2) failures, the spec moves to `blocked/` instead of sitting in
   `waiting_verification/` indefinitely with no escalation path.
2. **Single-source state table.** `specs/README.md`'s "State Transitions" section is now the
   canonical folder/status/trigger table — `spec-plan`, `spec-exec`, and `spec-verify` all
   point to it instead of each describing the lifecycle in their own prose.
3. **`check-specs.sh` extension.** Catches a spec's frontmatter `status` not matching the
   lifecycle folder it's physically sitting in.
4. **Documented retry handoff.** `spec-exec` discovers fixable specs in
   `waiting_verification/` (ones carrying a `## Verification Failures` section) and treats
   that section as the authoritative fix list, rather than relying on a human to relay the
   failure report by hand.

**Caveat worth being honest about:** Phase 1 is merged, but as of this writing no real spec
has actually been drafted, executed, and run through the retry/blocked path — `specs/template/`
is currently empty. "Merged" and "run for real" are different things, and the gate below was
written with that distinction in mind.

## Phase 2 — only once Phase 1 has run for real (not speculative)

**Status: deliberately not started.** This phase was scoped to begin only after Phase 1's
retry/blocked logic had been exercised by an actual spec going through the lifecycle — not
merely merged. That hasn't happened yet, so Phase 2 is on hold rather than in progress.

When it does start, it has two halves with meaningfully different risk profiles:

1. **A `workflows/` file that's genuinely just data** — the state table from Phase 1, in one
   canonical machine-readable place (e.g. YAML) that skills read instead of re-describing. Not
   code, not agent-coupled. Low risk, and doesn't touch the part of this repo's history that's
   failed twice.
2. **Concurrent dispatch for `spec-exec`/`spec-verify` as real subagents.** This is the part
   with the two-strikes history — `workflows/` coupled to agent definitions that didn't have a
   settled design. Should not start before Phase 1's retry/blocked-state logic has actually
   been exercised: dispatching failures into a void concurrently is worse than doing it
   serially, and there's no evidence yet that the retry/blocked logic behaves correctly under
   real use.

If and when Phase 2 starts, treat these as two separate decisions (and likely two separate
PRs) rather than one bundled change — the data file alone is uncontroversial; the subagent
dispatch piece deserves its own explicit go-ahead given the history in `REMOVED.md`.

## Stopping point

This plan deliberately stops at the two phases above rather than speculating further about
agent definitions — that's exactly the part with a two-strikes history, and it's not needed
to solve the actual orchestration gap Phase 1 closed. Any future phase 3+ should get the same
treatment: write it down here first, with an explicit gate, before building it.
