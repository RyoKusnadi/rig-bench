---
description: Execute one or more ready specs with dependency ordering. Usage: /execute [all | <id> <id> ...] [--resume]
---

Execute specs from `specs/ready/` (and `specs/in_progress/` if `--resume` is present) for: $ARGUMENTS

## Step 1 — Discover specs

Use Bash to list available spec files:
```bash
ls specs/ready/ 2>/dev/null | grep '\.md$'
```
If `--resume` is in `$ARGUMENTS`, also list:
```bash
ls specs/in_progress/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter of each file (use `Read` on each path) and extract:
- `id` — zero-padded 4-digit string (e.g. `0001`)
- `title` — short imperative title
- `status` — should be `ready` or `in_progress`
- `depends_on` — array of spec IDs this spec depends on (may be empty)

Also collect the IDs of all specs in `specs/finished/` (they count as pre-satisfied dependencies):
```bash
ls specs/finished/ 2>/dev/null | grep '\.md$' | sed 's/-.*//' | head -100
```

## Step 2 — Determine which specs to run

Parse `$ARGUMENTS` (ignoring `--resume`):

- **Empty**: Use `AskUserQuestion` to present the discovered specs as options and let the user choose. Show each as `{id} — {title}` with its `depends_on` listed. Include an "All ready specs" option.
- **`all`**: Select all discovered specs.
- **Space-separated IDs** (e.g. `0001 0003`): Select only those IDs. If any ID is not found in `specs/ready/` (or `specs/in_progress/` with `--resume`), stop and report the missing ID.

## Step 3 — Validate dependencies

For each selected spec, check that every entry in its `depends_on` array is either:
- An ID present in `specs/finished/` (already satisfied), OR
- Also in the selected set (will be run in this batch)

If any dependency is unsatisfied, **stop** and report clearly:
```
ERROR: Spec 0003 depends on spec 0001, but 0001 is not finished and was not selected.
Either add 0001 to the selection or ensure it is in specs/finished/.
```

Do not proceed until all dependencies are satisfied.

## Step 4 — Warn about file overlap (optional but recommended)

For specs that will run concurrently (no dependency between them), check whether their "Files/Interfaces Touched" sections overlap. If they do, emit a warning:
```
WARNING: Specs 0001 and 0002 both touch lib/foo.mjs — they will run concurrently.
If they edit conflicting lines, the second commit may conflict with the first.
Proceeding anyway.
```
Do not block execution — this is advisory only.

## Step 5 — Execute each spec

Process specs in dependency order (specs with no unfinished `depends_on` first, then those
whose dependencies have just completed). For each spec:

**5a. Move to in_progress**
```bash
git mv specs/ready/<filename> specs/in_progress/<filename>
```
(If `--resume` and the file is already in `specs/in_progress/`, skip this move.)

**5b. Implement the spec**

Read the full spec file content, then implement all acceptance criteria: create a feature
branch named after the spec ID and slug, make the necessary code changes, commit, and open
a draft PR.

**5c. Move to waiting_verification**
```bash
git mv specs/in_progress/<filename> specs/waiting_verification/<filename>
```

Report: `Spec {id} — {title}: implementation complete, awaiting verification.`

## Argument quick reference

| Invocation | Behaviour |
|---|---|
| `/execute` | Interactive: lists specs and asks which to run |
| `/execute all` | Execute all specs in `specs/ready/` |
| `/execute 0001 0003` | Execute only specs 0001 and 0003 |
| `/execute all --resume` | Include specs already in `specs/in_progress/` |
