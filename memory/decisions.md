# Decisions

Choices with a rationale that future work should respect, or knowingly overturn. Entry
format and pruning convention: see `memory/README.md`.

## 2026-07-03 — Keep lifecycle tooling dependency-free bash (spec 0001)

`check-state-sync.sh` and `check-specs.sh` parse `workflows/state.yaml` line-oriented with
awk instead of adding a YAML parser. The whole reason a hand-maintained state copy existed
was to avoid that dependency; enforcement that reintroduced it would have solved the drift
problem by recreating the complexity problem. If state.yaml ever needs nesting that
line-oriented parsing can't handle, revisit this decision explicitly rather than bending the
parser.

## 2026-07-03 — Dispatch is prose + data + thin agents, never orchestration code (specs 0008–0009, PRs #82–#84)

Concurrent dispatch was rebuilt on the opposite shape from the twice-removed workflows/*.js
layer: the procedure lives in spec-exec's prose, the limit lives in state.yaml (sync-enforced
against the README), and the agents are entry points that delegate to skills. The decoupling
test is the design's invariant — deleting an agent file must break nothing but dispatch.
Kill criterion (a standing constraint from that design, PR #82): agents accumulating
lifecycle prose, or an orchestration layer looking necessary, means stop and re-plan.

## 2026-07-06 — No standing plan doc at the repo root

The harness deliberately keeps no long-form plan/rationale file in the working tree. Earlier
ones were deleted once their phases shipped, and recreating one was reverted the same day by
the human's explicit call. Phase history lives in merged PRs, git history, and these memory
notebooks; `specs/template/` specs leave `source:` blank (`""`) until such a doc exists
again. Don't reintroduce one without an explicit ask.

## 2026-07-08 — Verification failures hand off a raw trace, not just a summary (spec 0021)

The verify→fix retry loop is this harness's own self-improvement loop, and the fix agent's
only feedback was the compressed `## Verification Failures` summary (plus a distilled
`lessons.md` line). Meta-Harness (Lee et al., 2026) shows empirically that an improver fed
raw execution traces fixes far more than one fed only summaries, and that summaries cannot
recover the dropped signal (their traces-vs-scores+summary ablation). So `spec-verify` now
also writes the raw run — actual commands and full output — to
`specs/<project>/.traces/<id>/attempt-<n>.md`, queryable via `scripts/spec-trace.sh`, and
`spec-exec` reads it on a fix. Traces are the raw form of the same failure history the
summary carries, so they clear on success for the same reason the failures section does;
git history keeps them. Kept dependency-free bash + grep-able plain files per the two
decisions above — the trace is more raw experience to grep, not a new tooling layer.

## 2026-07-08 — Four more Meta-Harness/SIA mechanisms adopted (specs 0022-0025)

Following up on spec 0021 (raw traces over summaries), the rest of Meta-Harness's proposer
discipline (its two SKILL.md files) turned out to transfer cleanly to this repo's own
spec-plan/spec-exec/spec-verify loop, once translated from "evolve a benchmarked ML system"
to "evolve a harness with pass/fail verification":

- **0022 — mandatory prototype before implementing a new mechanism.** Meta-Harness requires
  prototyping the core mechanism in `/tmp` before writing the final candidate; skipping it
  correlates with bugs or no effect. `spec-exec` now requires the same, scoped to specs that
  introduce a mechanism the repo doesn't already have.
- **0023 — falsifiable hypothesis + one-mechanism-per-spec.** Both SKILL.md files require a
  falsifiable claim and ban bundling ("if you're tempted to add 'and also...' that's a second
  candidate"). `spec-plan` now captures the claim in Phase 2 and self-checks for bundling in
  Phase 3, sharpening the existing one-deliverable *size* rule with a one-mechanism *content*
  rule.
- **0024 — anti-overfitting rule for shared tooling.** Both papers ban hardcoding
  task/dataset specifics into general-purpose scaffold code. Added to `CLAUDE.md`'s
  Non-negotiables: shared tooling (skills/hooks/scripts) must not special-case a specific
  spec id or scenario.
- **0025 — structured outcome ledger.** `evolution_summary.jsonl` + `frontier_val.json` let
  each iteration see what's been tried without re-reading everything. Adapted as
  `memory/spec-ledger.jsonl` (via `scripts/spec-ledger.sh`) — one line per finished or
  blocked spec, appended by `spec-verify`, consulted by `spec-plan` before drafting into a
  previously-blocked area.

Left out again: tbench2's environment-bootstrap technique (smaller expected gain here — this
harness's executors already share the repo) and SIA's weight-update lever (no model training
in this repo). Both remain open if a future spec makes the case.

## 2026-07-08 — Axis diversity and provenance citation (specs 0027-0028)

Two more small Meta-Harness disciplines, continuing from 0021-0025:

- **0027 — axis tag + diversity nudge.** Meta-Harness tracks which named axis each candidate
  targets and requires diversifying when the same one repeats 3 times running. Added an
  optional `axis` frontmatter field (freeform, e.g. `verification-loop`, `tooling-rule`);
  `spec-verify` records it into the spec 0025 ledger; `spec-plan` glances at the last 3
  `finished` records' axes before drafting and notes (never blocks) a repeat. Deliberately
  optional/freeform rather than a required enum, to stay a strict extension of 0025 rather
  than forcing a retrofit of every existing spec.
- **0028 — cite external provenance.** Specs 0021-0027 each informally cited Meta-Harness in
  this file by habit; nothing required it. Meta-Harness's own instructions treat drawing on
  published approaches as an explicit, named practice. Made it explicit: `spec-plan` now asks
  whether a design substantially derives from an external source and carries the citation
  into `Implementation Notes`, following `spec-template.md`'s existing pattern of
  documentation-only rules (spec 0024's precedent) rather than new tooling.

Both are the direct output of "keep improving": mined further into the same reference
material rather than re-treading 0021-0025's ground. Still open, still set aside: tbench2
environment bootstrap, SIA weight updates.

## 2026-07-08 — Regression gate in verification (spec 0029)

`spec-verify` checked a spec's own criteria and Verification step but never the project's
standing gates, so an implementation could pass its own check while breaking other specs'
tests. Meta-Harness's outer loop scores every candidate on the full benchmark, never only
its target capability — translated here: verification now also runs the project's own gates
(`make check` + test suite for the harness; a nested project's declared equivalents,
discovered not hardcoded per spec 0024) and a gate failure fails the spec under the same
retry contract. Once per session against a shared tree, with attribution — not once per
spec. A project with no gates gets a note, not a failure.

## 2026-07-08 — Spec id 0026 is intentionally unused

During the 0027/0028 planning pass, 0026 was mentally allocated to a "write a lessons.md
entry on every success" spec mirroring Meta-Harness's mandatory per-iteration report — then
dropped on discovering spec-verify's Phase 6c had already deliberately decided against
routine success entries ("a notebook padded with 'it worked' entries stops being read"),
with the structured equivalent covered by 0025's ledger. The sibling specs were already
drafted as 0027/0028 and referenced by id across skills and the template, so the gap stays
rather than renumbering shipped references. If a future planning pass wants to reuse 0026:
fine — ids only need to be unique, not contiguous (check-specs.sh checks duplicates, not
gaps).

## 2026-07-08 — Criteria drift check: the test must not change while being taken (spec 0030)

The one Meta-Harness mechanism the earlier passes under-weighted: the held-out test set,
"never exposed during evolution," guarding the evaluation from the optimizing process. In a
file-based harness the implementer can't be denied access to the spec file — but edits to
the graded sections (Acceptance Criteria, Verification) can be made *visible*. check-specs
now WARNs ([criteria-drift]) when those sections differ from the base ref for any spec in
in_progress/ or waiting_verification/, finding the base file by id so lifecycle moves don't
false-positive. WARN not ISSUE: a criteria change can be a legitimate human-approved scope
decision; the invariant is that it can't happen silently. Reuses TRANSITION_BASE_REF and
0014's fail-open posture. Prototyped in /tmp first per 0022 — the first spec implemented
under the new discipline end-to-end (falsifiable claim stated, one mechanism, prototype,
provenance cited).

## 2026-07-08 — Spec files are not committed; convention carried as data (spec_files.tracked)

The repo owner decided spec documents should not be committed — PRs carry implementation
changes only. Rather than silently diverging the skills' prose from practice, the choice is
now a data knob in workflows/state.yaml (`spec_files.tracked`, currently false), following
the same "procedure in prose, limits in data" pattern as dispatch.max_concurrent. The
skills' add/commit steps for spec and trace paths are conditional on it. Known consequences,
accepted deliberately: with tracked: false the [illegal-transition] (0014) and
[criteria-drift] (0030) checks are dormant for spec files (no committed base to diff),
memory/spec-ledger.jsonl becomes the durable outcome record, and cycle-time metrics rely on
frontmatter history entries (0020) rather than the git fallback. Flipping the knob back to
true restores the original fully-reviewable convention without touching any prose.

## 2026-07-09 — Trace diff and confound-isolation in the fix path (specs 0031-0032)

A full re-read of the Meta-Harness paper (arXiv:2603.28052) against the adopted inventory
surfaced two missed mechanisms, both now in:

- **0031 — `spec-trace.sh diff`.** Appendix D's log-CLI guidance includes "diffs code and
  results between pairs of runs" — the one capability the trace CLI lacked. New `diff`
  subcommand compares two attempts of a spec (defaulting to the last two), answering the
  second-failure question directly: what did the fix actually change in observed behavior?
- **0032 — fix only what failed.** Appendix A.2's central causal lesson: the proposer's
  first two candidates bundled structural fixes with prompt edits, both regressed, and only
  isolating the changes revealed the confound; the eventual winner was deliberately
  additive. spec-exec's fix path now requires retries to change only what the failure
  record implicates, prefer additive changes over rewiring passing behavior, and diff the
  prior attempts' traces before a second fix. This extends 0023's one-mechanism planning
  rule to the retry loop, where it was missing.

Both cite exact paper locations; the rest of the unadopted inventory (per-iteration success
reports, Pareto frontier, interface-validation smoke test, separate evaluator agent) was
re-checked in the same pass and remains either already-covered or rejected for standing
reasons recorded above.
