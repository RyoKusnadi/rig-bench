# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this repo is

A spec-driven harness for Claude Code. The original subsystems (hooks, workflows, agents, memory, telemetry, research) were stripped to a skeleton and are being rebuilt spec-by-spec through the lifecycle in `spec.db` (the SQLite system of record, operated via `scripts/spec-db.mjs` — there is no spec-file tree) — the rebuilt pieces so far are the three spec skills, the safety and drift hooks, the consistency checks, DB-backed memory, and the thin dispatch agents. There is deliberately no standing plan doc in the tree: the rebuild's rationale and phase history live in the merged PRs, git history, and the memory notebooks (`spec-db.mjs memory decisions`).

## Non-negotiables

A short list of hard rules every spec must respect, regardless of project. This is
deliberately small — a few genuinely non-negotiable constraints, not a style guide. The
`spec-plan` skill's considerations scan checks new specs against this list; keep it updated
here rather than duplicating it into the skill, so there's one place to change it.

- **No destructive git operations without explicit confirmation.** No force-push, no
  `git reset --hard` on a shared branch, no deleting a branch with unmerged work, without the
  human confirming first.
- **Auth-, secrets-, or credential-touching specs need an explicit security note** in
  `Implementation Notes` — what's being trusted, what the failure mode looks like if it's
  wrong. Silence on this for such a spec is a gap, not an indication there's nothing to say.
- **Spec content is never committed.** Specs live only in `spec.db` (gitignored,
  per-machine) — never export spec bodies into tracked files or `git add -f` the DB.
  Commits and PRs carry implementation changes only; the outcome ledger and the DB
  memory notebooks are the durable record.
- **Never commit directly to a project's default branch.** Every change goes through a
  feature branch and a PR, even for one-line fixes — this repo's whole model depends on PRs
  being the reviewable unit.
- **Shared tooling stays general-purpose.** A change to `.claude/skills/`, `hooks/`, or
  `scripts/` must not special-case a specific spec id, project name, or one-off scenario —
  those files run for every future spec, not just the one motivating the edit. The test: would
  this rule or code path help with a spec nobody has written yet? A reference like "see spec
  0021" for provenance is fine; a conditional like "if spec id is 0021, skip this check" is
  not. This does not apply to the spec files themselves, which are expected to be
  specific.

## Memory

The repo's durable memory lives in the DB (`memory_entries` in `spec.db`) as three
notebooks — decisions, gotchas, lessons — with conventions in `memory/README.md`. Read it
before planning or debugging (`node scripts/spec-db.mjs memory search "<term>"`, `memory
<notebook>` to list, `memory show <notebook> <seq>` for a full entry); write back when
something is decided, discovered, or learned (`memory add <notebook> "<heading>" "<body>"
[spec_id]` — lessons headings carry the `(spec NNNN)` provenance tag, which the
missing-lesson check and the dashboard's related-memory join both key on). `memory export`
prints markdown for backup or transfer; the DB is per-machine, like the specs it describes.

## Structure

| Directory | Contents |
|---|---|
| `spec.db` | SQLite system of record for the spec lifecycle (gitignored, per-machine) — specs, dependencies, transitions, verification attempts + traces, ledger, memory notebooks, research reports |
| `specs/` | The two shared documents only: `README.md` (conventions + canonical state table) and `spec-template.md` (canonical spec shape) — spec content itself lives in the DB |
| `.claude/skills/spec-plan/` | Skill covering the planning phase of the spec lifecycle |
| `.claude/skills/spec-exec/` | Skill covering the execution phase of the spec lifecycle |
| `.claude/skills/spec-verify/` | Skill covering the verification phase of the spec lifecycle |
| `.claude/skills/research/` | `/research <topic>` — web-search-backed learning guides, saved via `spec-db.mjs research add`, browsable in the dashboard's research panel |
| `.claude/agents/` | `spec-executor.md`, `spec-verifier.md` — thin dispatch entry points into the skills |
| `workflows/state.yaml` | Machine-readable spec lifecycle state table (data only, no orchestration code — `spec-db.mjs move` enforces its `valid_next` at write time; see `specs/README.md` "State Transitions") |
| `memory/` | Memory system: notebooks (decisions, gotchas, lessons) live in the DB as `memory_entries` — write via `spec-db.mjs memory add`, read via `memory`/`memory search`/`memory show`, back up via `memory export`. `memory/README.md` documents conventions. |
| `hooks/` | `pre-bash-safety.mjs` (destructive-git confirmation gate), `post-spec-edit-check.mjs` (spec-drift feedback after `spec-db.mjs` mutations), `session-start-status.mjs` (lifecycle status into session context) |
| `lib/` | Placeholder (`.gitkeep`) |
| `scripts/` | `spec-db.mjs` — the lifecycle CLI: add/list/show/edit/move/dep with transition + dependency enforcement, record-attempt, drift, plus the read-only views (`status`, `check`, `metrics`, `trace`), memory, research, ledger, export, and legacy `import`; `check-state-sync.sh` (state-table sync between `workflows/state.yaml` and `specs/README.md`); `worktree-status.sh` (dispatch-worktree hygiene); `spec-server.mjs` — read-only JSON API + dashboard at `web/index.html` |
| `config/schemas/` | Placeholder (`.gitkeep`) |
| `tests/` | `node --test` suites (run via `npm test`) |
| `projects/` | Placeholder (`.gitkeep`) |

## Commands

```bash
make clean   # git clean -fdX
make check   # state-table sync check + per-spec consistency checks over spec.db (incl. dep-graph)
make status  # per-state spec counts + attention items (failed attempts, blocked)
npm test     # node --test suites (hooks + lifecycle CLI)
```
