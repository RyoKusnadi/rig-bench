# Specs

Spec-driven decomposition of a project's long-form rationale doc, when one
exists. The rationale doc stays as the long-form "why this matters"; a spec
here is the short-form executable unit ("what to build, scoped to one PR").
The harness itself currently keeps no such doc — its rationale lives in
merged PRs, git history, and the memory notebooks (`spec-db.mjs memory decisions`).

## Where specs live

Specs live in the SQLite system of record — `spec.db` at the repo root (gitignored,
per-machine), operated exclusively through `scripts/spec-db.mjs`. There is no spec-file
tree: a spec is a row (title, status, body, pointers) plus its dependencies, transition
history, criteria snapshots, and verification attempts in adjacent tables. This directory
keeps only the two shared documents:

```
specs/
├── README.md           # this file — conventions and the canonical state table
└── spec-template.md    # canonical spec shape (body sections + field semantics)
```

Markdown remains the authoring *format* — a spec's body is markdown following
`spec-template.md`'s section list, stored verbatim in the DB and rendered by the
dashboard (`make serve`). The daily commands:

```bash
node scripts/spec-db.mjs add <project> "<title>" ["<axis>"] [body-file]  # create (draft)
node scripts/spec-db.mjs list [project] [status]
node scripts/spec-db.mjs show <project> <id>
node scripts/spec-db.mjs edit <project> <id> <title|axis|branch|pr|body> <value>
node scripts/spec-db.mjs dep add <project> <id> <depends_on_id>
node scripts/spec-db.mjs move <project> <id> <to_state> [actor]
node scripts/spec-db.mjs status | check | metrics | trace                # read-only views
```

Projects exist implicitly: the first `add` for a new project name creates its sequence.
Specs are scoped per project because `projects/` can hold multiple independent projects
over time, each with its own spec lifecycle, ID sequence, and history. `template` is the
project name for work on the harness itself (this repo's own tooling — hooks, workflows,
skills, scripts) — named `template` rather than `rig-bench` because that's what this repo
is: a reusable harness skeleton, not a project in the same sense as something under
`projects/`. There is exactly one shared thing across all of them:
`specs/spec-template.md` — the spec shape doesn't change per project, only its content
does.

## Resolving the target project

Every entry point into the spec workflow (`spec-plan` skill, `spec-exec` skill, `spec-verify` skill)
needs to know which project it's operating on before doing anything else.
This is the one canonical procedure — implementations should point here rather than
re-describing it, so the logic can't drift out of sync across callers the way it did before
(see git history on this file around the per-project restructuring for what that drift cost).

**List candidate projects:**
```bash
node scripts/spec-db.mjs list
```
The distinct project prefixes in the output (`<project>/<id>`) are the candidates.

**Resolution order:**
1. If the caller's arguments/task explicitly name a project matching one of the candidates,
   use it. `template` is a real, valid project like any other — never special-cased or
   excluded from the candidate list.
2. Else if exactly one project exists in the DB, use it without asking.
3. Else if multiple exist and none was named, ask which one before doing anything else —
   never guess.
4. A project that doesn't exist yet needs no setup — `spec-db.mjs add <project> ...` on a
   new name starts its sequence at `0001`. Only do this deliberately (a genuinely new
   project), not as a fallback for a typo'd name.

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
Implementation Notes in a single spec body — see `spec-template.md`.

## Naming

IDs are `0001`-style — sequential per project, zero-padded, never reused —
and are allocated by `spec-db.mjs add` itself; you never pick one by hand.
IDs are stable references for commit messages and PRs; don't renumber on
reorder, use `depends_on` instead. This matches GitHub Spec Kit's numbering
convention. When you start work on a spec, name the feature branch after it
(`0001-expense-tracker-scaffold`, or the dispatch form `spec-0001-<slug>`)
the same way Spec Kit mirrors its feature-number+slug as the branch name —
makes it trivial to find the spec a given branch/PR implements. IDs are
per-project — `template` and each project under `projects/` each have their
own `0001`.

## Lifecycle

`draft` → `ready` → `in_progress` → `waiting_verification` → `finished` (or `blocked` / `abandoned`).

A spec's `status` column is its lifecycle state; `spec-db.mjs move` is the only way it
changes (it enforces the transition table below and the dependency gate at write time):

| State | Meaning |
|---|---|
| `draft` | Being written; may contain `[NEEDS CLARIFICATION]` markers |
| `ready` | All ambiguity resolved; ready to be picked up |
| `in_progress` | Actively being implemented |
| `waiting_verification` | AI built + inspected; awaiting human confirmation before shipping |
| `finished` | Shipped — merged PR is the permanent record |
| `blocked` | Waiting on a dependency or decision |
| `abandoned` | Won't do; kept for reference |

**What "permanent record" means:** the merged PR is the permanent record of the
*implementation*; the DB keeps the spec row, its transition history, and the append-only
ledger as the per-machine record of the *lifecycle*. `finished` specs stay queryable
(`list <project> finished`) as a working-set convenience — what shipped recently, quick to
scan.

