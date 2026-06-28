---
description: Ask a question against the Obsidian vault's compiled research and optionally file the answer back as a wiki page. Usage: /wiki-query <question>
---

Answer from the Obsidian vault for: $ARGUMENTS

This is the "Query" loop operation (`specs/0003-obsidian-vault-query.md`) —
fast retrieval from wiki pages already compiled by `/research`
(`specs/0002-obsidian-vault-research-sync.md`), not a new research run.

1. Run `node scripts/query-obsidian.mjs "$ARGUMENTS"` (requires
   `RIGBENCH_OBSIDIAN_VAULT_PATH` to be set — if it errors because the env
   var is unset, report that and stop; don't fall back to `/research`
   automatically).
2. If the result is `<vault_memory><!-- No relevant vault content found for
   this query. --></vault_memory>` (empty or no matching chunks), tell the
   user the vault has no relevant content for this question and suggest
   running `/research <topic>` themselves if they want to fill that gap.
   Don't fabricate an answer from irrelevant chunks.
3. Otherwise, read the returned `<memory_item>` chunks (each has a
   `source="wiki/{slug}.md"` and `heading` attribute) and synthesize an
   answer, citing which wiki page(s) you drew from by their `source`.
4. Present the synthesized answer to the user, then ask whether they want
   it filed back into the vault as a new dated section.
5. If the user declines, stop — report the answer only, no vault write.
6. If the user confirms:
   - If the answer clearly extends one existing page (i.e. most of the
     cited chunks came from a single `source`), append a
     `## Update {today's date, ISO 8601}` section with the synthesized
     answer to that page (`${RIGBENCH_OBSIDIAN_VAULT_PATH}/wiki/{slug}.md`)
     using the `Edit` tool.
   - Otherwise, create a new page at
     `${RIGBENCH_OBSIDIAN_VAULT_PATH}/wiki/{new-slug}.md` with a minimal
     frontmatter block (`topic`, `generated_at`) followed by the answer, and
     add a line for it in `${RIGBENCH_OBSIDIAN_VAULT_PATH}/index.md` linking
     via `[[wiki/{new-slug}]]` — same append-or-create shape `scripts/sync-obsidian.mjs`
     already uses for `/research` runs, just done by hand here since this
     is a single short answer, not a full report.
