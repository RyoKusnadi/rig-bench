# Specs

Specs are the short-form executable unit ("what to build, scoped to one PR"). A spec's
`rationale:` field can point at whatever prior context motivated it — an existing decision
in `.claude/memory/decisions.md`, a GitHub issue, a discussion, or a short description of
the request. Shipped/historical rationale lives in `.claude/memory/decisions.md`; specs are
reserved for forward-looking, not-yet-built, single-deliverable work.

## Rule

One spec = one deliverable, sized to fit a single `new-feature.js`/`bug-fix.js`/`refactor.js`
workflow run (one hook, one script, one schema change — not a whole feature's worth of work).

**Assess scope before drafting, not after.** Signals that a task should be split into
multiple specs:
- It touches files in unrelated areas (e.g. a new script *and* a hook that calls it)
- The Implementation Plan would list tasks across more than one coherent deliverable
- You'd naturally describe it as "X, and then Y" rather than just "X"

When splitting, allocate all IDs up front, cross-link via `depends_on` where one spec
genuinely blocks another, and draft each one in full before presenting any for review.

## Naming

`{0001}-{kebab-slug}.md` — sequential, zero-padded, never reused. IDs are stable references
for commit messages and PRs; don't renumber on reorder, use `depends_on` instead. This
matches GitHub Spec Kit's own numbering convention. When you start work on a spec, name the
feature branch after it (`0001-memory-vector-db-auto-ingest`) — makes it trivial to find the
spec a given branch/PR implements.

## Lifecycle

`draft` → `ready` → `in_progress` → `done` (or `blocked` / `abandoned`). On `done`, move
the file to `specs/done/`. `specs/done/` is gitignored — once a spec ships, the merged
PR/commit is the permanent record. Treat `specs/done/` as local scratch space, not history.

**Ambiguity gate:** a spec may contain inline `[NEEDS CLARIFICATION: ...]` markers while in
`draft`. It cannot move to `ready` while any marker remains unresolved — resolve each one
(edit the spec to answer it, or ask the human) before flipping status. Vague, unresolved
acceptance criteria is the single most-cited cause of spec drift in every convention
surveyed (Spec Kit, EARS).

## Validation

`depends_on` is checked, not just declared. `npm run specs:graph` (`scripts/specs-graph.mjs`)
walks `specs/*.md` and `specs/done/*.md` and reports three things, exiting 1 if any are
found: a cycle in `depends_on`, a `depends_on` pointing at an id that doesn't exist, and
drift — a `done` or `in_progress` spec depending on something still `draft`.

`/plan` resolves new `depends_on` references against the existing listing at creation time
(asking rather than guessing on a typo or unresolved sibling), but doesn't re-run the full
graph check itself except when scaffolding more than one spec at once. Run
`npm run specs:graph` directly any other time you want to confirm the whole graph is
consistent (e.g. after manually editing a spec's `status` or `depends_on`).

## Frontmatter

```yaml
---
id: 0001
title: Short imperative title
status: draft
depends_on: []
rationale: free text — a decision in .claude/memory/decisions.md, an issue link, or a short description of what motivated this spec
---
## Problem
## Acceptance Criteria
## Interface / Docs Preview
## Decisions
## Out of Scope
## Files / Interfaces Touched
## Implementation Plan
## Verification
```

### Section descriptions

- **Problem** — one short paragraph: what the current state is, why it's insufficient, and
  who is affected. Write it as a problem statement, not a solution description.

- **Acceptance Criteria** — EARS-style behavioral sentences, one per line, one behavior per
  sentence. Templates:
  - Ubiquitous: `The <component> shall <behavior>.`
  - Event-driven: `When <trigger>, the <component> shall <behavior>.`
  - Unwanted behavior: `If <condition>, then the <component> shall <behavior>.`

  One criterion = one sentence = one checkable thing. If a criterion needs "and" to join two
  unrelated behaviors, split it into two criteria. Write these as testable assertions, not
  aspirational goals.

- **Interface / Docs Preview** — write this as if documenting the finished feature. CLI:
  show example invocations and expected output. API: show the request/response contract.
  Hook: show the event shape and expected response format. This is the Karpathy
  "spec = basically the docs" step — if you can't write this section yet, the design isn't
  ready.

- **Decisions** — 2–5 bullet points in ADR format capturing the WHY behind key design
  choices made during the planning session: "We chose X over Y because Z." Persists
  reasoning that would otherwise evaporate after the session ends.

- **Out of Scope** — explicit exclusions. Name things that might seem in scope but aren't.
  A short bulleted list is fine; prose is not required. If nothing is excluded, write "None"
  rather than leaving the section blank — blank looks like "not considered."

- **Files / Interfaces Touched** — name the concrete files, functions, and schemas the spec
  will change. A spec that cannot name these yet isn't ready — that's a sign it needs more
  exploration or a `[NEEDS CLARIFICATION]` marker.

- **Implementation Plan** — ordered task list, one task per line, each small enough for a
  single workflow run. Tasks should be concrete enough that the next session can pick one up
  and execute it without re-reading the full spec.

- **Verification** — one end-to-end step proving the spec is done: a test name to run, a
  command and its expected output, or a manual check with a specific expected result.
  Required before a spec can move to `done`.

## Workflow

A spec's body is the `task` argument to a workflow — copy/summarize it directly into
`Agent`/`Workflow` invocations. No tooling change to `workflows/*.js` is required; this
folder is an authoring layer in front of the existing `task` string parameter.

Prefer authoring through `/plan` rather than writing a spec by hand. `/plan` does a scope
assessment before drafting (catching splits early), runs an intent-capture pass with the
user, and resolves `depends_on` references at creation time.
