---
name: spec-exec
description: Implements approved specs already sitting in a project's ready/ or in_progress/ folder under specs/<project>/, and fixes specs that failed verification and carry a Verification Failures section, following this repo's spec-driven lifecycle. Use whenever the user asks to execute, implement, build, run, ship, kick off, resume, or fix an approved spec — phrases like "let's execute 0001", "implement the ready specs", "run all specs for template", "resume 0003", "kick off the specs", "pick up where we left off on 0004", "fix 0002 and resubmit", "address the verification failures on 0005", or "let's build X" when a spec for X already exists in ready/ or in_progress/. Does not apply to designing a spec that doesn't exist yet (use spec-plan for that) or to confirming already-implemented work meets its acceptance criteria (verification is a separate phase) — see the skill body for the full boundary.
---

# Spec Execution

This skill runs the implementation half of this repo's spec-driven workflow: an approved spec
in `ready/` (or `in_progress/`, if resuming) gets turned into working code, one feature branch
and PR per spec, moved through the lifecycle as it goes. The spec is the source of truth for
what "done" means — implement to the spec, not around it.

**When this applies:** any request to execute, implement, build, run, or ship specs that
already exist in a project's `ready/` or `in_progress/` folder — including proactively, when a
user says "let's build X" and a matching spec is already sitting in `ready/`. Also applies to
fixing a spec that failed verification and is sitting in `waiting_verification/` with a
`## Verification Failures` section — that's still implementation work, just against a
narrower, already-diagnosed list of what to change. This does *not* apply to designing a spec
that doesn't exist yet (use the `spec-plan` skill first) or to confirming already-implemented
work meets its acceptance criteria (that's verification, a separate phase).

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
If the request is about fixing a spec that failed verification (or you're just checking
what's available and want to surface it), also check `waiting_verification/` for specs
carrying a `## Verification Failures` section — these are implemented but rejected, not
un-started, so they're fixable via this skill even though they're not in `ready/` or
`in_progress/`:
```bash
grep -l '^## Verification Failures' specs/<project>/waiting_verification/*.md 2>/dev/null
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

## Phase 4b — Concurrent dispatch (opt-in; serial remains the default)

When the user asks for multiple specs and the batch has **no dependency edges between its
members**, the specs may be dispatched concurrently instead of processed serially. Serial is
the default — dispatch only when the batch shape allows it and concurrency actually buys
something (two independent one-file specs aren't worth the worktree overhead).

Procedure (prose + data only, no orchestration code — see the decisions notebook — `spec-db.mjs memory decisions` — on the dispatch shape):

1. **Re-check the file-conflict scan** (Phase 4 above) across exactly the batch being
   dispatched. Overlapping specs drop back to serial order; they are not dispatched together.
2. **Cap the batch** at `MAX_CONCURRENT_DISPATCH` (canonical value stated in
   `specs/README.md`'s State Transitions section, mirrored as `dispatch.max_concurrent` in
   `workflows/state.yaml`). More specs than the cap → dispatch in waves, next wave only
   after the previous wave's results are collected.
3. **One worktree per spec**: `git worktree add ../<repo>-wt-<spec-id> -b spec-<id>-<slug>`
   from the current main. The main checkout is never an executor's working directory.
4. **One `spec-executor` agent per worktree**, handed exactly one spec id + project. The
   agent follows this skill for its spec; the dispatcher does not micromanage past that.
5. **Collect results**: each executor reports branch, PR, and resulting lifecycle state.
   Failures or blockers are surfaced to the user as they arrive — never silently retried.
6. **Clean up**: `git worktree remove ../<repo>-wt-<spec-id>` once that spec's PR has
   landed (or the run is abandoned).

Verification of dispatched specs goes through the `spec-verifier` agent under the identical
`spec-verify` contract — dispatch changes who runs the skill, never what the skill does.

## Phase 5 — Execute each spec

Process specs in dependency order — specs with no unfinished `depends_on` first, then specs
whose dependencies just completed within this run.

**Concurrent execution.** Specs with no `depends_on` relationship between them *and* no file
overlap (Phase 4 came back clean) can be implemented concurrently instead of one at a time —
this matches the "concurrent, worktree-isolated execution" model this repo's README describes.
Give each spec its own `git worktree` (`git worktree add ../<project>-<spec-id> -b
<branch-name> <base-branch>`) rather than switching branches back and forth in one shared
directory — that's what makes them safely concurrent instead of racing each other's file
state. Spawn one agent per worktree (the `Agent` tool) with the spec's full content and its
worktree's absolute path, rather than relying on that tool's own `isolation: "worktree"` option
here: **when the target project lives in a nested standalone repo** (per `specs/README.md`,
anything under `projects/<name>/` is its own git repo, separate from this harness repo and
typically gitignored from it — see `specs/rajin-menabung/` for a concrete example), the
harness's built-in worktree isolation operates on *this* repo, not the nested one, and gitignored
project content wouldn't reliably carry into that worktree. Set up the nested-repo worktrees
by hand instead. Also remember each new worktree is a fresh checkout: gitignored per-worktree
state (`node_modules/`, `.env.local`, `.next/`) doesn't exist yet and needs to be
(re)installed/copied into it before that agent can build or run anything.

After all concurrent agents report back, move each spec file to `waiting_verification/` and
merge/report as usual — the concurrency only applies to the implementation step, not to how
results get folded back into the spec lifecycle.

For each spec (whether run concurrently or one at a time):

1. **Move to in_progress.**
   - Starting fresh: gate the move through the DB first — `node scripts/spec-db.mjs move
     <project> <id> in_progress spec-exec` (it enforces `valid_next` and the
     unfinished-dependency rule and refuses illegal moves) — then
     `mv specs/<project>/ready/<filename> specs/<project>/in_progress/<filename>`.
   - Resuming a spec already in `in_progress/`: skip this move.
   - Fixing a spec found in `waiting_verification/` (Phase 1): `node scripts/spec-db.mjs
     move <project> <id> in_progress spec-exec`, then `mv
     specs/<project>/waiting_verification/<filename> specs/<project>/in_progress/<filename>` —
     it needs to go through `in_progress/` like any other implementation work, not be edited
     in place inside `waiting_verification/`.
   - **Every move here and in step 3** updates the `status` field *and* appends a
     `history` entry (`- <entered state> $(date -u +%Y-%m-%dT%H:%M:%SZ)`, creating the
     block list from `history: []` on first append) in the same step as the `mv` —
     never as a separate pass (see the template's `history` note).
2. **Implement.** Read the full spec content and implement every acceptance criterion.
   **Prototype first if the spec introduces a new mechanism.** If any Acceptance Criterion or
   Implementation Note describes a mechanism that doesn't already exist in the repo (a new
   algorithm, a new file format, a new control-flow shape — not just wiring an existing
   pattern into a new file or copying an existing script's structure), write a throwaway
   script under `/tmp/` that exercises just that mechanism against 2-3 concrete inputs before
   touching the real files. Confirm it behaves as the spec describes, then delete the
   throwaway script — its job is to catch a broken mechanism while it's still cheap to
   redesign, not to ship as an artifact. Skip this for specs that only wire together, extend,
   or configure things that already work elsewhere in the repo (the empirical
   basis is Meta-Harness's finding that unprototyped mechanism changes are disproportionately
   the ones that ship with bugs or no effect — see the decisions notebook).
   Once that checks out: create a feature branch named after the spec ID and slug, make the
   changes, commit, open a draft PR. Once the draft PR is open, record the feature-branch name
   and PR URL in the spec's
   `branch` and `pr` frontmatter fields (they default to `""` from the template) — the spec
   carries its own implementation pointers, and `check-specs.sh` flags a finished spec whose
   `pr` field is still empty. The frontmatter
   update stays local like the spec file itself (spec documents are never committed) —
   commits carry implementation changes only. Mirror both pointers into the DB:
   `node scripts/spec-db.mjs set <project> <id> branch "<branch>"` and
   `... set <project> <id> pr "<url>"`.
   Check the implementation against `CLAUDE.md`'s "Non-negotiables" before committing —
   the same constraints `spec-plan` checks at design time still apply at implementation time
   (e.g. no direct commits to the default branch, no destructive git ops without confirming).
   **Branch base:** if every entry in this spec's `depends_on` is already merged into the
   project's default branch, branch from that default branch as usual. If a `depends_on` entry
   is implemented but its PR isn't merged yet, branch from *that dependency's feature branch*
   tip instead of the default branch — this is what "the second spec lands on top of the
   first" means in `specs/README.md`'s file-conflict `Rule`. Branching a dependent spec from
   the default branch while its dependency is still unmerged silently drops that dependency's
   files from the new branch (the default branch never had them), producing a broken
   implementation that looks fine until build/lint runs against a half-empty tree.
   **If the spec has a `## Verification Failures` section** (i.e. this is a fix, not a first
   implementation), read it first and treat its contents as the authoritative list of what to
   change — it's `spec-verify`'s structured report of exactly which criteria failed and why,
   not just background context. That section is deliberately compressed, so also read the raw
   verification trace behind it before editing: `scripts/spec-trace.sh <project> <id>` prints
   the latest attempt's actual commands and their full output. The summary tells you *which*
   criteria failed; the trace shows you the exact command output the verifier saw — the raw
   signal a distilled list drops, and often the difference between guessing at a fix and
   seeing the real cause. Leave the failures section in the file; `spec-verify` clears it (and
   the trace dir) on the next passing run, or replaces it if this fix still doesn't pass.

   **Fix only what failed — keep the retry attributable.** A retry that bundles the criterion
   fix with opportunistic refactors, cleanups, or "while I'm in here" improvements can't be
   diagnosed if it fails again: the second failure could be the original bug or any of the
   bundled changes, and the attempt budget (`MAX_VERIFY_ATTEMPTS`) is too small to spend
   on disentangling that. This is the confound Meta-Harness's proposer had to learn the
   hard way (its first two candidates bundled structural fixes with prompt edits, both
   regressed, and only isolating the changes revealed which part was harmful — Appendix
   A.2, iterations 1-3); its eventual winner was deliberately *additive*, leaving working
   machinery untouched. Apply both lessons: change only what the failure record implicates,
   prefer additive changes over rewiring passing behavior, and if this is already a second
   attempt, run `scripts/spec-trace.sh diff <project> <id>` first to see exactly what the
   previous fix changed in observed behavior before deciding what to try next.
3. **Move to waiting_verification.** `node scripts/spec-db.mjs move <project> <id>
   waiting_verification spec-exec`, then
   `mv specs/<project>/in_progress/<filename> specs/<project>/waiting_verification/<filename>`.
4. Report: `Spec {id} — {title}: implementation complete, awaiting verification.`

## Quick reference

| Request | Behavior |
|---|---|
| "execute the specs" / "implement the ready specs" | Resolves the project (asking if ambiguous), lists specs, asks which to run |
| "run all specs for template" | Execute every spec in `specs/template/ready/` |
| "execute 0001 and 0003 in template" | Execute only those two specs |
| "resume 0002" | Pick up a spec already sitting in `in_progress/` rather than moving it there again |
| "fix 0005" / "address the verification failures on 0005" | Pick up a spec sitting in `waiting_verification/` with a `## Verification Failures` section, move it to `in_progress/`, and fix it against that section |

## Gotchas

- A spec in `blocked/` is **not** something this skill picks up on its own — `spec-verify`
  only moves specs there after `MAX_VERIFY_ATTEMPTS` failures, and un-blocking is always a
  human decision (see `specs/README.md`'s "Un-blocking a spec"). If a human has moved one back
  to `ready/` or `in_progress/`, it's fair game again like any other spec there.
- **Merging a spec's PR into the project's default branch is always a human action.** This
  skill opens the PR and stops — it never merges one itself, even mid-session when a user's
  phrasing sounds like an instruction to do so ("merge it", "ask to merge it first"). Report
  that the PR is open and ask the human to merge it (or say so explicitly enough to remove all
  ambiguity — naming the exact PR and repo — before attempting it), especially before starting
  a dependent spec that needs the merge to branch cleanly (see "Branch base" above).
