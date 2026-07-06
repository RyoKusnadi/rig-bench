# Improvement Plan

This file is the long-form rationale doc for the harness itself: it records what has shipped
(and why it took the shape it did), and the gated roadmap ahead. Specs under
`specs/template/` point into this file via their `source:` frontmatter. It exists so the
reasoning behind what's built — and what's deliberately *not* built yet — doesn't live only
in PR descriptions and conversation history.

This is the second edition. The first plan covered Phases 1–4, shipped all of them, and was
removed once they closed out; its full text lives in git history
(`git log --all -- improvement-plan.md`). The shipped-phase record below is the condensed
version kept here so `source:` references and memory entries resolve without spelunking.

## The core read

The original harness subsystems (hooks, workflows, agents, memory, telemetry, research) were
stripped in three passes. What survived, versus what didn't, is the design signal everything
here follows:

- **Survived:** prose in `SKILL.md` files, the spec template, the folder-based lifecycle,
  grep-able bash checks.
- **Died twice:** a `workflows/*.js` code orchestration layer, both times because it was
  coupled to agent definitions that had no settled design.

So the standing rule: **prose in skills + data in `state.yaml` + thin agent entry points +
dependency-free bash checks.** Rebuild removed subsystems only when a phase proves the need,
and rebuild them smaller than what was torn down.

## Shipped phases (record)

Condensed. Full rationale for each phase is in git history of this file; full implementation
history is in the merged PRs and `git log --follow` on each spec.

### Phase 1

Hardened the lifecycle with no new subsystem (PR #59, exercised for real by spec 0001,
PRs #63–66): the `verify_attempts` retry contract, the structured `## Verification Failures`
handoff, `blocked/` escalation after `MAX_VERIFY_ATTEMPTS`, the single-source state table in
`specs/README.md`, and status/folder mismatch detection in `check-specs.sh`.

### Phase 2

State as pure data: `workflows/state.yaml` mirrors the state table and constants —
machine-readable, no orchestration code. Sync between prose and data is enforced by
`scripts/check-state-sync.sh` (spec 0001). Its second half (concurrent dispatch) was
deliberately gated until Phase 1 had run for real, and became Phase 4.

### Phase 3

Memory and hooks re-added smaller, as specs 0002–0007 (PRs #67–#80): file-based `memory/`
with grep as the query engine (0002), the verify→memory write-back loop (0003), the
pre-bash destructive-git safety hook (0004), dependency-graph validation in `check-specs.sh`
(0005), `make status` (0006 — also the first spec to traverse the full
fail→fail→blocked→un-block escalation for real), and the post-spec-edit drift hook (0007).

### Phase 4

Concurrent dispatch designed against the autopsy of the two removed `workflows/*.js`
attempts (specs 0008–0009, PRs #82–85): thin agent definitions (`spec-executor`,
`spec-verifier`) that delegate to the skills, the dispatch procedure in `spec-exec`'s prose,
and `MAX_CONCURRENT_DISPATCH` as data in `state.yaml`, sync-enforced. Left explicitly
unexercised at close-out: an actual multi-spec concurrent dispatch run — that gap is
Phase 5's whole job.

## Standing constraints (carried forward)

These outlive any single phase. A future phase that wants to relax one must overturn it here,
in writing, first.

1. **No orchestration code.** Dispatch and lifecycle live in prose (skills) + data
   (`state.yaml`) + thin agents. **Kill criterion:** if the agent definitions start
   accumulating lifecycle prose of their own, or a code orchestration layer starts looking
   necessary, stop and bring it back to this plan — that is the exact failure signature of
   the two removed attempts.
2. **Gates before build.** A phase is written down here, with an explicit entry gate, before
   anything is implemented. "Run for real" beats "merged code" as evidence a gate is met.
3. **Smaller than what was removed.** Any resurrected subsystem (telemetry, research) must be
   the minimal version the removed one should have been — dependency-free bash and markdown
   until that demonstrably can't carry the weight (`memory/decisions.md`, 2026-07-03).
4. **Everything through the lifecycle.** Harness improvements are themselves specs in
   `specs/template/`, one spec = one PR, verified before finished.

## Phase 5 — exercise concurrent dispatch for real

**Gate: met by definition** — this closes the gap Phase 4's close-out recorded.

Not a code phase. Run the first genuine multi-spec concurrent dispatch: a batch of
independent specs (Phase 6's batch is the natural candidate), dispatched as parallel
`spec-executor` agents per `spec-exec`'s procedure — worktree per spec, one PR per spec,
within `MAX_CONCURRENT_DISPATCH`. The deliverable is evidence, not code:

- The run itself, observed against the kill criterion above.
- A `memory/lessons.md` entry recording what the first real run taught (dispatch friction,
  result-collection gaps, worktree cleanup, anything the prose procedure got wrong).
- Any fixes the run exposes become ordinary specs — not inline patches to the procedure.

## Phase 6 — telemetry, re-added smaller

**Gate: none beyond Phase 5 running concurrently with it** (its specs are Phase 5's batch).

The removed `telemetry/` subsystem, rebuilt as what it should have been: read-only
reporting over data the lifecycle already produces (frontmatter, folders, git history) —
no collection layer, no database, no new state.

1. **`scripts/spec-metrics.sh` + `make metrics`.** Per-project lifecycle metrics computed
   on demand: verification failure rate (`verify_attempts` distribution across finished
   specs), blocked/un-blocked traversals, spec cycle time (first-commit → merge, from
   `git log --follow`), and dependency-chain depth. Dependency-free bash, same
   line-oriented parsing decision as the other scripts.
2. **Attention thresholds.** `make status`'s "needs attention" section learns from metrics:
   e.g. flag when the rolling verification failure rate crosses a documented threshold —
   thresholds as data in `state.yaml`, sync-enforced like the other constants.

## Phase 7 — verification hardening

**Gate: Phase 6 shipped** (its lint needs `check-specs.sh` stable, and both touch the same
files — the file-conflict rule applies across phases too).

`memory/lessons.md` records two genuine verification failures caused by the same authoring
error class: Verification sections asserting absolute future tree state instead of
verification-time invariants. Make that class structural instead of remembered:

1. **Verification-section lint in `check-specs.sh`.** Advisory detection of the known
   anti-pattern (absolute per-state count assertions in `## Verification` bodies), pointing
   at the lessons entry. Grep-level heuristics are acceptable; the goal is a nudge at
   authoring time, not proof.
2. **Spec-plan authoring gate.** The `spec-plan` skill's draft review explicitly checks
   Verification sections against the recorded lesson classes before a spec can leave
   `draft/` — prose in the skill, consistent with what survives here.

## Phase 8 — first real project under `projects/`

**Gate: Phases 5–7 shipped and their lessons written back.** This is the harness's actual
exam: everything so far is self-hosted dogfooding.

Bootstrap one real project end-to-end — its own repo under `projects/<name>/`, its own
`specs/<name>/` lifecycle (the `specs/rajin-menabung/` skeleton already exists as a
candidate), its own rationale doc that `source:` points into. Success is the harness's
conventions transferring without edits; every place they don't transfer is a finding that
comes back here as a Phase 9 candidate.

## Not planned (stopping point)

Deliberately not phases, until something above proves the need in writing here first:

- **Research subsystem** — nothing in the lifecycle currently produces research artifacts.
- **Long-term spec archive** — git history remains the archive (`specs/README.md`,
  "permanent record"); revisit only if `finished/` scanning becomes a real friction.
- **Any `workflows/*.js` revival** — two strikes; the kill criterion governs.

Same rule as the first edition: any future phase gets written down here, with an explicit
gate, before it gets built.
