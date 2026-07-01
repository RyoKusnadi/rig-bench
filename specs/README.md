# Specs

Spec-driven decomposition of `todo.md`. `todo.md` stays as the long-form
rationale ("why this matters"); a spec here is the short-form executable
unit ("what to build, scoped to one PR").

## Structure

```
specs/
├── template/
│   └── spec-template.md   # canonical template — copy this to start a new spec
└── <project_name>/        # one folder per project, matching a project's
    ├── draft/              # name under projects/ (rig-bench itself included)
    ├── ready/
    ├── in_progress/
    ├── waiting_verification/
    ├── finished/
    ├── blocked/
    └── abandoned/
```

Specs are scoped per project because `projects/` can hold multiple
independent projects over time, each with its own spec lifecycle, ID
sequence, and history. `specs/rig-bench/` covers work on the harness itself
(this repo's own tooling — hooks, workflows, skills, scripts); any project
created under `projects/<name>/` gets a matching `specs/<name>/` the first
time it needs a spec. There is exactly one shared thing across projects:
`specs/template/spec-template.md` — the spec shape doesn't change per
project, only its content does.

**Starting a new project's specs folder:** copy the lifecycle folder
skeleton, don't invent a new one:
```bash
mkdir -p specs/<project_name>/{draft,ready,in_progress,waiting_verification,finished,blocked,abandoned}
touch specs/<project_name>/{draft,ready,in_progress,waiting_verification,finished,blocked,abandoned}/.gitkeep
```

## Rule

One spec = one deliverable, sized to fit a single `new-feature.js`/`bug-fix.js`/
`refactor.js` workflow run (one hook, one script, one schema change — not a
whole `todo.md` section). If a spec's Implementation Notes start spanning
multiple unrelated files, split it.

This is a deliberate divergence from GitHub Spec Kit and Kiro, which split
each feature into separate `spec.md` (requirements)/`plan.md`
(design)/`tasks.md` files. That split earns its weight for large,
multi-week features; for rig-bench's one-deliverable sizing rule it would
mostly be ceremony, so Problem/Acceptance Criteria stay merged with
Implementation Notes in a single file — see `template/spec-template.md`.

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

If nothing is found, start at `0001`. IDs are per-project — `rig-bench` and
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

**Ambiguity gate:** a spec may contain inline `[NEEDS CLARIFICATION: ...]`
markers while in `draft`. It cannot move to `ready` while any marker remains
unresolved — resolve each one (edit the spec to answer it, or ask the human)
before flipping status. This mirrors Spec Kit's same marker pattern and
exists because vague, unresolved acceptance criteria is the single
most-cited cause of spec drift in every convention surveyed (Spec Kit, EARS).

## Template

The canonical spec shape — frontmatter and section list — lives in
[`template/spec-template.md`](./template/spec-template.md). Copy it to draft
a new spec rather than retyping the structure from memory; that file is the
single source of truth for what a spec contains, so update it (not this
README) if the shape changes.

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

How to scan (run from repo root after drafting all specs, scoped to one
project):

```bash
# Print every file listed across all ready specs for a project, flag duplicates
grep -h "^- " specs/<project_name>/ready/*.md | sort | uniq -d
```

Or manually: for each file in `## Files/Interfaces Touched`, check if any
other spec in the batch lists the same file. If yes, add `depends_on`.

**Common shared files to watch for** in `specs/rig-bench/` (the harness
itself):
- `.claude/agents/operator.md` — touched by any spec that adds operator
  instructions or memory tools
- `workflows/operator.js` — touched by any spec that changes workflow
  behaviour (preflight hooks, checkpoint logic, drift handling, etc.)
- `memory/*.md` or `memory/*.json` — touched by any spec that writes to
  the memory vault at bootstrap time

A spec that cannot yet name its files in `## Files/Interfaces Touched` is
not ready — mark it `draft` and add a `[NEEDS CLARIFICATION]` marker.

## Workflow

A spec's body is the `task` argument to a workflow — copy/summarize it
directly into `Agent`/`Workflow` invocations. No tooling change to
`workflows/*.js` is required; this folder is an authoring layer in front of
the existing `task` string parameter.

For a non-trivial spec, prefer authoring it through an interview pass (the
`spec-plan` skill, or `/plan` command, already do this via `AskUserQuestion`
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
