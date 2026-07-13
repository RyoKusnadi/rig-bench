# Spec template

The canonical spec shape. A spec lives in `spec.db` as a row plus a markdown body — this
file defines both halves: the fields the DB tracks, and the body's required sections.
`spec-db.mjs add` seeds a new spec's body with exactly the `## ` sections below, and
`spec-db.mjs check` derives its required-section list from this file's `## ` headings —
so this file is the single source of truth for the spec shape; change it here, nowhere
else. **Every `## ` heading in this file becomes a required section in every spec**, so
keep supporting prose (like the field list below) under non-`## ` headings.

### Fields (DB columns, managed via `scripts/spec-db.mjs`)

Not body sections — these are the row-level facts alongside the body:

- `id` — `0001`-style, allocated by `add`, sequential per project, never reused.
- `title` — short imperative title (`add` argument, editable via `edit`).
- `status` — lifecycle state; changes only through `move`, which enforces
  `workflows/state.yaml`'s `valid_next` and the dependency gate.
- `depends_on` — edges in the `dependencies` table; edit via `dep add` / `dep rm`.
- `verify_attempts` — starts at `0`; incremented only by `record-attempt` on FAIL. A
  failed run also puts a `## Verification Failures` section into the body (spec-verify
  writes it — don't author it yourself) — see "State Transitions" in `specs/README.md`
  for the full retry contract. Settable by hand only for the human un-blocking reset
  (`set <project> <id> verify_attempts 0`).
- `branch`, `pr` — recorded by `spec-exec` (`set`) when the feature branch and draft PR
  are created; the traceability pointers from a spec to its implementation. A spec
  reaching `finished` with `pr` still empty is flagged by `spec-db.mjs check`.
- `axis` (optional) — short freeform label for which part of the harness this spec
  primarily changes — e.g. `verification-loop`, `planning-discipline`, `tooling-rule`,
  `memory-ledger`, `dispatch`. Left `""` where no single axis is a natural fit.
  Terminal moves carry it into the ledger, and `spec-plan` checks recent ledger axes
  before drafting something in the same area repeatedly — the label only needs to be
  consistent enough to search for, not a fixed enum.
- Transition history — recorded automatically by every `move` (state, actor, UTC
  timestamp); `show` prints it, `metrics` computes ready→finished cycle time from it.
- The `source` convention (pointer into a project's long-form rationale doc, when one
  exists) is described in `specs/README.md` "Template".

The body sections every spec carries:

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
