---
name: spec-plan
description: Run a collaborative planning session that produces a docs-level spec before any code is written, following this repo's spec-driven lifecycle in specs/<project>/. Use for requests to plan, design, or scope a feature, task, hook, or script ("let's plan X", "help me design a spec for Y", "let's build X" for anything nontrivial when no spec exists yet). Not for executing an already-approved spec or trivial one-line fixes — see the skill body for the full boundary.
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

**When this applies:** any request to plan, design, or scope work destined for a project's
specs pipeline — including proactively, when a user jumps straight to "let's build X" for
anything nontrivial (more than a one-line change) and no spec for X exists yet. Pause and
offer to plan first rather than writing code against an unstated design. This does *not*
apply to executing an already-approved spec (a separate implementation phase) or to trivial
one-line fixes that don't warrant a spec at all.

## Phase 0 — Resolve the project

Follow "Resolving the target project" in `specs/README.md` — the canonical procedure, shared
by every entry point into the spec workflow. If the task clearly names or
implies a project (e.g. it's about something under `projects/<name>/`), use that project;
otherwise apply the resolution order described there.

## Phase 1 — Orient

1. Read `specs/README.md` for this repo's frontmatter and lifecycle conventions (don't assume
   — conventions like status names and folder structure can drift from what's described here).
2. Read `specs/spec-template.md` — this is the canonical spec shape. Don't
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
- **What's the falsifiable claim this design rests on?** State it as "if this ships, X should
  happen" — something concrete enough that it could turn out to be wrong (PR #102). If the
  honest answer is "this just adjusts an existing knob" (a limit, a threshold, a default), say
  so plainly rather than dressing it up as a new capability — that's still a legitimate spec,
  just a smaller one, and naming it accurately keeps the batch's `depends_on` graph and scope
  honest.
- **Where does this design come from?** If it substantially borrows from a paper, a reference
  implementation, or another project — rather than being derived fresh from this repo's own
  problem — say so and carry the citation into the spec's `Implementation Notes` (per the
  template's note). Presenting a borrowed mechanism as if newly invented deprives a later
  reader of the chance to go check the source when the spec's own reasoning is thin (PR
  #102).
- **What are the key decisions that must be made?** Significant ones are worth surfacing
  explicitly with the user even though the template doesn't have a dedicated section for
  them — fold the reasoning into `Problem` or `Implementation Notes` so it isn't lost.
- **What's explicitly out of scope?** Say so now — an agent implementing later will guess,
  and guesses drift from what was actually meant.

If the task is ambiguous on any of these, ask rather than assume. A wrong guess here costs
much more than the question would have.

**Check every spec, regardless of size, against `CLAUDE.md`'s "Non-negotiables" section** —
the repo's short list of hard constraints (destructive git ops, auth/secrets handling, branch
discipline). Unlike the considerations scan below, this doesn't get skipped for trivial
specs: a one-line fix can still touch a secret or need a force-push. If a spec's
Implementation Notes would violate one, that's a blocker to flag before drafting continues.

