---
description: Collaborative planning session — design a spec with your agent before writing any code. Usage: /plan <task or description>
---

Collaborate on a planning session for: $ARGUMENTS

This command follows Karpathy's "agentic engineering" pre-implementation workflow: the agent
and user co-design a docs-level spec *before* any code is written. The spec is the source
of truth — not the code that comes after.

Runs entirely in plan mode. Never create a file before the user approves the plan.

**Phase 1 — Enter plan mode and orient**
1. Call `EnterPlanMode` immediately.
2. Read `specs/README.md` for the frontmatter/lifecycle and template convention.
3. List `specs/*.md` and `specs/done/*.md` to find the highest existing `id`. Allocate
   every new `id` this session needs from this single read (never re-scan mid-pass — doing
   so causes id collisions when drafting multiple specs together).
4. If `$ARGUMENTS` references a decision in `.claude/memory/decisions.md`, a GitHub issue,
   or prior discussion, read it now for `rationale:` framing.

**Phase 2 — Intent capture (the Karpathy step)**

Before drafting any spec content, reason through these with the user:
- **What does success look like from the user's perspective?** (not just "the code runs")
- **What would the docs say if this was shipped?** (write this mentally — it becomes the
  Problem and Acceptance Criteria sections)
- **What are the key decisions that must be made?** (capture them explicitly in Decisions)
- **What is explicitly out of scope?** (say so now, or the agent will guess)

If `$ARGUMENTS` is ambiguous on any of the above, use `AskUserQuestion` to resolve it
before writing the plan. Never guess on scope.

**Phase 3 — Draft the spec(s)**

**First, assess scope.** Before writing any spec content, count the distinct deliverables
in $ARGUMENTS:

- **One deliverable** (one hook, one script, one schema change, one command) → draft a
  single spec below.
- **Multiple unrelated deliverables**, or the Implementation Plan would span files in
  unrelated areas → split now, before drafting. Allocate one `id` per spec from the single
  listing read in Phase 1. Draft each spec in full. Cross-link via `depends_on` where one
  genuinely blocks another (set those pointers now, while the relationships are clear — not
  after). If a `depends_on` id doesn't exist and isn't a sibling in this pass, use
  `AskUserQuestion` rather than writing a dangling reference.

The template below applies to **each** spec, whether you're drafting one or several.
The plan must contain the literal file content for every spec — not just a description.
Default `status: draft`.

Spec sections (in order):
1. `Problem` — what the current state is and why it's insufficient
2. `Acceptance Criteria` — EARS-style behavioral sentences (one behavior per sentence)
3. `Interface / Docs Preview` — write this as if you're writing the README or inline docs
   for the feature. If it's a CLI command, show example invocations. If it's an API, show
   the contract. If it's a hook, show the event shape and response format. This is the
   Karpathy "spec = basically the docs" step.
4. `Decisions` — 2–5 bullet points capturing the WHY behind key design choices made during
   this planning session. Use ADR format: "We chose X over Y because Z." These persist the
   reasoning that would otherwise evaporate after the session.
5. `Out of Scope` — explicit exclusions
6. `Files / Interfaces Touched` — concrete files, functions, schemas (required; a spec that
   cannot name these is not ready)
7. `Implementation Plan` — ordered task list, one task per line, each small enough for a
   single workflow run
8. `Verification` — one end-to-end check proving the spec is done (test name, command +
   expected output, or manual step)

**Phase 4 — Exit and write**
5. Call `ExitPlanMode` with all drafted spec content for user review.
6. After approval, write each spec to `specs/{id}-{kebab-slug}.md` exactly as approved.
   No additions, removals, or reordering.
7. Report the file path(s) and id(s). If more than one spec was created, also run
   `npm run specs:graph` and report its result — confirms `depends_on` links resolve
   cleanly before handoff.

Start by saying: "Planning: $ARGUMENTS" then call `EnterPlanMode`.
