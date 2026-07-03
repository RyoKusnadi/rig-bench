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

**Caveat — resolved 2026-07-03:** Phase 1 has now been exercised for real. Spec 0001 ran
the full lifecycle including the retry path (verification attempt 1 failed and was recorded
per the contract, spec-exec fixed from the `## Verification Failures` section, attempt 2
passed — PRs #63–#66); specs 0002–0004 followed (PRs #67–#71). See
`memory/lessons.md`'s 2026-07-03 entry for the findings. The Phase 2 gate condition below
is met.

## Phase 2 — only once Phase 1 has run for real (not speculative)

**Status: split.** The two halves have meaningfully different risk profiles, so they're being
tracked and shipped separately rather than as one bundled change — the data file is
uncontroversial; subagent dispatch deserves its own explicit go-ahead given the history in
`REMOVED.md`.

1. **A `workflows/` file that's genuinely just data.** **Done.** `workflows/state.yaml` — the
   state table from Phase 1 plus the `MAX_VERIFY_ATTEMPTS` constant, as pure data. Not code,
   not agent-coupled. `specs/README.md`'s "State Transitions" section remains the canonical
   prose explanation; the YAML is a machine-readable mirror for future tooling, with a known
   (documented, not solved) gap that nothing yet enforces the two — plus
   `scripts/check-specs.sh`'s own hand-maintained `VALID_STATES` array — stay in sync.
2. **Concurrent dispatch for `spec-exec`/`spec-verify` as real subagents.** **Not started —
   still gated.** This is the part with the two-strikes history — `workflows/` coupled to
   agent definitions that didn't have a settled design. Should not start before Phase 1's
   retry/blocked-state logic has actually been exercised by a real spec (not just merged code):
   dispatching failures into a void concurrently is worse than doing it serially, and there's
   no evidence yet the retry/blocked logic behaves correctly under real use — `specs/template/`
   is still empty as of this writing. This item stays on hold until that changes.

## Phase 3 — memory and one hook, re-added smaller (2026-07-03)

**Status: done.** Executed as specs 0002–0004 through the lifecycle itself:

1. **File-based memory** (spec 0002, PR #67): `memory/{README,decisions,gotchas,lessons}.md`
   — plain markdown, grep as the query engine, provenance tags, strike-through pruning.
   Deliberately what the removed TF-IDF/SQLite system should have been at this scale.
2. **Write-back loop** (spec 0003, PR #68): `spec-verify` writes distilled lessons on
   failure/block; `spec-plan` consults `memory/` next to the Non-negotiables check. Prose in
   skills — consistent with what has survived here versus what died twice.
3. **Pre-bash safety hook** (spec 0004, PR #70): the one removed hook re-added, scoped to
   the destructive-git non-negotiable; `ask` not `deny`, fail-open, tested.

Phase 2's second half (concurrent subagent dispatch) remains not started — its gate is now
met, but starting it is still an explicit go/no-go decision, not a default.

## Stopping point

This plan deliberately stops at the two phases above rather than speculating further about
agent definitions — that's exactly the part with a two-strikes history, and it's not needed
to solve the actual orchestration gap Phase 1 closed. Any future phase 3+ should get the same
treatment: write it down here first, with an explicit gate, before building it.
