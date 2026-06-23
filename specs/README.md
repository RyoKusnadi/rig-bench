# Specs

Specs are the short-form executable unit ("what to build, scoped to one
PR"). A spec's `source:` field can point at whatever prior context
motivated it — an existing decision in `.claude/memory/decisions.md`, a
GitHub issue, a discussion, or a short description of the request — there's
no single canonical long-form doc it's decomposed from. Shipped/historical
rationale (decisions already made and built) lives in
`.claude/memory/decisions.md`; specs are reserved for forward-looking,
not-yet-built, single-deliverable work.

## Rule

One spec = one deliverable, sized to fit a single `new-feature.js`/`bug-fix.js`/
`refactor.js` workflow run (one hook, one script, one schema change — not a
whole feature's worth of work). If a spec's Implementation Notes start
spanning multiple unrelated files, split it.

This is a deliberate divergence from GitHub Spec Kit and Kiro, which split
each feature into separate `spec.md` (requirements)/`plan.md`
(design)/`tasks.md` files. That split earns its weight for large,
multi-week features; for rig-bench's one-deliverable sizing rule it would
mostly be ceremony, so Problem/Acceptance Criteria stay merged with
Implementation Notes in a single file. Implementation Notes is this
convention's lightweight equivalent of Spec Kit/Kiro's `plan.md`.

## Naming

`{0001}-{kebab-slug}.md` — sequential, zero-padded, never reused. IDs are
stable references for commit messages and PRs; don't renumber on reorder,
use `depends_on` instead. This matches GitHub Spec Kit's own numbering
convention. When you start work on a spec, name the feature branch after it
(`0001-memory-vector-db-auto-ingest`) the same way Spec Kit mirrors its
feature-number+slug as the branch name — makes it trivial to find the spec
a given branch/PR implements.

## Lifecycle

`draft` → `ready` → `in_progress` → `done` (or `blocked` / `abandoned`).
On `done`, move the file to `specs/done/`. `specs/done/` is gitignored — once
a spec ships, the merged PR/commit is the permanent record, not the spec
file itself. Treat `specs/done/` as local scratch space, not history.

**Ambiguity gate:** a spec may contain inline `[NEEDS CLARIFICATION: ...]`
markers while in `draft`. It cannot move to `ready` while any marker remains
unresolved — resolve each one (edit the spec to answer it, or ask the human)
before flipping status. This mirrors Spec Kit's same marker pattern and
exists because vague, unresolved acceptance criteria is the single
most-cited cause of spec drift in every convention surveyed (Spec Kit, EARS).

## Validation

`depends_on` is checked, not just declared. `npm run specs:graph`
(`scripts/specs-graph.mjs`) walks `specs/*.md` and `specs/done/*.md` and
reports three things, exiting 1 if any are found: a cycle in `depends_on`, a
`depends_on` pointing at an id that doesn't exist, and drift — a `done` or
`in_progress` spec depending on something still `draft`. `/specs` resolves
new `depends_on` references against the existing listing at creation time
(asking rather than guessing on a typo or an unresolved sibling), but doesn't
re-run the full graph check itself except when scaffolding more than one
spec at once — run `npm run specs:graph` directly any other time you want to
confirm the whole graph is still consistent (e.g. after manually editing a
spec's `status` or `depends_on`).

## Frontmatter

```yaml
---
id: 0001
title: Short imperative title
status: draft
depends_on: []
source: free text — a decision in .claude/memory/decisions.md, an issue link, or a short description of what motivated this spec
---
## Problem
## Acceptance Criteria
## Out of Scope
## Files/Interfaces Touched
## Implementation Notes
## Verification
```

- **Files/Interfaces Touched** — name the concrete files/functions/schemas
  the spec will change. A spec that can't name these yet isn't ready —
  that's a sign it needs more exploration or a `[NEEDS CLARIFICATION]`
  marker, not vaguer prose.
- **Verification** — the concrete, end-to-end step that proves the spec is
  done (a test name to run, a command and its expected output, a manual
  check). Required before a spec can move to `done`. (Both of these come
  directly from Anthropic's own Claude Code spec-writing guidance: "the most
  useful specs are self-contained — they name the files and interfaces
  involved, state what is out of scope, and end with an end-to-end
  verification step that proves the feature works.")

### Acceptance Criteria format

Write each criterion as one EARS-style sentence instead of free prose —
this is the cheapest lever for making criteria testable/unambiguous rather
than aspirational:

- Ubiquitous: `The <component> shall <behavior>.`
- Event-driven: `When <trigger>, the <component> shall <behavior>.`
- Unwanted behavior: `If <condition>, then the <component> shall <behavior>.`

One criterion = one sentence = one checkable thing. If a criterion needs
"and" to join two unrelated behaviors, split it into two criteria.

## Workflow

A spec's body is the `task` argument to a workflow — copy/summarize it
directly into `Agent`/`Workflow` invocations. No tooling change to
`workflows/*.js` is required; this folder is an authoring layer in front of
the existing `task` string parameter.

For a non-trivial spec, prefer authoring it through an interview pass
(`/specs` already does this via `AskUserQuestion` before drafting) rather
than writing the full spec in one shot — per Anthropic's guidance, having
the agent ask clarifying questions before the spec is written catches
ambiguity earlier and cheaper than catching it during implementation.

## References

Conventions above are adapted from, in order of how directly they're
followed:
- [GitHub Spec Kit](https://github.com/github/spec-kit) — numbering, branch
  naming, `[NEEDS CLARIFICATION]` marker, testable/unambiguous requirements
  as a quality gate.
- [Anthropic Claude Code best practices](https://code.claude.com/docs/en/best-practices)
  — self-contained specs (files/interfaces named, verification step
  required), interview-first authoring.
- [EARS (Easy Approach to Requirements Syntax)](https://www.iaria.org/conferences2013/filesICCGI13/ICCGI_2013_Tutorial_Terzakis.pdf)
  — structured acceptance-criteria sentence templates.
- [Kiro](https://kiro.dev/docs/specs/best-practices/) — multi-file
  requirements/design/tasks split (considered, not adopted — see "Rule"
  above).
- [MADR](https://github.com/adr/madr) — decision-record frontmatter/structure
  (general structural analogy only; not adopted wholesale).
