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
