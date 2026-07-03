# Lessons

What verification failures, blocked specs, and postmortems taught. Entry format and pruning
convention: see `memory/README.md`.

## 2026-07-03 — Retry contract exercised end-to-end for the first time (spec 0001, PR #63–66)

Spec 0001 ran the full lifecycle including a controlled failed verification: attempt 1
failed two criteria, the `## Verification Failures` section was written per the spec-verify
Phase 6a format, spec-exec used that section as the authoritative fix list, and attempt 2
passed and moved the spec to `finished/` with the failure section stripped. Findings: the
contract works as written; `verify_attempts` surviving in the finished spec's frontmatter is
a useful permanent trace that the retry path ran; and the failure-section format was precise
enough to fix from without re-reading the original conversation — which is the property that
matters. This satisfies improvement-plan.md Phase 1's "run for real" gate.
