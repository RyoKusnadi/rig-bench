# Specs

Spec-driven decomposition of a project's long-form rationale doc, when one
exists. The rationale doc stays as the long-form "why this matters"; a spec
here is the short-form executable unit ("what to build, scoped to one PR").
The harness itself currently keeps no such doc — its rationale lives in
merged PRs, git history, and `memory/`.

## Structure

```
specs/
├── spec-template.md    # canonical template — copy this to start a new spec
└── <project_name>/      # one folder per project — template/ is this harness's
    ├── draft/            # own specs; other names come from projects/<name>/
    ├── ready/
    ├── in_progress/
    ├── waiting_verification/
    ├── finished/
    ├── blocked/
    └── abandoned/
```

Specs are scoped per project because `projects/` can hold multiple
independent projects over time, each with its own spec lifecycle, ID
sequence, and history. `specs/template/` covers work on the harness itself
(this repo's own tooling — hooks, workflows, skills, scripts) — named
`template` rather than `rig-bench` because that's what this repo is: a
reusable harness skeleton, not a project in the same sense as something
under `projects/`. Any project created under `projects/<name>/` gets a
matching `specs/<name>/` the first time it needs a spec. There is exactly
one shared thing across all of them: `specs/spec-template.md` — the spec
shape doesn't change per project, only its content does.

**Starting a new project's specs folder:** copy the lifecycle folder
skeleton, don't invent a new one:
```bash
mkdir -p specs/<project_name>/{draft,ready,in_progress,waiting_verification,finished,blocked,abandoned}
touch specs/<project_name>/{draft,ready,in_progress,waiting_verification,finished,blocked,abandoned}/.gitkeep
```

## Resolving the target project

Every entry point into the spec workflow (`spec-plan` skill, `spec-exec` skill, `spec-verify` skill)
needs to know which project it's operating on before doing anything else.
This is the one canonical procedure — implementations should point here rather than
re-describing it, so the logic can't drift out of sync across callers the way it did before
(see git history on this file around the per-project restructuring for what that drift cost).

**List candidate projects — directories only:**
```bash
find specs -mindepth 1 -maxdepth 1 -type d -exec basename {} \;
```
Plain `ls specs/` is wrong here — it also returns `spec-template.md`, which isn't a project.

**Resolution order:**
1. If the caller's arguments/task explicitly name a project matching one of the candidates,
   use it. `template` is a real, valid project like any other — never special-cased or
   excluded from the candidate list.
2. Else if exactly one project folder exists, use it without asking.
3. Else if multiple exist and none was named, ask which one before doing anything else —
   never guess.
4. If the target project's `specs/<project_name>/` doesn't exist yet, create the full
   lifecycle skeleton (above) before drafting into it.

## Rule

One spec = one deliverable, sized to fit a single `new-feature.js`/`bug-fix.js`/
`refactor.js` workflow run (one hook, one script, one schema change — not a
whole rationale-doc phase). If a spec's Implementation Notes start spanning
multiple unrelated files, split it.

This is a deliberate divergence from GitHub Spec Kit and Kiro, which split
each feature into separate `spec.md` (requirements)/`plan.md`
(design)/`tasks.md` files. That split earns its weight for large,
multi-week features; for rig-bench's one-deliverable sizing rule it would
mostly be ceremony, so Problem/Acceptance Criteria stay merged with
Implementation Notes in a single file — see `spec-template.md`.

## Naming

`{0001}-{kebab-slug}.md` — sequential per project, zero-padded, never
reused. IDs are stable references for commit messages and PRs; don't
renumber on reorder, use `depends_on` instead. This matches GitHub Spec
Kit's own numbering convention. When you start work on a spec, name the
feature branch after it (`0001-expense-tracker-scaffold`) the same way
Spec Kit mirrors its feature-number+slug as the branch name — makes it
trivial to find the spec a given branch/PR implements.

**Finding the next ID for a project:** spec files are gitignored in some
setups, so never look in git history — check what exists on disk instead,
scoped to the project you're drafting for:

```bash
find specs/<project_name> -name "[0-9]*.md" | sort | tail -1
```

If nothing is found, start at `0001`. IDs are per-project — `template` and
each project under `projects/` each have their own `0001`.

## Lifecycle

`draft` → `ready` → `in_progress` → `waiting_verification` → `finished` (or `blocked` / `abandoned`).

Each status has a matching folder inside the project's spec directory —
move the spec file into the folder that matches its current status:

| Folder | Meaning |
|---|---|
| `specs/<project>/draft/` | Being written; may contain `[NEEDS CLARIFICATION]` markers |
| `specs/<project>/ready/` | All ambiguity resolved; ready to be picked up |
| `specs/<project>/in_progress/` | Actively being implemented |
| `specs/<project>/waiting_verification/` | AI built + inspected; awaiting human confirmation before shipping |
| `specs/<project>/finished/` | Shipped — merged PR is the permanent record |
| `specs/<project>/blocked/` | Waiting on a dependency or decision |
| `specs/<project>/abandoned/` | Won't do; kept for reference |

**What "permanent record" means:** the merged PR (and git history via `git log --follow` on
the spec file) is the actual permanent record — not the file's continued presence in
`finished/`. `specs/template/finished/` intentionally started empty when this per-project
structure was introduced (the 4 pre-existing finished specs were removed from the working
tree, not from history — `git log -- specs/rig-bench/finished/` still finds them under the
old path). Treat `finished/` as a working-set convenience (what shipped recently, quick to
scan) rather than an archive. There is currently no separate long-term archive mechanism —
git history is it, for now.

**Ambiguity gate:** a spec may contain inline `[NEEDS CLARIFICATION: ...]`
markers while in `draft`. It cannot move to `ready` while any marker remains
unresolved — resolve each one (edit the spec to answer it, or ask the human)
before flipping status. This mirrors Spec Kit's same marker pattern and
exists because vague, unresolved acceptance criteria is the single
most-cited cause of spec drift in every convention surveyed (Spec Kit, EARS).

## State Transitions

This is the one canonical transition table — `spec-plan`, `spec-exec`, and `spec-verify` all
point here instead of each describing the lifecycle in their own prose, so a future edit to
one skill can't drift out of sync with how the others actually move specs around (the same
reasoning as "Resolving the target project" above, applied to lifecycle state instead of
project selection).

