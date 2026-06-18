---
description: Enforce the documented memory TTL — archive stale session notes, flag stale codebase-memory entries for review
---

`memory/README.md` documents `memory/sessions/` as a "rolling scratch notes (7-day
TTL)" — but nothing currently enforces that TTL, and `.claude/memory/` has no
staleness check at all. This command is the deliberate, reviewable enforcement step
(same pattern as `/evolve`): it never deletes anything outright, it archives or
flags for a human to confirm.

1. **Archive stale session notes** (`memory/sessions/*.md`, excluding `.gitkeep`):
   - For each file, get its last-commit age: `git log -1 --format=%ct -- <file>`.
     Untracked files (never committed) use their filesystem mtime instead.
   - Any file older than 7 days: `git mv` it into `memory/sessions/archive/<file>`
     (create the directory if needed). Don't delete — archiving preserves it for
     later reference without it cluttering the active scratch space.
   - Report what was archived and its age in days.

2. **Flag stale `.claude/memory/` entries** (`conventions.md`, `architecture.md`,
   `gotchas.md`, `lessons-learned.md`, `decisions.md` — never `MEMORY.md` itself):
   - These are sectioned files, not one-file-per-entry, so use `git log -1
     --format=%ct -- <file>` as a file-level signal first; if a file as a whole
     hasn't changed in 90+ days, read it and identify which individual entries
     look stale (reference a file path that no longer exists via `Glob`, a branch
     that's been deleted, or a dependency version that's since changed — check
     against the current repo state, don't guess from the text alone).
   - **Do not delete or edit these entries yourself.** Report them as a numbered
     list (file, entry, why it looks stale, age) for a human to confirm before
     anything is removed. Wrong removals here lose institutional knowledge that's
     expensive to rediscover — the cost of a false positive in this report is low,
     the cost of silently deleting a still-relevant gotcha is not.

3. **Summarize**: archived count + list, flagged-for-review count + list, and
   anything skipped (e.g. a session file with uncommitted local changes — leave
   those alone rather than archiving unsaved work).

Do not run test suites or touch any code — this command only ever moves files
under `memory/` or produces a report; it never edits `.claude/memory/*.md` content.
