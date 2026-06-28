---
description: Run the autotune self-improvement loop on one agent .md file. Usage: /autotune <target> <objective>
---

Run the `autotune` workflow.

Target: the first token of $ARGUMENTS if it matches `subagents/scout/scout.md` or `subagents/researcher/researcher.md`; otherwise ask which of those two before proceeding — this workflow only mutates files on that allowlist (operator.md/inspector.md are excluded, they ARE the mutator/evaluator in this loop).

Objective: the rest of $ARGUMENTS.

Invoke the workflow with `args.target` and `args.objective` set accordingly. Use defaults for `max_iterations` (8) and `stop_streak` (3) unless the user specified otherwise.

Start by saying: "Starting autotune loop on <target> — objective: <objective>" then invoke the workflow.

When it returns, report `baseline_score`, `final_score`, `kept_count`/`discarded_count`, and `stop_reason`. Every kept mutation is already a local commit (see `git log -- <target>` for the per-iteration history) — nothing has been pushed; that's a separate, explicit step if the user wants it.
