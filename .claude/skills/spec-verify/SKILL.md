---
name: spec-verify
description: Checks a spec's implementation against its Acceptance Criteria and Verification step, then moves passing specs from waiting_verification/ to finished/ under specs/<project>/. Use whenever the user asks to verify, check, confirm, or sign off on a spec — phrases like "verify 0001", "check if the specs are done", "did that implementation actually meet the criteria", "confirm 0003 and 0004 are good to ship", "is the waiting_verification stuff ready", or "sign off on the ready ones". Does not apply to implementing a spec that hasn't been built yet (use spec-exec for that) or to designing a spec that doesn't exist yet (use spec-plan) — see the skill body for the full boundary.
---

# Spec Verification

This skill runs the confirmation half of this repo's spec-driven workflow: a spec sitting in
`waiting_verification/` gets checked against its own `Acceptance Criteria` and `Verification`
sections, and only moves to `finished/` if every check actually passes. The spec is the
source of truth for what "done" means here too — verification checks the code against what
the spec says, not against what the implementation happened to do.

**When this applies:** any request to verify, check, confirm, or sign off on specs that
already have an implementation sitting in `waiting_verification/` — including proactively,
when a user says "is that done?" or "did it actually work?" about a spec already at that
stage. This does *not* apply to implementing a spec that hasn't been built yet (use the
`spec-exec` skill first) or to designing a spec that doesn't exist yet (use `spec-plan`) —
verification only ever looks backward at work already claimed to be finished.

## Phase 0 — Resolve the project

Follow "Resolving the target project" in `specs/README.md` — the canonical procedure, shared
by every entry point into the spec workflow. If the task clearly names or implies a project,
use it; otherwise apply the resolution order described there rather than guessing.

All `specs/...` paths below are relative to `specs/<project>/` — e.g. "`finished/`" means
`specs/<project>/finished/`.

## Phase 1 — Discover specs

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

## Phase 2 — Determine which specs to verify

- **User didn't name specific IDs**: present the discovered specs and ask which to verify —
  show each as `{id} — {title}`, and offer "all waiting specs" as an option.
- **User said "all"**: select every discovered spec.
- **User named specific IDs** (e.g. "0001 and 0003"): select only those. If any named ID
  isn't found in `waiting_verification/`, stop and report the missing ID rather than silently
  skipping it.

## Phase 3 — Verify each spec

For each selected spec, work through the following checks in order. Collect results before
moving any files.

**3a. Read the implementation**

Use the `Files / Interfaces Touched` section of the spec to know exactly which files to read.
Read each one. If a listed file does not exist, record it as a failure immediately — do not
skip ahead.

**3b. Check each Acceptance Criterion**

For every EARS-style criterion in `Acceptance Criteria`:
1. State the criterion verbatim.
2. Locate the code that satisfies it (file path + line number).
3. Mark it **PASS** or **FAIL**. A criterion fails if no code can be found that plausibly
   implements it, or if the behavior contradicts the criterion.

**3c. Run the Verification step**

Execute the command or manual check described in the `Verification` section of the spec.
Capture and record the output. Mark **PASS** if the output matches what the spec expects,
**FAIL** otherwise.

If the `Verification` section specifies a manual step that requires human confirmation, ask
the user to confirm that the verification step passed before continuing.

## Phase 4 — Report results

After checking all selected specs, print a summary table:

```
Spec 0001 — <title>
  [PASS] Criterion 1: <criterion text>
  [FAIL] Criterion 2: <criterion text>
         Reason: <what was missing or wrong>
  [PASS] Verification: <command output>

Overall: PASS / FAIL
```

## Phase 5 — Move passing specs to finished

For every spec where **all** criteria and the verification step passed:

```bash
git mv specs/<project>/waiting_verification/<filename> specs/<project>/finished/<filename>
```

Update the `status` field in the spec frontmatter from `waiting_verification` to `finished`.

Then commit:
```bash
git add -f specs/<project>/finished/<filename>
git commit -m "spec(<id>): mark <slug> as finished"
```

Report: `Spec {id} — {title}: verified and moved to finished.`

## Phase 6 — Handle failing specs

For every spec where **any** criterion or the verification step failed:

- Leave the file in `specs/<project>/waiting_verification/` — do not move it.
- Report all failures clearly so the implementer knows exactly what to fix.
- Do **not** commit anything for failing specs.

Report: `Spec {id} — {title}: verification FAILED — see above for details.`

## Quick reference

| Request | Behavior |
|---|---|
| "verify the specs" / "check what's waiting" | Resolves the project (asking if ambiguous), lists waiting specs, asks which to verify |
| "verify all specs in template" | Verify every spec in `specs/template/waiting_verification/` |
| "verify 0001 and 0003 in template" | Verify only those two specs |
| "is the template stuff ready to ship" | Same as "verify the specs", scoped to `template` |

## Gotchas

None recorded yet. Add entries here as real failure modes surface in practice — this section
is more valuable filled in from actual mistakes than speculated in advance.