**Invariant:** a spec's frontmatter `status` field always matches the folder it physically
sits in. `scripts/check-specs.sh` checks this automatically — a mismatch (e.g. `status: ready`
sitting in `in_progress/`) is a bug, not a valid intermediate state, however it happened.

**Machine-readable mirror:** `workflows/state.yaml` carries the same state/folder/transition
facts plus the `MAX_VERIFY_ATTEMPTS` constant below, as pure data — no orchestration code, a
deliberate design decision (see `memory/decisions.md`). It's for future tooling to read instead of parsing this
table. **Sync enforcement:** `scripts/check-state-sync.sh` (also run by `make check`) verifies
the state set and `MAX_VERIFY_ATTEMPTS` agree between this table and the YAML, exiting 1 on
drift. `scripts/check-specs.sh` derives its valid-state list from the YAML directly, so there
is no third hand-maintained copy.

**Transition enforcement (spec 0014):** `valid_next` is enforced, not just documented —
`scripts/check-specs.sh` diffs each spec's lifecycle folder against a base ref
(`origin/main` by default, `TRANSITION_BASE_REF` to override) and reports an
`[illegal-transition]` ISSUE when no `valid_next` path leads from the old folder to the new
one. Path reachability, not single-hop membership, because one PR legitimately collapses
multi-hop moves (`ready → in_progress → waiting_verification`) into one endpoint pair. No
resolvable base ref (non-git fixtures, shallow clones) skips the check silently.