**Consult `memory/` at the same moment** — `grep -ri <key terms> memory/` (or read the three
notebooks directly; they're short). Past decisions, gotchas, and lessons that touch this
spec's area go into its `Implementation Notes` with their provenance tag, so the implementer
inherits them instead of rediscovering them. A memory hit that *contradicts* the spec's
direction is worth surfacing to the user before drafting continues — the point of
`memory/decisions.md` is that overturning one should be a choice, not an accident.

Also check `scripts/spec-ledger.sh list <project> blocked` — if a past spec in this area was
already tried and blocked, that's worth surfacing before drafting a similar one from scratch
(PR #102); read the blocked spec file itself (still on disk under `blocked/`) for why it
didn't make it, rather than only the one-line ledger record.

While you're there, glance at whether the last 3 `finished` records for this project
(`scripts/spec-ledger.sh list <project> finished`, most recent lines) share the same `axis`.
Three in a row on the same axis isn't wrong, but it's worth a one-line note to the user before
drafting a fourth — "the last three specs were all `<axis>`; want to keep going there or look
elsewhere?" — rather than silently continuing down the same groove (PR #102). This is
advisory, never a block: the user may have good reason to keep going (a multi-spec sequence
genuinely isn't done yet), and axis is optional freeform text, not every spec sets one.

### Considerations scan (skip for trivial specs)

For anything with real surface area — new UI, new service, new integration, anything
touching data or auth — there's a second layer beyond scope: dimensions the user didn't
mention but that materially change the design if the answer isn't the default. A frontend
task might turn out to need responsive layout, or a specific deploy target, or accessibility
compliance; a backend task might turn out to need rate limiting, or a specific auth model.
None of these are guessable from silence, and guessing wrong here is expensive to unwind
after code exists. Skip this whole scan for one-line fixes or specs where nothing about the
task suggests hidden surface area — it's not free, so don't run it reflexively.

**Don't keep a fixed per-domain checklist.** A hardcoded "frontend needs responsive+security
+deploy" list will always miss whatever domain it wasn't written for, and worse, it creates
false confidence — once a box is ticked, it's easy to stop actually thinking about it. Instead
scan these generic dimensions and judge, for *this specific task*, whether each is
**Clear** (obvious from the task or the repo's existing conventions), **Not applicable**, or
**Genuinely open** (the deliverable's design meaningfully changes depending on the answer):

- **Non-functional attributes** — performance, security, accessibility, responsiveness,
  scale — whatever's relevant to what's being built.
- **Integration & dependencies** — what this touches or depends on that isn't obvious from
  the task description alone.
- **Operational surface** — how this gets deployed, run, or rolled back, if that's not
  already fixed by the repo's existing setup.
- **Edge cases & failure handling** — what happens when the happy path doesn't hold.

Before asking about any dimension, check whether the repo already answers it — read
`package.json`/config files/existing deploy setup/CLAUDE.md conventions first. A dimension
answered by the codebase isn't a question, it's a fact to state in the spec. Only dimensions
that are both **Genuinely open** *and* would change the Implementation Plan depending on the
answer become questions — this mirrors why Spec Kit's own clarify step caps itself at a
handful of high-impact questions rather than working through every category exhaustively:
asking about something whose answer doesn't change the design is pure ceremony, and burns
the user's patience for the question that actually matters.

**Asking:** batch the surviving questions into one `AskUserQuestion` call (or present them
together in your response if that tool isn't available) rather than a back-and-forth
volley — the user reviews the whole set of genuinely open points once, not one at a time.
Keep it to the handful that clear the bar above; five is a reasonable ceiling before it stops
feeling like a short check-in and starts feeling like an interrogation.

**Recommending, not just asking:** don't hand back an open-ended "what do you want for X?" —
that pushes research the agent is better positioned to do back onto the user. For anything
where current best practice or the project's existing stack determines a sensible default
(a deploy target, a common library choice, a standard pattern for this kind of feature),
web-search it and propose that default with a one-line reason, so the question becomes
"here's what I'd do and why — confirm or override" instead of a blank prompt. Reserve open
questions for genuine product/design calls that research can't answer (e.g. "should this be
mobile-first or desktop-first for your users").

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

**One mechanism per spec — check even a single-deliverable spec for this.** A spec can be one
file and still bundle two independent changes disguised as one ("and also fix X while we're in
there"). Before drafting, check the falsifiable claim from Phase 2 against the acceptance
criteria being assembled: does every criterion serve that one claim, or has a second,
unrelated claim crept in? If you're tempted to add "and also..." to the Problem statement,
that's very likely a second spec, not an extra paragraph in this one (PR #102). This is
distinct from the deliverable-count check above — a single-file spec can still fail it.

Follow `specs/spec-template.md` for each spec, whether drafting one or several. The
plan must contain the literal file content for every spec, not a description of what it would
contain. Default `status: ready` — an approved spec goes straight to
`specs/<project_name>/ready/`, skipping `draft/`. Set the frontmatter `axis` field when the
spec clearly targets one identifiable part of the harness (see the template's note on `axis`
for examples and guidance) — leave it `""` when nothing natural fits rather than forcing a
label.

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
3. Run `scripts/check-specs.sh <project_name>` — catches duplicate IDs, dangling
   `depends_on`, and specs that have grown past the one-deliverable sizing rule. If it
   reports issues, fix them before reporting success; don't leave a broken batch behind.
4. Report the file path(s) and id(s) back to the user.
