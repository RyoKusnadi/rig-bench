# Verify phase

Check that a spec's implementation actually matches what it promised,
before it's allowed to move to `finished`. This is the gate that catches
"implemented something" vs "implemented the thing that was specified" —
those two aren't always the same, especially for criteria that are easy to
half-satisfy.

## Step 1 — Discover specs

```bash
ls specs/waiting_verification/ 2>/dev/null | grep '\.md$'
```

Read the frontmatter (`id`, `title`, `status`) and the full body — you need
`Acceptance Criteria` and `Verification` from the body, not just the
frontmatter.

If the folder is empty, report "No specs are waiting verification." and stop.

## Step 2 — Determine which specs to verify

- **None specified**: present the discovered specs and let the user
  choose — `{id} — {title}`, plus an "all waiting specs" option.
- **"all"**: verify every discovered spec.
- **Specific IDs**: verify only those; stop and report if an ID isn't
  found in `specs/waiting_verification/`.

## Step 3 — Verify each spec

Work through these checks in order for each selected spec. Collect all
results before moving any files — moving a spec to `finished` mid-check,
then finding a later criterion fails, means undoing a state change that
shouldn't have happened yet.

**3a. Read the implementation**

Use `Files / Interfaces Touched` to know exactly which files to read. If a
listed file doesn't exist, that's an immediate failure for whatever
criterion depended on it — don't skip ahead assuming it'll turn up
elsewhere.

**3b. Check each Acceptance Criterion**

For every EARS-style criterion:

1. State the criterion verbatim.
2. Locate the code that satisfies it — file path and line number, not just
   "yes it's handled somewhere."
3. Mark **PASS** or **FAIL**. A criterion fails if no code plausibly
   implements it, or if the behavior contradicts what the criterion says.

**3c. Run the Verification step**

Execute the command or manual check the spec defined at authoring time.
Capture the output and mark **PASS** if it matches what the spec expects,
**FAIL** otherwise. If the step requires human confirmation (a manual
check that can't be run programmatically), use `AskUserQuestion` to get
that confirmation before continuing — don't assume it passed because the
description sounds plausible.

## Step 4 — Report results

```
Spec 0001 — <title>
  [PASS] Criterion 1: <criterion text>
  [FAIL] Criterion 2: <criterion text>
         Reason: <what was missing or wrong>
  [PASS] Verification: <command output>

Overall: PASS / FAIL
```

## Step 5 — Move passing specs to finished

Only for specs where **every** criterion and the verification step passed:

```bash
git mv specs/waiting_verification/<filename> specs/finished/<filename>
```

Update the frontmatter `status` from `waiting_verification` to `finished`,
then commit:

```bash
git add specs/finished/<filename>
git commit -m "spec(<id>): mark <slug> as finished"
```

Report: `Spec {id} — {title}: verified and moved to finished.`

## Step 6 — Handle failing specs

For any spec where a criterion or the verification step failed:

- Leave the file in `specs/waiting_verification/` — do not move it. A spec
  that hasn't earned `finished` shouldn't carry that status just because
  the run is over.
- Report all failures clearly enough that the implementer knows exactly
  what to fix without re-deriving it from the spec.
- Don't commit anything for failing specs.

Report: `Spec {id} — {title}: verification FAILED — see above for details.`

## Quick reference

| Invocation | Behaviour |
|---|---|
| None specified | Interactive: lists waiting specs and asks which to verify |
| `all` | Verify all specs in `specs/waiting_verification/` |
| `0001 0003` | Verify only those specs |
