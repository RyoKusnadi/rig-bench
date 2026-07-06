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