| State | Folder | Entered by | Valid next states |
|---|---|---|---|
| `draft` | `draft/` | `spec-plan`, drafting | `ready` |
| `ready` | `ready/` | `spec-plan` (ambiguity resolved), or a human un-blocking a spec | `in_progress` |
| `in_progress` | `in_progress/` | `spec-exec` (starting or resuming implementation) | `waiting_verification` |
| `waiting_verification` | `waiting_verification/` | `spec-exec` (implementation complete) | `finished`, `blocked` |
| `finished` | `finished/` | `spec-verify` (all criteria + Verification step passed) | — (terminal) |
| `blocked` | `blocked/` | `spec-verify` (verification failed `MAX_VERIFY_ATTEMPTS` times), or a human blocking a spec manually | `ready`, `in_progress` (human un-blocks) |
| `abandoned` | `abandoned/` | a human, manually | — (terminal) |

Nothing transitions a spec directly from `waiting_verification` back to `ready` or
`in_progress` on its own — that only happens via the retry contract below, or a human
un-blocking it.

**Concurrent dispatch:** `MAX_CONCURRENT_DISPATCH = 3` — the cap on simultaneously
dispatched spec-executor agents (mirrored as `dispatch.max_concurrent` in
`workflows/state.yaml`, enforced in sync by `scripts/check-state-sync.sh`). See `spec-exec`'s
"Concurrent dispatch" section for the procedure; serial execution remains the default.

### Retry contract: `spec-verify` failure → `spec-exec` fix

`MAX_VERIFY_ATTEMPTS = 2` (also mirrored in `workflows/state.yaml`'s `retry.max_verify_attempts`
— see the "Machine-readable mirror" note above). Each spec's frontmatter carries a `verify_attempts` field
(default `0`, see `spec-template.md`) that `spec-verify` — and only `spec-verify` — increments.

When `spec-verify` finds a spec fails (any Acceptance Criterion or the Verification step):

