---
description: Run the questionnaire-driven research loop for a topic. Usage: /research <topic>
---

Run the `research` workflow for: $ARGUMENTS

1. Check whether `research/<slug of $ARGUMENTS>/intake.json` already exists. If not, run `node scripts/ask-questionnaire.mjs` (it will prompt interactively for topic/focus_areas/etc., defaulting `topic` to $ARGUMENTS if asked) to produce it.
2. Read the resulting `intake.json` with the `Read` tool.
3. Run `node scripts/set-agent-role.mjs research` — this locks the session into the `research` RBAC profile (hooks/pre-tool-gatekeeper.mjs): read-only tools only, edits restricted to `TITLE.MD`/`research_output/`, Bash restricted to read-only/search commands. Do this immediately before invoking the workflow, not earlier.
4. Invoke the `research` workflow with `args.intake` set to that file's parsed JSON contents — never a file path; the workflow script has no filesystem access of its own.
5. As soon as the workflow returns (success, BLOCK, or error — always), run `node scripts/set-agent-role.mjs clear` before doing anything else, so the rest of this session isn't left in read-only mode.

Start by saying: "Starting research loop for: $ARGUMENTS" then invoke the workflow.

When the workflow returns:
1. Report `research_state.current_hypothesis`, `confidence_score`, and whether it `completed` or hit `max_iterations`.
2. If `report` is non-null, assemble the YAML frontmatter from `report.frontmatter` plus a `generated_at` field set to today's date (ISO 8601 — the workflow script cannot mint this itself, see `workflows/README.md#researchjs`), then `Write` it together with `report.body_markdown` to `research/<slug of $ARGUMENTS>/TITLE.MD`, matching the structure documented in `todo.md` Phase 5.
3. If `report` is `null`, say why (the workflow logs the synthesis BLOCK/failure reason) — don't fabricate a report, and skip step 4.
4. After writing `TITLE.MD`, run `node scripts/ingest-memory.mjs` so the report is indexed into the memory vector store (`todo.md` Phase 6) — `operator`/`inspector` pick it up automatically through their existing `scripts/query-memory.mjs` calls, no further wiring needed.
5. Run `node scripts/sync-obsidian.mjs <slug> <generated_at> <outcome> [TITLE.MD path] [intake.json path]` (`specs/0002-obsidian-vault-research-sync.md`) to mirror the run into an external Obsidian vault:
   - `<slug>` is the same slug used for `research/<slug>/`.
   - `<generated_at>` must be the exact same ISO 8601 timestamp used when writing `TITLE.MD` in step 2 — don't mint a second one.
   - `<outcome>` is `research_state.outcome` from the workflow result (`COMPLETE`/`INCOMPLETE`/`FAILED`/`BLOCKED`).
   - Pass `TITLE.MD`'s path only if `report` was non-null (step 3 already covers the null case — still run this step so the run gets logged either way, just omit that argument).
   - Pass `research/<slug>/intake.json`'s path as the last argument so the raw questionnaire gets copied into the vault's `raw/` directory.
   - If `RIGBENCH_OBSIDIAN_VAULT_PATH` isn't set, the script prints a one-line notice and exits 0 — this step is a no-op for anyone without a configured vault, not an error.
