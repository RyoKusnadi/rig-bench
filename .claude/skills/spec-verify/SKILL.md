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

**Dispatched verification:** when verification is dispatched as a subagent (see
`spec-exec`'s "Concurrent dispatch" and `.claude/agents/spec-verifier.md`), the agent
follows this skill unchanged — dispatch changes who runs it, never the contract.

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
- `verify_attempts` — how many times this spec has already failed verification (default `0`
  if the field predates this being tracked; treat a missing field as `0`, don't error on it)

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

**3d. Capture the verification trace**

Before reporting, write the *raw* record of this verification run to
`specs/<project>/.traces/<id>/attempt-<N>.md`, where `<N>` is this run's attempt number —
`verify_attempts + 1` (the value it will hold if this run fails; use it whether the run
passes or fails so a passing first run is `attempt-1`). Create the directory if needed.

The trace is the raw complement to the compressed `## Verification Failures` summary: the
Meta-Harness result this repo borrows from is that an implementer fed raw execution traces
fixes far more than one fed only a distilled summary, and the summary cannot recover the
dropped signal. So capture what the summary drops — the actual commands and their *full*
output, not a paraphrase. Format:

```
# Verification trace — spec <id>, attempt <N>

Run: <UTC timestamp>
Overall: PASS | FAIL

## Criteria
- [PASS] <criterion text> — <file>:<line> that satisfies it
- [FAIL] <criterion text> — <what was missing or wrong>

## Verification step
$ <exact command run>
<full stdout/stderr, verbatim; truncate a single output past ~400 lines with a
 "... (truncated, M more lines)" marker rather than paraphrasing it>
```

Keep it factual and raw — this file exists so the fix loop can read what actually happened,
not a second summary of it. For a manual/human-confirmed verification step, record the
check described and the human's confirmation in place of command output. Writing the trace
never blocks the verdict: if the trace can't be written, note it in the report and continue.

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

If the file has a `## Verification Failures` section from an earlier failed attempt, remove
it — a shipped spec shouldn't carry stale failure history in the working tree; the git history
of the file is the permanent record of what failed before, per "Clearing the record on
success" in `specs/README.md`.

In the same clearing step, remove this spec's trace directory if present
(`git rm -r --quiet specs/<project>/.traces/<id>` when tracked, else `rm -rf`) — the traces
are the raw form of that same failure history and clear on success for the same reason; git
history keeps them. A spec that passes on its first attempt still wrote an `attempt-1` trace
in Phase 3d; remove it here too so `finished/` specs never carry a trace dir.

If the spec's `pr` frontmatter field is non-empty, confirm the PR's state with
`gh pr view <url> --json state` and include it in the report — advisory only, never a FAIL:
merging is a human action that may legitimately still be pending, and `gh` may be missing or
unauthenticated (note which, and move on). A finished spec whose `pr` field is *empty* while
the key exists will be flagged by `check-specs.sh` (spec 0012) — backfill it from the
implementation report before moving the file.

```bash
git mv specs/<project>/waiting_verification/<filename> specs/<project>/finished/<filename>
```

Update the `status` field in the spec frontmatter from `waiting_verification` to `finished`,
and append a `history` entry (`- finished $(date -u +%Y-%m-%dT%H:%M:%SZ)`) in the same step
(spec 0020; see the template's `history` note — same for the `blocked` move in Phase 6b).

Then commit:
```bash
git add -f specs/<project>/finished/<filename>
git commit -m "spec(<id>): mark <slug> as finished"
```

Report: `Spec {id} — {title}: verified and moved to finished.`

## Phase 6 — Handle failing specs

For every spec where **any** criterion or the verification step failed, follow the retry
contract in "State Transitions" → "Retry contract" in `specs/README.md` — this is the
canonical description; the steps below are just this skill's execution of it.

**6a. Record the failure**

1. Increment `verify_attempts` by 1 in the spec's frontmatter (treat a missing field as `0`
   before incrementing, so it becomes `1`).
2. Write a `## Verification Failures` section into the spec body (append it if absent,
   otherwise replace the existing one — don't accumulate failure history across attempts,
   the current attempt's list is what matters). Format:
   ```
   ## Verification Failures

   Attempt {verify_attempts} of {MAX_VERIFY_ATTEMPTS}.

   - Criterion: <criterion text>
     Reason: <what was missing or wrong>
   - Verification step: <what ran>
     Reason: <how the output didn't match>
   ```
   Only list what actually failed — passing criteria don't need an entry here (Phase 4's
   report already covers those). This section stays compressed on purpose; the raw command
   output behind each failed line lives in the Phase 3d trace at
   `specs/<project>/.traces/<id>/attempt-<verify_attempts>.md`, which the fix loop reads
   alongside this list. Point at the trace rather than pasting its output here.
3. Append a distilled entry to `memory/lessons.md` (format per `memory/README.md`, provenance
   tag required): not a copy of the failure list, but the transferable part — what class of
   mistake this was and what a future spec or implementation should do differently. If the
   failure is purely local (a typo-grade miss with nothing transferable), a one-line entry
   is still written; deciding it teaches nothing is itself worth recording once.

**6b. Stay in place, or escalate to blocked**

`MAX_VERIFY_ATTEMPTS = 2` (defined in `specs/README.md`, don't hardcode a different number
here — if it ever changes, that's the one place to change it).

- **If `verify_attempts < MAX_VERIFY_ATTEMPTS`:** leave the file in
  `specs/<project>/waiting_verification/` — do not move it, `status` unchanged. Commit the
  frontmatter/section update together with the Phase 3d trace:
  ```bash
  git add specs/<project>/waiting_verification/<filename> specs/<project>/.traces/<id>/
  git commit -m "spec(<id>): record verification failure, attempt <verify_attempts>/<MAX_VERIFY_ATTEMPTS>"
  ```
  Report: `Spec {id} — {title}: verification FAILED (attempt {verify_attempts} of
  {MAX_VERIFY_ATTEMPTS}) — see above for details. Ask spec-exec to fix and resubmit.`

- **If `verify_attempts >= MAX_VERIFY_ATTEMPTS`:** move the spec to `blocked/` instead of
  leaving it to fail silently forever:
  ```bash
  git mv specs/<project>/waiting_verification/<filename> specs/<project>/blocked/<filename>
  ```
  Update `status` to `blocked` in the frontmatter — appending the `history` entry
  (`- blocked <UTC timestamp>`) in the same step, per Phase 5 — then commit:
  ```bash
  git add -f specs/<project>/blocked/<filename>
  git commit -m "spec(<id>): block after <verify_attempts> failed verification attempts"
  ```
  Report clearly, as an escalation rather than a routine failure:
  `Spec {id} — {title}: verification failed {verify_attempts} times — moved to blocked/.
  This needs human review before another attempt; see specs/README.md's "Un-blocking a spec"
  for how to bring it back.`

  A blocked spec always gets a `memory/lessons.md` entry (in addition to the failure-time
  entry from 6a): escalations are exactly the events the notebook exists for.

**6c. Passing specs and memory (optional, not routine)**

A pass that revealed something durable — a verification technique worth reusing, a criterion
pattern that made checking easy or hard — may also get a `memory/lessons.md` entry. Routine
passes don't; a notebook padded with "it worked" entries stops being read.

Do not auto-retry within the same run — one verify pass per spec per invocation, same as a
passing spec only moves once.

## Quick reference

| Request | Behavior |
|---|---|
| "verify the specs" / "check what's waiting" | Resolves the project (asking if ambiguous), lists waiting specs, asks which to verify |
| "verify all specs in template" | Verify every spec in `specs/template/waiting_verification/` |
| "verify 0001 and 0003 in template" | Verify only those two specs |
| "is the template stuff ready to ship" | Same as "verify the specs", scoped to `template` |
| (a spec fails verification a 2nd time) | Moved to `specs/<project>/blocked/` automatically — not a request the user makes, but the resulting behavior |

## Gotchas

- A spec's `verify_attempts` only increments on an actual failed verification run — re-running
  `spec-verify` against a spec that already passed (and is sitting in `finished/`) is a no-op,
  not a fresh attempt; this skill only ever looks at `waiting_verification/`.
- Don't forget to strip the `## Verification Failures` section on a passing run (Phase 5) —
  leaving it in a `finished/` spec makes the file's last-known state look like it's still
  failing, which is confusing for anyone reading it later without checking git history.
