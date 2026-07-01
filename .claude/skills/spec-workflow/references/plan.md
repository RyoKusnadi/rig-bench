# Plan phase

Collaborate on a planning session for the task at hand. This phase runs
entirely in plan mode — nothing gets written to `specs/` until the user has
seen and approved the content. The point of the phase is to catch scope and
ambiguity problems while they're still cheap to fix, before either of you
has sunk time into implementation.

## Phase 1 — Enter plan mode and orient

1. Call `EnterPlanMode` immediately — this keeps the session honest about
   not writing files yet.
2. Read `specs/README.md` for the frontmatter/lifecycle and template
   convention if you haven't already this session.
3. Run `find specs -name "[0-9]*.md" | sort | tail -1` to find the highest
   existing `id` across all lifecycle folders. Allocate every new `id` this
   session needs from this single read — re-scanning mid-pass is how two
   specs drafted in the same session end up claiming the same ID.

## Phase 2 — Intent capture (the Karpathy step)

Before drafting any spec content, reason through these with the user. This
is the part that's easy to skip under time pressure and the part that
actually prevents wasted implementation work later:

- **What does success look like from the user's perspective?** Not just
  "the code runs" — what changes for them.
- **What would the docs say if this shipped?** Sketch this mentally; it
  becomes the Problem and Acceptance Criteria sections.
- **What are the key decisions that must be made?** Capture them explicitly
  in Decisions — reasoning that isn't written down evaporates the moment
  the session ends.
- **What's explicitly out of scope?** Say so now. Left unstated, the
  implementer (possibly a future session with none of this context) will
  guess, and guesses drift.

If the task description is ambiguous on any of the above, use
`AskUserQuestion` to resolve it before writing the plan. Guessing on scope
is the single most expensive mistake this phase exists to prevent.

## Phase 3 — Draft the spec(s)

**First, assess scope.** Before writing any spec content, count the
distinct deliverables in the request:

- **One deliverable** (one hook, one script, one schema change, one
  command) → draft a single spec.
- **Multiple unrelated deliverables**, or the Implementation Plan would
  span files in unrelated areas → split now, before drafting. Allocate one
  `id` per spec from the single listing read in Phase 1. Draft each spec in
  full. Cross-link via `depends_on` where one genuinely blocks another —
  set those pointers now, while the relationship is clear, not after the
  fact. If a `depends_on` id doesn't exist and isn't a sibling in this
  pass, use `AskUserQuestion` rather than writing a dangling reference.

The template below applies to **each** spec, whether drafting one or
several. The plan must contain the literal file content for every spec —
not a description of what the spec will say. Default `status: ready` — the
spec is written directly to `specs/ready/` after user approval, skipping
the draft folder entirely (drafts exist for specs that still carry
`[NEEDS CLARIFICATION]` markers; if Phase 2 did its job, there shouldn't be
any left).

Spec sections, in order:

1. **Problem** — what the current state is and why it's insufficient.
2. **Acceptance Criteria** — EARS-style behavioral sentences, one behavior
   per sentence (see `specs/README.md` for the three EARS templates). If a
   criterion needs "and" to join two unrelated behaviors, split it.
3. **Interface / Docs Preview** — write this as if it's the README or
   inline docs for the feature. CLI command → example invocations. API →
   the contract. Hook → the event shape and response format. This is the
   "spec = basically the docs" step — writing it forces the interface
   decisions to happen now instead of being improvised mid-implementation.
4. **Decisions** — 2–5 bullets capturing the *why* behind key design
   choices from this session, ADR-style ("We chose X over Y because Z").
5. **Out of Scope** — explicit exclusions.
6. **Files / Interfaces Touched** — concrete files, functions, schemas.
   Required: a spec that can't name these yet isn't actually ready, no
   matter how confident the prose sounds — that's a sign it needs more
   exploration, not vaguer wording.
7. **Implementation Plan** — ordered task list, one task per line, each
   small enough for a single execute run.
8. **Verification** — one end-to-end check proving the spec is done (test
   name, command + expected output, or manual step).

## Phase 4 — Exit and write

1. Call `ExitPlanMode` with all drafted spec content for user review.
2. After approval, write each spec to `specs/ready/{id}-{kebab-slug}.md`
   with `status: ready`, exactly as approved — no additions, removals, or
   reordering. The user approved *that* content; silently improving it on
   write defeats the point of the review step.
3. Report the file path(s) and id(s).

Start the phase by saying "Planning: <task>" and calling `EnterPlanMode`.
