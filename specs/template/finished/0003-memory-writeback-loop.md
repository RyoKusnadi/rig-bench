---
id: "0003"
title: Wire the memory write-back loop into spec-verify and spec-plan
status: finished
depends_on: ["0002"]
verify_attempts: 0
source: improvement-plan.md#phase-3
---
## Problem

Spec 0002 created the memory notebooks, but nothing writes to or reads from them as part of
the lifecycle — memory that depends on someone remembering to use it isn't memory. The
valuable half of the system is the loop: verification failures become lessons, and planning
consults them.

## Acceptance Criteria

- When a spec fails verification or is moved to `blocked/`, the `spec-verify` skill shall
  instruct appending a distilled entry to `memory/lessons.md` in the entry format defined
  by `memory/README.md`.
- When a verification pass reveals something durable beyond the pass itself, the
  `spec-verify` skill shall permit (not require) a memory entry, so routine passes don't
  generate noise.
- Before drafting, the `spec-plan` skill shall instruct consulting `memory/` (grep or read)
  alongside the existing Non-negotiables check, and folding relevant hits into the spec's
  Implementation Notes.
- The `memory/README.md` shall document this loop so the convention is discoverable from
  the memory side as well as the skill side.

## Out of Scope

- Automating the writes with hooks or scripts — the loop lives in skill prose, consistent
  with what has survived in this repo (prose-in-skills) versus what has died twice
  (code coupled to unsettled designs).
- Touching `spec-exec` — execution consumes the spec, which planning has already enriched.

## Files/Interfaces Touched

- `.claude/skills/spec-verify/SKILL.md`
- `.claude/skills/spec-plan/SKILL.md`
- `memory/README.md`

## Implementation Notes

Keep the additions small and placed where the action already happens: the lessons write
belongs in spec-verify's Phase 6 (failure recording) and the blocked-escalation branch; the
read belongs in spec-plan next to the existing Non-negotiables check, which is already the
"consult repo-level constraints" moment. Entries must carry the provenance tag; the skill
text should say so rather than restating the whole format.

## Verification

`grep -n "memory/lessons.md" .claude/skills/spec-verify/SKILL.md` matches in Phase 6;
`grep -n "memory/" .claude/skills/spec-plan/SKILL.md` matches near the Non-negotiables
check; `memory/README.md` contains a section describing the loop;
`scripts/check-specs.sh template` passes.
