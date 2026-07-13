---
name: spec-verify
description: Checks a spec's implementation against its Acceptance Criteria and Verification step, then moves passing specs from waiting_verification to finished in spec.db. Use whenever the user asks to verify, check, confirm, or sign off on a spec — phrases like "verify 0001", "check if the specs are done", "did that implementation actually meet the criteria", "confirm 0003 and 0004 are good to ship", "is the waiting_verification stuff ready", or "sign off on the ready ones". Does not apply to implementing a spec that hasn't been built yet (use spec-exec for that) or to designing a spec that doesn't exist yet (use spec-plan) — see the skill body for the full boundary.
---

# Spec Verification

This skill runs the confirmation half of this repo's spec-driven workflow: a spec sitting in
`waiting_verification` gets checked against its own `Acceptance Criteria` and `Verification`
sections, and only moves to `finished` if every check actually passes. Specs live in the
SQLite system of record (`spec.db`, via `scripts/spec-db.mjs`) — every read, every attempt
record, and every lifecycle move below goes through that CLI. The spec is the source of
truth for what "done" means here too — verification checks the code against what the spec
says, not against what the implementation happened to do.

**When this applies:** any request to verify, check, confirm, or sign off on specs that
already have an implementation sitting in `waiting_verification` — including proactively,
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

## Phase 1 — Discover specs

List specs awaiting verification:
```bash
node scripts/spec-db.mjs list <project> waiting_verification
```

For each, `node scripts/spec-db.mjs show <project> <id>` gives:
- `id` — zero-padded 4-digit string (e.g. `0001`)
- `title` — short imperative title
- `status` — should be `waiting_verification`
- `attempts` — how many times this spec has already failed verification (the
  `verify_attempts` counter; `record-attempt` maintains it)
- the full body, from which to extract:
  - `Acceptance Criteria` — the EARS-style behavioral sentences that must hold
  - `Verification` — the concrete end-to-end check defined at authoring time

If nothing is waiting, report "No specs are waiting verification." and stop.

## Phase 2 — Determine which specs to verify

- **User didn't name specific IDs**: present the discovered specs and ask which to verify —
  show each as `{id} — {title}`, and offer "all waiting specs" as an option.
- **User said "all"**: select every discovered spec.
- **User named specific IDs** (e.g. "0001 and 0003"): select only those. If any named ID
  isn't in `waiting_verification`, stop and report the missing ID rather than silently
  skipping it.

## Phase 3 — Verify each spec

For each selected spec, work through the following checks in order. Collect results before
moving any specs.

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

**3c-2. Run the project's own gates (regression check)**

A spec's Verification step proves its *own* behavior; it says nothing about what the
implementation broke elsewhere. So after 3c, also run the target project's standing
gates — whatever that project already defines as its full check suite (for this harness
itself: the `check` target in the `Makefile` plus the npm test suite; for a nested project
under `projects/<n>/`, that project's own equivalent — its declared test/lint/build
commands, discoverable from its Makefile, package manifest, or README). Record the result
as one more PASS/FAIL line in this spec's report and trace, labeled `Regression gate`.

**A spec whose own Verification passes but whose project gates fail is a FAIL** — same
retry contract as any criterion failure. Improving one thing while silently breaking others
is the outcome verification exists to catch; Meta-Harness's outer loop evaluates every
candidate on the full benchmark rather than only its target capability for exactly this
reason.

Two scoping notes: run the gates once per verification session when verifying multiple
specs against the same working tree, not once per spec — attribute a gate failure to the
spec(s) whose touched files plausibly caused it, and say so in each affected report. And if
a project defines no gates at all, note that in the report and move on — absence of gates
is a gap worth flagging, not a verification failure.

**3d. Capture the verification trace**

Before reporting, write the *raw* record of this verification run to a scratch file (e.g.
under `/tmp/`), then record it into the DB:

```bash
node scripts/spec-db.mjs record-attempt <project> <id> <PASS|FAIL> <trace-file>
```

`record-attempt` stores the full trace as this run's attempt row and, on FAIL, increments
the spec's `verify_attempts` counter — the counter and the trace land in one step; never
edit the counter by hand. Record the attempt whether the run passes or fails, so a passing
first run is `attempt-1`. Traces are queryable afterward with
`node scripts/spec-db.mjs trace <project> <id> [n]` (and `trace diff` between attempts).

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

## Regression gate
$ <exact gate commands run>
<full output, same truncation rule; or "no gates defined for this project">
```

Keep it factual and raw — this record exists so the fix loop can read what actually
happened, not a second summary of it. For a manual/human-confirmed verification step,
record the check described and the human's confirmation in place of command output.
Recording the trace never blocks the verdict: if `record-attempt` fails, note it in the
report and continue.

## Phase 4 — Report results

After checking all selected specs, print a summary table:

```
Spec 0001 — <title>
  [PASS] Criterion 1: <criterion text>
  [FAIL] Criterion 2: <criterion text>
         Reason: <what was missing or wrong>
  [PASS] Verification: <command output>
  [PASS] Regression gate: <project gates run, or "no gates defined">

Overall: PASS / FAIL
```

## Phase 5 — Move passing specs to finished

For every spec where **all** criteria and the verification step passed:

If the body has a `## Verification Failures` section from an earlier failed attempt, remove
it — a shipped spec shouldn't carry stale failure history in its body. Fetch the current
body, strip the section, and write it back:

