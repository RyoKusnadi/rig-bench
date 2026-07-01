---
id: "0000"
title: Short imperative title
status: draft
depends_on: []
verify_attempts: 0
source: todo.md#anchor-or-section-name
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

## Verification

The concrete, end-to-end step that proves the spec is done: a test name to
run, a command and its expected output, or a manual check. Required before
a spec can move to `finished`.

`verify_attempts` (frontmatter) starts at `0` and is incremented by `spec-verify` each time
this spec fails verification; you don't set it by hand. A failed run also appends a
`## Verification Failures` section below this one — see "State Transitions" in
`specs/README.md` for the full retry contract. Don't author that section yourself; it's
generated.
