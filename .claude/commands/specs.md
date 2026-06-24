---
description: Plan and scaffold one or more new specs under specs/. Usage: /specs <task or description>
---

Scaffold one or more new spec files under `specs/` for: $ARGUMENTS

This command runs entirely in plan mode — never create a spec file before the
user has approved the plan.

1. Call `EnterPlanMode` immediately, before any exploration.
2. While in plan mode, gather what's needed to write the spec:
   - Read `specs/README.md` for the frontmatter/lifecycle convention.
   - List `specs/*.md` (and `specs/done/*.md` if present) to find the
     highest existing `id` — read this once per planning pass and allocate
     every `id` this invocation needs (one or many — see step 4) from that
     single read, sequentially. Never reuse or renumber an existing id, and
     never re-scan between allocating ids within the same pass (re-scanning
     mid-allocation is what causes id collisions when multiple new specs are
     drafted together — see GitHub Spec Kit issue #1066 for the failure mode
     this avoids).
   - If `$ARGUMENTS` references prior context (an existing decision in
     `.claude/memory/decisions.md`, a GitHub issue, a discussion), read that
     for the `source:` anchor and problem framing.
   - If `$ARGUMENTS` (or the plan as drafted) names a `depends_on` id, resolve
     it against the listing above. If it doesn't exist (typo, or a sibling
     spec not yet drafted in this same pass), use `AskUserQuestion` to
     resolve it rather than writing a dangling reference — don't guess at
     which spec was meant. A `depends_on` pointing at a sibling being
     scaffolded in this same invocation is not dangling; resolve it to that
     sibling's allocated id.
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
   violated), split it into multiple specs in the same plan rather than
   writing one oversized spec: draft each sibling spec's full content,
   cross-link them via `depends_on` where one genuinely blocks another
   (set those pointers now, while the relationships are fresh — don't leave
   them for a later pass), and present all of them together in the one
   `ExitPlanMode` call.
5. Call `ExitPlanMode` with the drafted spec content (one or many files) for
   the user to review.
6. Only after approval, write each approved spec file to
   `specs/{id}-{kebab-slug}.md` exactly as planned, looping over the full
   list if more than one. Do not add, remove, or reorder sections relative
   to what was approved.
7. Report the file path(s) created and the chosen `id`(s). If more than one
   spec was created, also run `npm run specs:graph` and report its result —
   confirms the new `depends_on` links resolve cleanly before you hand off.

Start by saying: "Planning a new spec for: $ARGUMENTS" then call `EnterPlanMode`.
