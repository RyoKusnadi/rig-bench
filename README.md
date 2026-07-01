# rig-bench

A clean-slate multi-agent harness for Claude Code. Spec-driven development with a plan→execute pipeline, concurrent worktree-isolated execution, a structured lifecycle for every deliverable, and a persistent memory system that gives every agent codebase context without re-reading files.

---

## What It Is

**rig-bench** gives you a disciplined, end-to-end loop for AI-driven software engineering:

1. **Plan** — design a spec interactively before any code is written
2. **Execute** — implement specs concurrently, each agent in its own git worktree
3. **Verify** — confirm implementation matches requirements before marking as finished
4. **Remember** — structural index, git history, and AI-generated docs persist across runs so agents start informed

The `operator` agent is the core execution primitive. It runs inside an isolated git worktree per spec, creates a feature branch, implements, commits, and advances the spec through the lifecycle — all without touching any other spec's work.

---

## How Planning Works

Planning is a Skill (`.claude/skills/spec-plan/`), not a slash command — it triggers naturally
from conversation ("let's plan X", "help me design a spec for Y") or proactively when you jump
straight to "let's build X" for anything nontrivial with no spec yet. **No spec file, and no
code, gets written before you've approved the plan** — everything is drafted and shown to you
first.

**1. Resolve the project.** Specs are scoped per project under `specs/<project_name>/` —
`specs/template/` for this harness itself, `specs/<name>/` for something under `projects/`.
If only one project exists, it's used automatically; if it's ambiguous, you're asked.

**2. Orient.** Reads `specs/README.md` for the lifecycle conventions and `specs/spec-template.md`
for the canonical spec shape — never reconstructed from memory, since either can change
independently of this skill. Finds the next available spec ID for that project from a single
scan (never re-scanned mid-session, so two specs in the same pass can't collide on an ID).

**3. Capture intent.** Before any spec content is drafted, works through what success looks
like, what the shipped docs would say, what key decisions need making, and what's explicitly
out of scope — asking rather than guessing wherever the task is ambiguous. Every spec is also
checked against `CLAUDE.md`'s "Non-negotiables" (destructive git ops, auth/secrets handling,
branch discipline) — unconditionally, even for one-line specs.

For anything with real surface area (new UI, new service, new integration — not one-line
fixes), a **considerations scan** also runs: generic dimensions (non-functional attributes,
integration & dependencies, operational surface, edge cases) get judged Clear / Not applicable
/ Genuinely open for the specific task at hand, rather than checked against a fixed per-domain
checklist. Only genuinely open, design-changing questions survive — checked against the repo's
own config/conventions first, capped at roughly five, batched into a single ask. Where a
sensible default exists (a deploy target, a common library choice), it's researched and
proposed with brief reasoning rather than left as an open question — "here's what I'd do and
why, confirm or override."

**4. Draft.** One deliverable → one spec. Multiple unrelated deliverables get split into
separate specs up front, cross-linked via `depends_on`. Each spec follows
`specs/spec-template.md`'s shape: `Problem`, `Acceptance Criteria` (EARS-style, one behavior
per sentence), `Out of Scope`, `Files/Interfaces Touched`, `Implementation Notes`,
`Verification`.

**5. Approve, then write.** The full drafted content is presented for review. Only after
explicit approval do the specs get written to `specs/<project_name>/ready/{id}-{slug}.md` —
exactly as approved, skipping `draft/` entirely. `scripts/check-specs.sh` then runs
automatically (duplicate IDs, dangling `depends_on`, specs that have outgrown the
one-deliverable sizing rule) before the paths and IDs are reported back to you.

---

## Design Principles

- **Spec first** — no code before the spec is written and approved
- **One spec = one PR** — sized to fit one feature branch and one review
- **Dependency ordering** — `depends_on` is the only coordination mechanism between specs
- **File-conflict gate** — before approval, every batch of specs is scanned for shared files; any two specs that touch the same file are chained via `depends_on` to prevent merge conflicts during concurrent worktree execution
- **Worktree isolation** — concurrent agents never share a working directory
- **Structured output** — every agent call returns a typed schema, not prose
- **State, not transcripts** — the workflow passes structured data between phases, never raw text
- **Memory over re-reading** — structural index, git history, and AI-generated docs are queried at task time; agents never cold-start without codebase context
