---
description: Plan and scaffold a new spec under specs/. Usage: /specs <task or todo.md item>
---

Scaffold one new spec file under `specs/` for: $ARGUMENTS

This command runs entirely in plan mode — never create a spec file before the
user has approved the plan.

1. Call `EnterPlanMode` immediately, before any exploration.
2. While in plan mode, gather what's needed to write the spec:
   - Read `specs/README.md` for the frontmatter/lifecycle convention.
   - List `specs/*.md` (and `specs/done/*.md` if present) to find the
     highest existing `id` — the new spec's `id` is the next integer,
     zero-padded to 4 digits. Never reuse or renumber an existing id.
   - If `$ARGUMENTS` references a `todo.md` section, read that section for
     the `source:` anchor and problem framing.
   - If the scope is ambiguous (genuinely one deliverable vs. something that
     should split into two+ specs, or the acceptance criteria aren't clear
     from $ARGUMENTS), use `AskUserQuestion` to resolve it before writing the
     plan — don't guess.
3. Draft the full spec content (frontmatter + Problem / Acceptance Criteria /
   Out of Scope / Implementation Notes, matching `specs/README.md`'s
   template) into the plan itself — the plan must contain the literal file
   content you intend to write, not just a description of it. Default
   `status: draft`.
4. If the work is clearly larger than one deliverable (touches multiple
   unrelated files/hooks, or `specs/README.md`'s sizing rule would be
   violated), propose splitting into multiple specs in the plan rather than
   writing one oversized spec.
5. Call `ExitPlanMode` with the drafted spec content for the user to review.
6. Only after approval, write the spec file(s) to
   `specs/{id}-{kebab-slug}.md` exactly as planned. Do not add, remove, or
   reorder sections relative to what was approved.
7. Report the file path(s) created and the chosen `id`(s).

Start by saying: "Planning a new spec for: $ARGUMENTS" then call `EnterPlanMode`.