**Transition timestamps:** every `move` records a transition row (from-state, to-state,
actor, UTC timestamp) automatically — `show` prints the full history, and
`spec-db.mjs metrics` computes ready→finished cycle time from it. There is no manual
bookkeeping.

**Ambiguity gate:** a spec may contain inline `[NEEDS CLARIFICATION: ...]`
markers while in `draft`. It cannot move to `ready` while any marker remains
unresolved — resolve each one (edit the spec to answer it, or ask the human)
before moving. This mirrors Spec Kit's same marker pattern and
exists because vague, unresolved acceptance criteria is the single
most-cited cause of spec drift in every convention surveyed (Spec Kit, EARS).
`spec-db.mjs check` flags a marker that survives outside `draft`.

## State Transitions

This is the one canonical transition table — `spec-plan`, `spec-exec`, and `spec-verify` all
point here instead of each describing the lifecycle in their own prose, so a future edit to
one skill can't drift out of sync with how the others actually move specs around (the same
reasoning as "Resolving the target project" above, applied to lifecycle state instead of
project selection).

**Enforcement:** `spec-db.mjs move` reads `valid_next` from `workflows/state.yaml` and
refuses illegal transitions at write time — the table below is the same facts in prose.

**Machine-readable mirror:** `workflows/state.yaml` carries the same state/transition
facts plus the `MAX_VERIFY_ATTEMPTS` constant below, as pure data — no orchestration code, a
deliberate design decision (see the decisions notebook). It's what `spec-db.mjs` actually
reads. **Sync enforcement:** `scripts/check-state-sync.sh` (also run by `make check`) verifies
the state set and `MAX_VERIFY_ATTEMPTS` agree between this table and the YAML, exiting 1 on
drift.

| State | Entered by | Valid next states |
|---|---|---|
| `draft` | `spec-plan`, drafting (`spec-db.mjs add`) | `ready` |
| `ready` | `spec-plan` (ambiguity resolved), or a human un-blocking a spec | `in_progress` |
| `in_progress` | `spec-exec` (starting or resuming implementation) | `waiting_verification` |
| `waiting_verification` | `spec-exec` (implementation complete) | `finished`, `blocked` |
| `finished` | `spec-verify` (all criteria + Verification step passed) | — (terminal) |
| `blocked` | `spec-verify` (verification failed `MAX_VERIFY_ATTEMPTS` times), or a human blocking a spec manually | `ready`, `in_progress` (human un-blocks) |
| `abandoned` | a human, manually | — (terminal) |

Nothing transitions a spec directly from `waiting_verification` back to `ready` or
`in_progress` on its own — that only happens via the retry contract below, or a human
un-blocking it.

**Concurrent dispatch:** `MAX_CONCURRENT_DISPATCH = 3` — the cap on simultaneously
dispatched spec-executor agents (mirrored as `dispatch.max_concurrent` in
`workflows/state.yaml`, enforced in sync by `scripts/check-state-sync.sh`). See `spec-exec`'s
"Concurrent dispatch" section for the procedure; serial execution remains the default.

### Retry contract: `spec-verify` failure → `spec-exec` fix

`MAX_VERIFY_ATTEMPTS = 2` (also mirrored in `workflows/state.yaml`'s `retry.max_verify_attempts`
— see the "Machine-readable mirror" note above). Each spec carries a `verify_attempts`
counter (default `0`) that `spec-db.mjs record-attempt` — and only it — increments, on FAIL.

When `spec-verify` finds a spec fails (any Acceptance Criterion, the Verification step, or
the project's standing gates — the *regression gate*: a spec that passes its own
check while breaking `make check`/the test suite fails verification):

1. Record the attempt with its raw trace: `spec-db.mjs record-attempt <project> <id> FAIL
   <trace-file>` — this stores the actual commands and their full output as this attempt's
   permanent record (queryable with `spec-db.mjs trace <project> <id> [n]`, diffable
   between attempts with `trace diff`) and increments `verify_attempts`.
