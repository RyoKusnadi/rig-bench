---
description: Cluster pending instincts into permanent project rules
---

Promote recurring failure patterns out of `.claude/instincts/pending/` into permanent,
reusable rules — this is the missing half of the Stop hook's capture step
(`hooks/evaluate-session.mjs`), which only ever appends to `pending/` and never
promotes anything on its own.

1. List `.claude/instincts/pending/*.md`. If the directory is empty or missing, report
   "Nothing to evolve — no pending instincts." and stop.
2. Read every file. Group files that share a root cause (same `keyword:` frontmatter
   field, or different keywords but the same underlying snippet/cause — e.g. five
   separate `NO_TESTS` instincts that all trace back to the same untested module).
3. For each group with `occurrences >= 3` (summed across its files) or instincts seen
   in 2+ distinct `session_id`s, synthesize one concise markdown rule: the pattern,
   why it recurs, and the concrete fix/check to apply going forward. Skip groups below
   that bar — a single-session one-off isn't a generalizable rule yet, leave it pending.
4. Write the synthesized rule to `subagents/rules/common/<short-kebab-name>.md`,
   matching the format of `subagents/rules/common/git-workflow.md` (a `title:`
   frontmatter field, then `## Overview` and topic sections). If a near-duplicate rule
   file already exists, extend it instead of creating a new one.
5. Delete the pending instinct files that were promoted (`rm .claude/instincts/pending/INST-*.md`
   for each one folded into the new rule). Leave ungrouped/below-threshold files alone.
6. Update `.claude/memory/conventions.md` with a one-line pointer to the new rule file,
   following the existing entries' format. Keep `.claude/memory/MEMORY.md` in sync if
   `conventions.md`'s line count changed materially.
7. Report what was promoted (rule file + source instincts), what was left pending and
   why (below the occurrence/session threshold), and the diff of files touched.

Do not invent patterns that aren't backed by an actual pending instinct file — only
synthesize from what's on disk.