1. Increment `verify_attempts` by 1.
2. Write (replacing any prior run's) a `## Verification Failures` section into the spec file,
   listing each failed criterion verbatim plus the reason it failed, and the Verification
   step's output if that's what failed. This is the structured handoff — it's what `spec-exec`
   reads to know what to fix, instead of a human having to relay the failure report by hand.
3. If `verify_attempts < MAX_VERIFY_ATTEMPTS`: leave the file in `waiting_verification/`,
   status unchanged. Report the failure and that this was attempt `{verify_attempts}` of
   `MAX_VERIFY_ATTEMPTS`.
4. If `verify_attempts >= MAX_VERIFY_ATTEMPTS`: move the file to `blocked/`, set
   `status: blocked`, commit, and report the escalation clearly — this is the defined
   escalation path, replacing the old behavior of a failed spec sitting in
   `waiting_verification/` indefinitely with no next step.

When a human (or the human, via `spec-exec`) picks a spec back up to fix it — whether it's
still in `waiting_verification/` with a `## Verification Failures` section, or was moved to
`blocked/` and manually moved back to `ready/`/`in_progress/` — `spec-exec` treats that section
as the authoritative list of what to fix, not merely a status report to skim. See `spec-exec`'s
own Phase 1 for how it discovers these.

**Un-blocking a spec:** moving a file out of `blocked/` is always a human decision, never
automatic. When you do, reset `verify_attempts` to `0` in the frontmatter as part of that
move — a fresh attempt budget for a spec a human has just reviewed and chosen to retry,
rather than it re-blocking after a single additional failure.

**Clearing the record on success:** once a spec passes verification, `spec-verify` removes
the `## Verification Failures` section before moving the file to `finished/` — a shipped
spec's file shouldn't carry stale failure history; the git history of the file is where that
record actually lives (`git log --follow` on the spec path).

## Template

The canonical spec shape — frontmatter and section list — lives in
[`spec-template.md`](./spec-template.md). Copy it to draft
a new spec rather than retyping the structure from memory; that file is the
single source of truth for what a spec contains, so update it (not this
README) if the shape changes.

**The `source:` frontmatter field points into the project's long-form rationale doc, when
one exists.** This harness (`specs/template/`) currently has no such doc, so its specs
leave `source` blank (`""`), as the template shows. A project under `projects/<name>/` is
its own standalone git repo; if it has an equivalent long-form rationale doc, `source`
should point there (`projects/<name>/todo.md#anchor`, or whatever that project actually
uses) — and if the project has no such doc yet, leave `source` blank rather than pointing
it at something that doesn't apply.

### Acceptance Criteria format

Write each criterion as one EARS-style sentence instead of free prose —
this is the cheapest lever for making criteria testable/unambiguous rather
than aspirational:

- Ubiquitous: `The <component> shall <behavior>.`
- Event-driven: `When <trigger>, the <component> shall <behavior>.`
- Unwanted behavior: `If <condition>, then the <component> shall <behavior>.`

One criterion = one sentence = one checkable thing. If a criterion needs
"and" to join two unrelated behaviors, split it into two criteria.

## File-conflict gate

Before a batch of specs can move to `ready`, run a conflict scan across
all `## Files/Interfaces Touched` sections within that project. Any file
that appears in two or more specs in the batch will produce a merge
conflict if those specs are executed concurrently (each runs in its own
worktree from the same base commit).

**Rule**: if two specs touch the same file, the later one must list the
earlier one in `depends_on`. This forces serial execution — the second spec
lands on top of the first instead of diverging from the same base.

**The scan is automated (spec 0013):** `scripts/check-specs.sh <project>` reports a
`[file-conflict]` ISSUE for any file shared between two `ready/`/`in_progress/` specs that
have no `depends_on` path between them (either direction, directly or transitively). It runs
via `make check`, CI, and the post-spec-edit hook — so drift is caught at write time, not
merge time. The manual form, kept for background:

```bash
# Print every file listed across all ready specs for a project, flag duplicates
grep -h "^- " specs/<project_name>/ready/*.md | sort | uniq -d
```

Or manually: for each file in `## Files/Interfaces Touched`, check if any
other spec in the batch lists the same file. If yes, add `depends_on`.

**Common shared files to watch for** in `specs/template/` (the harness
itself): there are currently no standing examples (the operator/memory system that used to
anchor this list was removed), so treat this as a reminder to actually run
the scan above rather than pattern-match against a fixed list.

A spec that cannot yet name its files in `## Files/Interfaces Touched` is
not ready — mark it `draft` and add a `[NEEDS CLARIFICATION]` marker.

## Scripted consistency check

The manual scan above catches file-overlap conflicts; `scripts/check-specs.sh <project>`
extends the same grep-based approach to catch three more things automatically, all of them
bugs found by hand while reviewing an earlier PR — a reminder that these are worth checking
by script rather than by eye:

- **Duplicate spec IDs** within a project.
- **Dangling `depends_on`** — a referenced ID that doesn't resolve to any spec in the project.
- **Sizing drift** — a spec whose `Files/Interfaces Touched` list has grown past the "one
  deliverable" `Rule` above (default threshold: 5 files; override with `SIZING_THRESHOLD`).

```bash
scripts/check-specs.sh template   # or scripts/check-specs.sh, if only one project exists
```

Advisory, like the manual scan — it reports issues and exits non-zero, but nothing currently
blocks on it automatically. Run it before moving a batch of specs to `ready`, the same point
the manual file-conflict scan above is meant to run.

## Workflow

A spec's body is the `task` argument to a workflow — copy/summarize it
directly into `Agent`/`Workflow` invocations. No tooling change to
`workflows/*.js` is required; this folder is an authoring layer in front of
the existing `task` string parameter.

For a non-trivial spec, prefer authoring it through an interview pass (the
`spec-plan` skill already does this via `AskUserQuestion`
before drafting) rather than writing the full spec in one shot — per
Anthropic's guidance, having the agent ask clarifying questions before the
spec is written catches ambiguity earlier and cheaper than catching it
during implementation.

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
  above); per-feature spec scoping (adopted, extended here to per-project).
- [MADR](https://github.com/adr/madr) — decision-record frontmatter/structure
  (general structural analogy only; not adopted wholesale).
