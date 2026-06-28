---
description: Verify specs awaiting human confirmation and ship them if they pass. Usage: /verify [all | <id> <id> ...]
---

Verify specs from `specs/waiting_verification/` for: $ARGUMENTS

## Step 1 — Discover specs

Use Bash to list available spec files:
```bash
ls specs/waiting_verification/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter of each file (use `Read` on each path) and extract:
- `id` — zero-padded 4-digit string (e.g. `0001`)
- `title` — short imperative title
- `status` — should be `waiting_verification`
- `depends_on` — array of spec IDs this spec depends on (may be empty)

Also collect the IDs of all specs in `specs/done/` (they count as pre-satisfied dependencies):
```bash
ls specs/done/ 2>/dev/null | grep '\.md$' | sed 's/-.*//' | head -100
```

If no specs are found in `specs/waiting_verification/`, report:
```
No specs are awaiting verification. Run /execute first to build and inspect specs.
```
and stop.

## Step 2 — Determine which specs to verify

Parse `$ARGUMENTS`:

- **Empty**: Use `AskUserQuestion` to present the discovered specs as options and let the user choose. Show each as `{id} — {title}` with its `depends_on` listed. Include a "Verify all" option.
- **`all`**: Select all discovered specs.
- **Space-separated IDs** (e.g. `0001 0003`): Select only those IDs. If any ID is not found in `specs/waiting_verification/`, stop and report the missing ID.

## Step 3 — Validate dependencies

For each selected spec, check that every entry in its `depends_on` array is either:
- An ID present in `specs/done/` (already satisfied), OR
- Also in the selected set (will be verified in this batch)

If any dependency is unsatisfied, **stop** and report clearly:
```
ERROR: Spec 0003 depends on spec 0001, but 0001 is not done and was not selected.
Run /verify 0001 first, or ensure it is in specs/done/.
```

Do not proceed until all dependencies are satisfied.

## Step 4 — Invoke the workflow

Build the `specs` array: for each selected spec, include its full file content (from `Read`), the file path, and the parsed frontmatter fields.

Invoke:
```
Workflow({
  name: 'verify-specs',
  args: {
    specs: [
      {
        id: '<id>',
        title: '<title>',
        filePath: 'specs/waiting_verification/<filename>',
        depends_on: [...],
        content: '<full file contents>'
      },
      ...
    ],
    effort: 'medium'   // default; the user may override with --effort=high etc.
  }
})
```

The workflow runs each spec's `## Verification` section steps, confirms all Acceptance Criteria are met, then ships (push branch + create draft PR) and moves the spec to `specs/done/` on success.

## Argument quick reference

| Invocation | Behaviour |
|---|---|
| `/verify` | Interactive: lists awaiting specs and asks which to verify |
| `/verify all` | Verify all specs in `specs/waiting_verification/` |
| `/verify 0001 0003` | Verify only specs 0001 and 0003 |
| `/verify 0002 --effort=high` | Verify spec 0002 with high-effort mode |