```bash
node scripts/spec-db.mjs show <project> <id>        # body is everything after the --- line
# edit the body in a scratch file, removing the ## Verification Failures section
node scripts/spec-db.mjs edit <project> <id> body <scratch-file>
```

The raw failure history stays queryable regardless — attempt rows (and their traces) are
never deleted; `trace <project> <id> <n>` reaches every past attempt. That permanence is
why the body section can be cleared on success without losing the record.

If the spec's `pr` field is non-empty, confirm the PR's state with
`gh pr view <url> --json state` and include it in the report — advisory only, never a FAIL:
merging is a human action that may legitimately still be pending, and `gh` may be missing or
unauthenticated (note which, and move on). A finished spec whose `pr` field is *empty* will
be flagged by `spec-db.mjs check` — backfill it from the implementation report
(`spec-db.mjs set <project> <id> pr <url>`) before the move.

```bash
node scripts/spec-db.mjs move <project> <id> finished spec-verify   # gates + auto-ledgers
```

The `move` records the transition and appended the outcome to the ledger (terminal states
auto-ledger); confirm with `node scripts/spec-db.mjs ledger <project> finished` if needed.

Report: `Spec {id} — {title}: verified and moved to finished.`

## Phase 6 — Handle failing specs

For every spec where **any** criterion or the verification step failed, follow the retry
contract in "State Transitions" → "Retry contract" in `specs/README.md` — this is the
canonical description; the steps below are just this skill's execution of it.

**6a. Record the failure**

1. The Phase 3d `record-attempt ... FAIL` already incremented `verify_attempts` and stored
   the trace — read the new count back from `show` if you don't have it.
2. Write a `## Verification Failures` section into the spec body (append it if absent,
   otherwise replace the existing one — don't accumulate failure history across attempts,
   the current attempt's list is what matters). Same fetch-edit-write flow as Phase 5:
   `show` → edit scratch file → `edit <project> <id> body <scratch-file>`. Format:
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
   output behind each failed line lives in the attempt trace
   (`spec-db.mjs trace <project> <id>`), which the fix loop reads alongside this list.
   Point at the trace rather than pasting its output here.
3. Record a distilled lessons entry in the DB (conventions per `memory/README.md`,
   provenance tag in the heading required):
   `node scripts/spec-db.mjs memory add lessons "<date> — <title> (spec <id>)" "<body>" <id>`
   — not a copy of the failure list, but the transferable part — what class of mistake this
   was and what a future spec or implementation should do differently. If the failure is
   purely local (a typo-grade miss with nothing transferable), a one-line entry is still
   written; deciding it teaches nothing is itself worth recording once.

**6b. Stay in place, or escalate to blocked**

`MAX_VERIFY_ATTEMPTS = 2` (defined in `specs/README.md`, don't hardcode a different number
here — if it ever changes, that's the one place to change it).

- **If `verify_attempts < MAX_VERIFY_ATTEMPTS`:** leave the spec in
  `waiting_verification` — no move, status unchanged. The failures section and trace are
  in the DB; the fix loop reads them from there.
  Report: `Spec {id} — {title}: verification FAILED (attempt {verify_attempts} of
  {MAX_VERIFY_ATTEMPTS}) — see above for details. Ask spec-exec to fix and resubmit.`

- **If `verify_attempts >= MAX_VERIFY_ATTEMPTS`:** move the spec to `blocked` instead of
  leaving it to fail silently forever:
  ```bash
  node scripts/spec-db.mjs move <project> <id> blocked spec-verify   # gates + auto-ledgers
  ```
  The `move` records the transition and appended the blocked outcome to the ledger, so a
  later planning pass can see this was tried and blocked (`node scripts/spec-db.mjs ledger
  <project> blocked`). The escalation report is what reaches the human.
  Report clearly, as an escalation rather than a routine failure:
  `Spec {id} — {title}: verification failed {verify_attempts} times — moved to blocked.
  This needs human review before another attempt; see specs/README.md's "Un-blocking a spec"
  for how to bring it back.`

  A blocked spec always gets a lessons entry via `memory add` (in addition to the failure-time
  entry from 6a): escalations are exactly the events the notebook exists for.

**6c. Passing specs and memory (optional, not routine)**

A pass that revealed something durable — a verification technique worth reusing, a criterion
pattern that made checking easy or hard — may also get a lessons entry via `memory add`. Routine
passes don't; a notebook padded with "it worked" entries stops being read.

Do not auto-retry within the same run — one verify pass per spec per invocation, same as a
passing spec only moves once.

## Quick reference

| Request | Behavior |
|---|---|
| "verify the specs" / "check what's waiting" | Resolves the project (asking if ambiguous), lists waiting specs, asks which to verify |
| "verify all specs in template" | Verify every `waiting_verification` spec in project `template` |
| "verify 0001 and 0003 in template" | Verify only those two specs |
| "is the template stuff ready to ship" | Same as "verify the specs", scoped to `template` |
| (a spec fails verification a 2nd time) | Moved to `blocked` automatically — not a request the user makes, but the resulting behavior |

## Gotchas

- A spec's `verify_attempts` only increments on an actual failed verification run
  (`record-attempt ... FAIL`) — re-running `spec-verify` against a spec that already passed
  (and is `finished`) is a no-op, not a fresh attempt; this skill only ever looks at
  `waiting_verification`.
- Don't forget to strip the `## Verification Failures` section on a passing run (Phase 5) —
  leaving it in a `finished` spec's body makes its last-known state look like it's still
  failing, which is confusing for anyone reading it later without checking the attempt
  history.
