---
id: "0028"
title: Require citing external provenance for borrowed designs
status: waiting_verification
depends_on: []
verify_attempts: 0
branch: "feat/0021-verification-trace-capture"
pr: "https://github.com/RyoKusnadi/rig-bench/pull/102"
history:
  - ready 2026-07-08T00:00:00Z
  - in_progress 2026-07-08T00:00:00Z
  - waiting_verification 2026-07-08T00:00:00Z
source: ""
axis: "planning-discipline"
---
## Problem

Specs 0021-0027 each substantially adapt a mechanism from an external paper and its reference
implementations (Meta-Harness, Lee et al. 2026), and each one records that provenance in
`memory/decisions.md` by habit — but nothing in `spec-plan` requires it. A future spec could
just as easily present a borrowed mechanism as if invented fresh, which matters because a
reader deciding whether to trust or extend an approach needs to know where its supporting
evidence actually comes from — the source paper's benchmark, another project's production
experience, or nothing beyond this repo's own reasoning. Meta-Harness's own proposer
instructions treat drawing on published approaches as an explicit, named-and-cited practice
rather than something to blend in silently.

## Acceptance Criteria

- `spec-template.md`'s `Implementation Notes` section guidance shall instruct that a design
  substantially borrowed from a paper, reference implementation, or other open-source project
  be named there (title/repo, plus a link when available).
- `spec-plan`'s Phase 2 intent-capture step shall ask, alongside the falsifiable claim,
  whether the design being drafted substantially derives from an external source, and carry
  the answer into the spec's `Implementation Notes` when it does.
- A spec whose design is derived entirely from this repo's own reasoning, with no substantial
  external source, is unaffected — this only applies when a real external source exists.

## Out of Scope

- Any citation format enforcement (a required bibliography section, a specific citation
  style) — a plain named reference with a link is sufficient, matching this repo's existing
  informal citations in `memory/decisions.md`.
- Retroactively auditing specs prior to 0021 for uncited provenance — this applies going
  forward; specs 0021-0027 already carry their citations informally in `memory/decisions.md`
  and this spec doesn't require rewriting them.
- Verifying the accuracy of a cited source's claims — citing a paper doesn't mean adopting its
  conclusions uncritically; that judgment stays with the person drafting and approving the
  spec.

## Files/Interfaces Touched

- `specs/spec-template.md` — `Implementation Notes` section guidance gains the
  citation instruction.
- `.claude/skills/spec-plan/SKILL.md` — Phase 2 gains the provenance question alongside the
  existing falsifiable-claim capture.

## Implementation Notes

This spec is itself an example of what it asks for: its design is drawn directly from
Meta-Harness's proposer instructions (`stanford-iris-lab/meta-harness`,
`reference_examples/*/.claude/skills/*/SKILL.md` — "draw on published approaches" language),
adapted from "combine mechanisms from other ML memory systems" to "combine mechanisms from
other specs or external projects" for a harness-improvement context. No new frontmatter field
or script is introduced — this is a documentation-only change to two files' guidance text,
consistent with spec 0024's precedent of adding a rule to existing prose rather than new
tooling.

## Verification

`grep -A3 "substantially borrowed" specs/spec-template.md` shows the citation instruction in
the `Implementation Notes` guidance. `grep -B2 -A6 "Where does this design come from" \
.claude/skills/spec-plan/SKILL.md` shows the Phase 2 question. `scripts/check-specs.sh
template` passes.
