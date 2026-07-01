---
name: spec-exec
description: Implements approved specs already sitting in a project's ready/ or in_progress/ folder under specs/<project>/, following this repo's spec-driven lifecycle. Use whenever the user asks to execute, implement, build, run, ship, kick off, or resume an approved spec — phrases like "let's execute 0001", "implement the ready specs", "run all specs for template", "resume 0003", "kick off the specs", "pick up where we left off on 0004", or "let's build X" when a spec for X already exists in ready/ or in_progress/. Does not apply to designing a spec that doesn't exist yet (use spec-plan for that) or to confirming already-implemented work meets its acceptance criteria (verification is a separate phase) — see the skill body for the full boundary.
---

# Spec Execution

This skill runs the implementation half of this repo's spec-driven workflow: an approved spec
in `ready/` (or `in_progress/`, if resuming) gets turned into working code, one feature branch
and PR per spec, moved through the lifecycle as it goes. The spec is the source of truth for
what "done" means — implement to the spec, not around it.

**When this applies:** any request to execute, implement, build, run, or ship specs that
already exist in a project's `ready/` or `in_progress/` folder — including proactively, when a
user says "let's build X" and a matching spec is already sitting in `ready/`. This does *not*
apply to designing a spec that doesn't exist yet (use the `spec-plan` skill first) or to
confirming already-implemented work meets its acceptance criteria (that's verification, a
separate phase).

## Phase 0 — Resolve the project

Follow "Resolving the target project" in `specs/README.md` — the canonical procedure, shared
by every entry point into the spec workflow. Match a named
project against the candidate list from the user's request; if none is named, apply the
resolution order described there rather than guessing.

All `specs/...` paths below are relative to `specs/<project>/` — e.g. "`ready/`" means
`specs/<project>/ready/`.

## Phase 1 — Discover specs

List available spec files:
```bash
ls specs/<project>/ready/ 2>/dev/null | grep '\.md$'
```
If resuming, also list:
```bash
ls specs/<project>/in_progress/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter of each file and extract `id`, `title`, `status`, and `depends_on`. Also
collect the IDs already in `specs/<project>/finished/` — they count as pre-satisfied
dependencies:
```bash
ls specs/<project>/finished/ 2>/dev/null | grep '\.md$' | sed 's/-.*//' | head -100
```
Re-scanning these lists mid-session is how a spec that just finished gets treated as still
pending — read them once per Phase 1 pass, not repeatedly.

## Phase 2 — Determine which specs to run

- **User didn't name specific IDs**: present the discovered specs and ask which to run — show
  each as `{id} — {title}` with its `depends_on` listed, and offer "all ready specs" as an
  option.
- **User said "all"**: select every discovered spec.
- **User named specific IDs** (e.g. "0001 and 0003"): select only those. If any named ID isn't
  found in `ready/` (or `in_progress/` when resuming), stop and report the missing ID rather
  than silently skipping it.

## Phase 3 — Validate dependencies

For each selected spec, every entry in its `depends_on` must be either already in
`finished/`, or also in the selected set for this run. If anything is unsatisfied, **stop**
before implementing anything and report clearly, e.g.:
```
Spec 0003 depends on spec 0001, but 0001 is not finished and was not selected.
Either add 0001 to the run or make sure 0001 is in specs/<project>/finished/ first.
```
Don't proceed past this until every dependency is satisfied — a spec implemented against a
missing dependency is rework waiting to happen.

## Phase 4 — Flag file overlap (advisory, don't block)

For specs that will run concurrently (no dependency between them), check whether their
"Files/Interfaces Touched" sections share any files. If they do, warn the user before
proceeding — e.g. "0001 and 0002 both touch lib/foo.mjs; running them concurrently risks a
merge conflict between their PRs" — but continue anyway. This is a heads-up, not a gate; the
gate for this already ran at spec-approval time (see `spec-plan`'s file-conflict scan).

## Phase 5 — Execute each spec

Process specs in dependency order — specs with no unfinished `depends_on` first, then specs
whose dependencies just completed within this run. For each spec:

1. **Move to in_progress.** `git mv specs/<project>/ready/<filename> specs/<project>/in_progress/<filename>` (skip this if resuming a spec already there).
2. **Implement.** Read the full spec content and implement every acceptance criterion: create
   a feature branch named after the spec ID and slug, make the changes, commit, open a draft
   PR. Check the implementation against `CLAUDE.md`'s "Non-negotiables" before committing —
   the same constraints `spec-plan` checks at design time still apply at implementation time
   (e.g. no direct commits to the default branch, no destructive git ops without confirming).
3. **Move to waiting_verification.** `git mv specs/<project>/in_progress/<filename> specs/<project>/waiting_verification/<filename>`.
4. Report: `Spec {id} — {title}: implementation complete, awaiting verification.`

## Quick reference

| Request | Behavior |
|---|---|
| "execute the specs" / "implement the ready specs" | Resolves the project (asking if ambiguous), lists specs, asks which to run |
| "run all specs for template" | Execute every spec in `specs/template/ready/` |
| "execute 0001 and 0003 in template" | Execute only those two specs |
| "resume 0002" | Pick up a spec already sitting in `in_progress/` rather than moving it there again |

## Gotchas

None recorded yet. Add entries here as real failure modes surface in practice — this section
is more valuable filled in from actual mistakes than speculated in advance.
