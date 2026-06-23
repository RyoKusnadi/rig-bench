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
2. If `report` is non-null, assemble the YAML frontmatter from `report.frontmatter` plus a `generated_at` field set to today's date (ISO 8601 — the workflow script cannot mint this itself, see `workflows/README.md#researchjs`), then `Write` it together with `report.body_markdown` to `research/<slug of $ARGUMENTS>/TITLE.MD`, matching the report structure used elsewhere in this workflow.
3. If `report` is `null`, say why (the workflow logs the synthesis BLOCK/failure reason) — don't fabricate a report, and skip step 4.
4. After writing `TITLE.MD`, run `node scripts/ingest-memory.mjs` so the report is indexed into the memory vector store — `operator`/`inspector` pick it up automatically through their existing `scripts/query-memory.mjs` calls, no further wiring needed.
