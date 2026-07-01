---
name: spec-plan
description: Run a collaborative planning session that produces a docs-level spec *before* any code is written, following the spec-driven lifecycle used in this repo's specs/<project>/ folders. Use this whenever the user wants to plan, design, or scope a feature, task, hook, script, or schema change — phrases like "let's plan X", "help me design a spec for Y", or "I want to think this through before coding", or any request to add work to a project's specs pipeline. Also use it proactively when a user jumps straight to "let's build X" for anything nontrivial (more than a one-line change) and no spec for X exists yet — pause and offer to plan first rather than writing code against an unstated design. Do not use this for executing an already-approved spec (that's a separate implementation phase) or for trivial one-line fixes that don't warrant a spec.
---

# Spec Planning

This skill runs the pre-implementation half of this repo's spec-driven workflow: agent and
user co-design a docs-level spec before any code exists. The spec is the source of truth —
not the code that follows it. This mirrors Karpathy's "agentic engineering" workflow: writing
the docs *first* forces the design decisions to happen while they're still cheap to change,
instead of getting discovered halfway through an implementation.

**Never write a spec file — or any code — before the user has approved the plan.** If your
tools include a plan-mode primitive (e.g. `EnterPlanMode`/`ExitPlanMode`), use it: draft
everything in plan mode and only write to disk after explicit approval. If no such primitive
is available, simulate the same discipline — present the full spec content in your response
and wait for a clear go-ahead before creating any file.

## Phase 0 — Resolve the project

Specs are scoped per project under `specs/<project_name>/` (see `specs/README.md`) —
`specs/rig-bench/` for the harness itself, or `specs/<name>/` for a project under
`projects/`. Before anything else, figure out which project this planning session is for:

```bash
ls specs/ 2>/dev/null | grep -v '^template$'
```

- If the task clearly names or implies a project (e.g. it's about something under
  `projects/<name>/`), use that project.
- If only one project folder exists, use it without asking.
- If multiple project folders exist and it's not obvious which one, ask rather than guess.
- If the target project's `specs/<project_name>/` folder doesn't exist yet, create the full
  lifecycle skeleton before drafting (see "Starting a new project's specs folder" in
  `specs/README.md`) rather than writing into a partial structure.

## Phase 1 — Orient

1. Read `specs/README.md` for this repo's frontmatter and lifecycle conventions (don't assume
   — conventions like status names and folder structure can drift from what's described here).
2. Read `specs/template/spec-template.md` — this is the canonical spec shape. Don't
   reconstruct the section list from memory; that file is the single source of truth and may
   have changed since this skill was last updated.
3. Find the highest existing spec `id` within the resolved project:
   ```bash
   find specs/<project_name> -name "[0-9]*.md" | sort | tail -1
   ```
   Allocate every `id` this session will need from this single read. Re-scanning mid-session
   is how two specs in the same planning pass end up with the same id. IDs are per-project —
   don't carry a number over from a different project's sequence.

## Phase 2 — Capture intent before drafting anything

A spec written before intent is understood just encodes guesses. Work through these with the
user first:

- **What does success look like from the user's perspective?** Not "the code runs" — what
  changes for the person who asked for this.
- **What would the docs say if this shipped?** Draft this mentally; it becomes the `Problem`
  and `Acceptance Criteria` sections.
- **What are the key decisions that must be made?** Significant ones are worth surfacing
  explicitly with the user even though the template doesn't have a dedicated section for
  them — fold the reasoning into `Problem` or `Implementation Notes` so it isn't lost.
- **What's explicitly out of scope?** Say so now — an agent implementing later will guess,
  and guesses drift from what was actually meant.

If the task is ambiguous on any of these, ask rather than assume. A wrong guess here costs
much more than the question would have.

## Phase 3 — Draft the spec(s)

**Assess scope first.** Count the distinct deliverables in the task:

- **One deliverable** (one hook, one script, one schema change, one command) → draft a single
  spec.
- **Multiple unrelated deliverables**, or an implementation plan that would span unrelated
  files → split now, before drafting starts. Allocate one `id` per spec from the Phase 1
  listing. Draft each spec in full, and cross-link via `depends_on` where one genuinely blocks
  another — set the pointer while the relationship is fresh, not as an afterthought. If a
  `depends_on` id doesn't exist yet and isn't a sibling being drafted in this same pass, ask
  rather than write a dangling reference.

Follow `specs/template/spec-template.md` for each spec, whether drafting one or several. The
plan must contain the literal file content for every spec, not a description of what it would
contain. Default `status: ready` — an approved spec goes straight to
`specs/<project_name>/ready/`, skipping `draft/`.

As a quick reference, the template's sections are:

1. **Problem** — current state, and why it's insufficient.
2. **Acceptance Criteria** — EARS-style behavioral sentences, one behavior per sentence.
3. **Out of Scope** — explicit exclusions.
4. **Files/Interfaces Touched** — concrete files, functions, schemas. Required — a spec
   that can't name these isn't actually ready to implement.
5. **Implementation Notes** — enough detail for an implementer to start without
   re-deriving the design: key data structures, edge cases, the approach for anything
   non-obvious.
6. **Verification** — one end-to-end check that proves the spec is done: a test name, a
   command with expected output, or a manual step.

Always check the actual template file rather than trusting this list — it's a convenience
summary, not the source of truth.

## Phase 4 — Get approval, then write

1. Present the full drafted spec content for review (via plan-mode exit, or directly in your
   response if no plan-mode primitive exists).
2. After approval, write each spec to `specs/<project_name>/ready/{id}-{kebab-slug}.md` with
   `status: ready`, exactly as approved — no additions, removals, or reordering slipped in
   during the write.
3. Report the file path(s) and id(s) back to the user.