2. Write (replacing any prior run's) a `## Verification Failures` section into the spec
   body (via `spec-db.mjs edit ... body`), listing each failed criterion verbatim plus the
   reason it failed, and the Verification step's output if that's what failed. This is the
   structured handoff — it's what `spec-exec` reads to know what to fix, instead of a human
   having to relay the failure report by hand. The failures section is the compressed
   handoff; the trace is the uncompressed one. `spec-exec` reads both on a fix, because a
   distilled summary drops the raw command output that often pinpoints the cause
   (the empirical basis is the Meta-Harness finding that traces beat summaries as fix signal —
   see the decisions notebook).
3. If `verify_attempts < MAX_VERIFY_ATTEMPTS`: leave the spec in `waiting_verification`,
   status unchanged. Report the failure and that this was attempt `{verify_attempts}` of
   `MAX_VERIFY_ATTEMPTS`.
4. If `verify_attempts >= MAX_VERIFY_ATTEMPTS`: `spec-db.mjs move <project> <id> blocked
   spec-verify` and report the escalation clearly — this is the defined
   escalation path, replacing the old behavior of a failed spec sitting in
   `waiting_verification` indefinitely with no next step.

When a human (or the human, via `spec-exec`) picks a spec back up to fix it — whether it's
still in `waiting_verification` with a `## Verification Failures` section, or was moved to
`blocked` and manually moved back to `ready`/`in_progress` — `spec-exec` treats that section
as the authoritative list of what to fix, not merely a status report to skim. See `spec-exec`'s
own Phase 1 for how it discovers these.

**Un-blocking a spec:** moving a spec out of `blocked` is always a human decision, never
automatic. When you do, reset the attempt budget as part of the same step:
```bash
node scripts/spec-db.mjs move <project> <id> ready human
node scripts/spec-db.mjs set <project> <id> verify_attempts 0
```
— a fresh attempt budget for a spec a human has just reviewed and chosen to retry,
rather than it re-blocking after a single additional failure.

**Clearing the record on success:** once a spec passes verification, `spec-verify` removes
the `## Verification Failures` section from the body before moving it to `finished` — a
shipped spec shouldn't lead with stale failure history. The raw record is not lost: attempt
rows and their traces are never deleted, so `trace <project> <id> <n>` reaches every past
attempt.

**Specs and git:** spec content is never committed (a repo invariant, recorded in
CLAUDE.md's Non-negotiables) — it lives only in the gitignored `spec.db`, so the
plan→execute→verify lifecycle runs entirely from the local DB. Commits and PRs carry
implementation changes only; the ledger below is each machine's durable record of
outcomes.

**Outcome ledger:** a move to `finished` or `blocked` auto-appends one row to the DB
ledger (`spec-db.mjs move` does it; read with `spec-db.mjs ledger [project] [outcome]`) —
unlike the per-spec failures section, this record is never cleared; it's the
durable history of what shipped or got stuck, consulted by spec-plan before drafting into
a previously-blocked area. (The earlier JSONL ledger is retired; the legacy `import`
command still ingests a `memory/spec-ledger.jsonl` if present.)

## Template

The canonical spec shape — the body's section list and the field semantics — lives in
[`spec-template.md`](./spec-template.md). `spec-db.mjs add` seeds a new spec's body with
exactly those sections; that file is the single source of truth for what a spec contains
(and `spec-db.mjs check` derives its required-section list from it), so update it (not
this README) if the shape changes.

**The `source` field points into the project's long-form rationale doc, when one exists.**
This harness (project `template`) currently has no such doc, so its specs leave `source`
blank. A project under `projects/<name>/` is its own standalone git repo; if it has an
equivalent long-form rationale doc, `source` should point there
(`projects/<name>/todo.md#anchor`, or whatever that project actually uses) — and if the
project has no such doc yet, leave it blank rather than pointing it at something that
doesn't apply.

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
earlier one in `depends_on` (`spec-db.mjs dep add`). This forces serial execution — the
second spec lands on top of the first instead of diverging from the same base.

**The scan is automated:** `node scripts/spec-db.mjs check <project>` reports a
`[file-conflict]` ISSUE for any file shared between two `ready`/`in_progress` specs that
have no `depends_on` path between them (either direction, directly or transitively). It runs
via `make check`, CI, and the post-spec-edit hook — so drift is caught at write time, not
merge time.

A spec that cannot yet name its files in `## Files/Interfaces Touched` is
not ready — keep it `draft` and add a `[NEEDS CLARIFICATION]` marker.

## Scripted consistency check

`node scripts/spec-db.mjs check [project]` is the consistency gate over the DB (all
projects when none is named). Beyond the file-conflict scan above it catches, per project:

- **Dangling `depends_on`** — a referenced ID that doesn't resolve to any spec in the project.
- **Dependency cycles**, and finished specs whose dependencies aren't finished.
- **Sizing drift** — a spec whose `Files/Interfaces Touched` list has grown past the "one
  deliverable" `Rule` above (default threshold: 5 files; override with `SIZING_THRESHOLD`).
- **Quality lint** — unresolved `[NEEDS CLARIFICATION:` markers outside `draft`, a
  `## Verification Failures` section with `verify_attempts` still 0, and missing
  template sections.
- **PR traceability** — a `finished` spec with an empty `pr` field.
- **Memory writeback** — a `blocked` spec with no lessons-notebook entry tagged
  `(spec NNNN)` (hard ISSUE), or failed attempts with no entry yet (advisory WARN).

```bash
node scripts/spec-db.mjs check template   # or no argument for every project
```

It reports issues and exits non-zero; `make check` runs it (with
`scripts/check-state-sync.sh`) locally and in CI on every PR. Run it before moving a batch
of specs to `ready`.

## Workflow

A spec's body is the `task` argument to a workflow — copy/summarize it
directly into `Agent`/`Workflow` invocations (`spec-db.mjs show <project> <id>` prints
it). This convention is an authoring layer in front of the existing `task` string
parameter; no orchestration tooling is required.

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
