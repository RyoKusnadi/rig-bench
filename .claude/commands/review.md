---
description: Run a full quality review on a PR or the current diff. Usage: /review [pr-number]
---

Run the `pr-review` workflow.

$ARGUMENTS

If a PR number was provided above, use `pr=$ARGUMENTS`. If no argument was given, review the current HEAD diff.

Always use `effort=high` for reviews triggered via this command.

Pass `spec=<requirements text>` only if a spec or acceptance criteria can be inferred from the PR description or the task context — otherwise omit it and inspector skips the spec-compliance check.

Start by saying: "Starting pr-review pipeline$ARGUMENTS" then invoke the workflow.
