---
id: "0000"
title: Short imperative title
status: draft
depends_on: []
verify_attempts: 0
branch: ""
pr: ""
history: []
source: ""
axis: ""
---
## Problem

What the current state is, and why it's insufficient. One or two sentences —
this section exists to justify the spec, not to re-explain the whole
feature.

## Acceptance Criteria

EARS-style behavioral sentences, one behavior per sentence:

- Ubiquitous: `The <component> shall <behavior>.`
- Event-driven: `When <trigger>, the <component> shall <behavior>.`
- Unwanted behavior: `If <condition>, then the <component> shall <behavior>.`

If a criterion needs "and" to join two unrelated behaviors, split it into
two criteria.

## Out of Scope

Explicit exclusions. Say what this spec deliberately does *not* cover, so
an implementer doesn't guess and drift from what was actually meant.

## Files/Interfaces Touched

Concrete files, functions, schemas the spec will change. A spec that can't
name these yet isn't ready — that's a sign it needs more exploration or a
`[NEEDS CLARIFICATION]` marker, not vaguer prose.

## Implementation Notes

Enough detail for an implementer to start without re-deriving the design —
key data structures, edge cases, the approach for anything non-obvious. This
is this convention's lightweight equivalent of Spec Kit/Kiro's `plan.md`.

If the design substantially borrows from a paper, a reference implementation, or another
open-source project, name the source here (title/repo + link if available) rather than
presenting the mechanism as invented fresh — a reader deciding whether to trust or extend the
approach needs to know where its evidence comes from.

## Verification

The concrete, end-to-end step that proves the spec is done: a test name to
run, a command and its expected output, or a manual check. Required before
a spec can move to `finished`.

`verify_attempts` (frontmatter) starts at `0` and is incremented by `spec-verify` each time
this spec fails verification; you don't set it by hand. A failed run also appends a
`## Verification Failures` section below this one — see "State Transitions" in
`specs/README.md` for the full retry contract. Don't author that section yourself; it's
generated.

`branch` and `pr` (frontmatter) start empty and are recorded by `spec-exec` when the
feature branch and draft PR are created — they're the traceability pointers from a spec to
its implementation. A spec reaching `finished/` with `pr` still empty is flagged by
`scripts/check-specs.sh` (specs predating these fields have no `pr` key and are exempt).

`history` (frontmatter) records when the spec entered each lifecycle state, as flat
`- <state> <ISO-8601 UTC timestamp>` entries. Whoever writes the spec to
`ready/` records the first entry, and each later move appends one in the same step as the
`git mv` and `status` edit (`date -u +%Y-%m-%dT%H:%M:%SZ`), replacing the empty `[]` with a
block list on first append:

```yaml
history:
  - ready 2026-07-07T04:00:00Z
  - in_progress 2026-07-08T09:30:00Z
```

`scripts/spec-metrics.sh` computes cycle time from these entries when present, falling back
to git history for specs that predate the convention.

`axis` (frontmatter, optional) is a short freeform label for which part of the harness this
spec primarily changes — e.g. `verification-loop`, `planning-discipline`, `tooling-rule`,
`memory-ledger`, `dispatch`. Left `""` for specs where no single axis is a natural fit (many
specs, especially outside `template/`'s own harness-improvement work, won't need one).
`spec-verify` records it into `memory/spec-ledger.jsonl` on `finished`/`blocked`,
and `spec-plan` checks recent axes there before drafting something in the same area
repeatedly — the label only needs to be consistent enough to `grep` for, not a
fixed enum.
