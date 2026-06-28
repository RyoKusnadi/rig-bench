---
description: Run the full new-feature pipeline for a task. Usage: /ship <task description>
---

Run the `new-feature` workflow with the following task:

**Task:** $ARGUMENTS

Select effort mode automatically:
- If the task mentions auth, JWT, session, token, API keys, credentials, permissions → use `effort=high`
- Otherwise → use `effort=medium`

Start by saying: "Starting new-feature pipeline for: $ARGUMENTS" then invoke the workflow.
