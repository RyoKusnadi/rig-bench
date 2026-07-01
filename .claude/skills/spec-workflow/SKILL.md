---
name: spec-workflow
description: Guides spec-driven development in this repo — collaboratively planning a spec before any code is written, executing ready specs with dependency ordering, and verifying implementations against their acceptance criteria before they ship. Use this whenever the user wants to design or scope something before coding ("let's plan this out", "write a spec for X", "spec out the new hook", "think this through before we build it"), wants to implement one or more specs sitting in specs/ready or specs/in_progress ("build spec 0003", "run all the ready specs", "resume 0007"), or wants to confirm a finished implementation actually meets its requirements before it ships ("is 0003 actually done?", "verify the operator changes", "check this against the spec"). Also trigger on mentions of the spec lifecycle (draft/ready/in_progress/waiting_verification/finished) or the specs/ folder generally, even if the user doesn't use the word "spec" explicitly.
---

# Spec Workflow

## Why this exists

Code written before the intent behind it is nailed down tends to drift from
what was actually needed — the fix is usually a redo, not a patch. This
workflow borrows Karpathy's "agentic engineering" idea: agent and user
co-design a short, docs-level spec *before* any implementation, and that
spec — not the code that follows — is the source of truth for what "done"
means. Three phases carry a spec through its life: **plan** it, **execute**
it, **verify** it.

## The lifecycle

```
draft → ready → in_progress → waiting_verification → finished
                                                     ↘ blocked / abandoned
```

Each status is a folder under `specs/`. A spec file physically moves
folders as its status changes — `git mv`, not just an edit — so `ls
specs/ready/` always tells you the truth about what's pickable right now.

| Folder | Meaning |
|---|---|
| `specs/draft/` | Being written; may still contain `[NEEDS CLARIFICATION]` markers |
| `specs/ready/` | All ambiguity resolved; available to `/execute` |
| `specs/in_progress/` | Actively being implemented |
| `specs/waiting_verification/` | Built and self-inspected; awaiting confirmation before shipping |
| `specs/finished/` | Shipped — the merged PR is the permanent record |
| `specs/blocked/` | Waiting on a dependency or a decision |
| `specs/abandoned/` | Won't do; kept for reference |

Full authoring conventions (naming, frontmatter schema, EARS acceptance
criteria, the file-conflict gate) live in `specs/README.md` — read it once
per session rather than re-deriving these rules from scratch each time.

## Conventions shared across all three phases

**Spec IDs** are sequential, zero-padded, and never reused or renumbered
(use `depends_on` to express reordering instead). Because spec files are
gitignored, git history is not a reliable source for "what's the next ID" —
always check the filesystem:

```bash
find specs -name "[0-9]*.md" | sort | tail -1
```

If a session allocates several new IDs, read this list once and hand out
every ID from that single read. Re-scanning mid-session is how two specs
end up claiming the same ID.

**Frontmatter** every spec carries:

```yaml
---
id: 0001
title: Short imperative title
status: draft
depends_on: []
source: todo.md#anchor-or-section-name
---
```

## Figuring out which phase the user wants

| The user is... | Phase | Read |
|---|---|---|
| Describing a new feature/change, asking to design or scope something, hasn't written code yet | **Plan** | `references/plan.md` |
| Pointing at spec IDs (or "all") in `specs/ready/`, asking to build/implement/resume work | **Execute** | `references/execute.md` |
| Asking whether something is actually done, pointing at `specs/waiting_verification/` | **Verify** | `references/verify.md` |

Read the matching reference file in full before doing anything else in that
phase — each one carries the concrete steps, tool calls, and edge cases
that don't need to live in every session's context up front. Don't
guess at phase-specific mechanics from this overview alone.

If the request is genuinely ambiguous between phases (rare — most requests
are clearly "I want to design X" vs "go build 0003"), ask rather than
assume; picking the wrong phase means either skipping planning entirely or
re-implementing something already in flight.
