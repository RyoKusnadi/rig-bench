---
description: Verify that a spec's implementation matches its requirements, then move it to finished. Usage: /verify [project] [all | <id> <id> ...]
---

Verify specs for: $ARGUMENTS

## Step 0 — Resolve the project

Follow "Resolving the target project" in `specs/README.md` — the canonical procedure, shared
by `/execute`, `/verify`, the `spec-plan` skill, and the `operator` agent. Match the first
token of `$ARGUMENTS` against the candidate list; if it matches, strip it from `$ARGUMENTS`
before continuing to Step 1.

All `specs/...` paths below are relative to `specs/<project>/`.

## Step 1 — Discover specs

List specs awaiting verification:
```bash
ls specs/<project>/waiting_verification/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter of each file and extract:
- `id` — zero-padded 4-digit string (e.g. `0001`)
- `title` — short imperative title
- `status` — should be `waiting_verification`

Also read the full body of each file to extract:
- `Acceptance Criteria` — the EARS-style behavioral sentences that must hold
- `Verification` — the concrete end-to-end check defined at authoring time

If the folder is empty, report "No specs are waiting verification." and stop.

## Step 2 — Determine which specs to verify

Parse the remainder of `$ARGUMENTS` (after the project token was stripped in Step 0, trimming whitespace):

- **Empty**: Use `AskUserQuestion` to present the discovered specs as options and let the user choose. Show each as `{id} — {title}`. Include an "All waiting specs" option.
- **`all`**: Select all discovered specs.
- **Space-separated IDs** (e.g. `0001 0003`): Select only those IDs. If any ID is not found in `specs/<project>/waiting_verification/`, stop and report the missing ID.

## Step 3 — Verify each spec

For each selected spec, work through the following checks in order. Collect results before moving any files.

**3a. Read the implementation**

Use the `Files / Interfaces Touched` section of the spec to know exactly which files to read. Read each one. If a listed file does not exist, record it as a failure immediately — do not skip ahead.

**3b. Check each Acceptance Criterion**

For every EARS-style criterion in `Acceptance Criteria`:
1. State the criterion verbatim.
2. Locate the code that satisfies it (file path + line number).
3. Mark it **PASS** or **FAIL**. A criterion fails if no code can be found that plausibly implements it, or if the behavior contradicts the criterion.

**3c. Run the Verification step**

Execute the command or manual check described in the `Verification` section of the spec. Capture and record the output. Mark **PASS** if the output matches what the spec expects, **FAIL** otherwise.

If the `Verification` section specifies a manual step that requires human confirmation, emit a `AskUserQuestion` asking the user to confirm that the verification step passed before continuing.

## Step 4 — Report results

After checking all selected specs, print a summary table:

```
Spec 0001 — <title>
  [PASS] Criterion 1: <criterion text>
  [FAIL] Criterion 2: <criterion text>
         Reason: <what was missing or wrong>
  [PASS] Verification: <command output>

Overall: PASS / FAIL
```

## Step 5 — Move passing specs to finished

For every spec where **all** criteria and the verification step passed:

```bash
git mv specs/<project>/waiting_verification/<filename> specs/<project>/finished/<filename>
```

Update the `status` field in the spec frontmatter from `waiting_verification` to `finished`:

Use the `Edit` tool to change:
```
status: waiting_verification
```
to:
```
status: finished
```

Then commit:
```bash
git add -f specs/<project>/finished/<filename>
git commit -m "spec(<id>): mark <slug> as finished"
```

Report: `Spec {id} — {title}: verified and moved to finished.`

## Step 6 — Handle failing specs

For every spec where **any** criterion or the verification step failed:

- Leave the file in `specs/<project>/waiting_verification/` — do not move it.
- Report all failures clearly so the implementer knows exactly what to fix.
- Do **not** commit anything for failing specs.

Report: `Spec {id} — {title}: verification FAILED — see above for details.`

## Argument quick reference

| Invocation | Behaviour |
|---|---|
| `/verify` | Interactive: resolves project (asking if ambiguous), lists waiting specs, asks which to verify |
| `/verify template all` | Verify all specs in `specs/template/waiting_verification/` |
| `/verify template 0001 0003` | Verify only specs 0001 and 0003 in the `template` project |
| `/verify all` | Same as above, but only valid when exactly one project folder exists |
