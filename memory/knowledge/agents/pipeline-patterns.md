# Pipeline Patterns

The 6 built-in pipelines and quality gate rules. Reference for orchestrator and workflow scripts.

---

## New feature

```
memory-load → secret-scanner → planner → developer → test-writer
           → code-reviewer → security-reviewer → verifier → git-assistant → memory-save
```

**Gate rules:**
- `secret-scanner ESCALATION` → pipeline blocked, zero retries
- `planner DECISION_NEEDED` → human decision required before continuing
- `code-reviewer CRITICAL_BLOCK` → return to developer, fix Criticals, retry ≤ 2
- `security-reviewer SECRET_FOUND` → pipeline blocked, zero retries
- `security-reviewer CRITICAL_BLOCK/HIGH_BLOCK` → escalate to human
- `verifier SPEC_VIOLATION` → return to developer with fix instructions, retry ≤ 2
- Any stage > 2 retries → escalate to human

---

## Bug fix

```
memory-load → [debugger] → developer → test-writer → verifier → git-assistant → memory-save
```

`[debugger]` is skipped when `known_cause=true` is passed.

**Gate rules:**
- `debugger INCONCLUSIVE` → escalate to human (cannot fix unknown root cause)
- `verifier SPEC_VIOLATION` → return to developer, retry ≤ 2

---

## Refactor

```
refactorer → code-reviewer → verifier → git-assistant
```

**Gate rules:**
- `refactorer NO_TESTS` → block, run test-writer first (not a retry)
- `refactorer REGRESSION` → escalate to human
- `code-reviewer CRITICAL_BLOCK` → return to refactorer, retry ≤ 2

---

## PR quality review

```
secret-scanner → [code-reviewer + security-reviewer + dependency-auditor in parallel] → synthesize
```

Three review agents run concurrently. Orchestrator merges findings and deduplicates before reporting.

**Gate rules:**
- `secret-scanner ESCALATION` → stop before parallel review starts
- `security-reviewer SECRET_FOUND` → stop after parallel review, escalate
- Any `CRITICAL` finding → report to PR author; pipeline does not auto-block (it's a review, not a delivery pipeline)

---

## Docs update

```
docs-writer → git-assistant
```

**Gate rules:**
- `docs-writer EXAMPLE_FAIL` → block, fix broken examples before creating PR

---

## Release prep

```
secret-scanner → dependency-auditor → changelog-writer → git-assistant (release mode)
```

**Gate rules:**
- `secret-scanner ESCALATION` → release blocked
- `dependency-auditor CRITICAL_CVE` → release blocked (fix CVE first)
- `dependency-auditor HYGIENE_FLAGS` → noted, not blocking

---

## Retry and escalation

| Situation | Max retries | Action after max |
|---|---|---|
| Gate failure (BLOCK) | 2 | Escalate to human with full attempt history |
| Secret escalation | 0 | Immediate human escalation, zero retries |
| INCONCLUSIVE / NO_TESTS | 0 | Not a retry situation — escalate or reorder |

**Escalation report must include:**
- Pipeline name and current stage
- Attempt history (verdict + what fix was applied per attempt)
- Verbatim list of remaining blocking findings with `file:line`
- `human-action-required` classification

---

## Parallel safety rule

Parallel stages are only safe when outputs are independent:
- ✅ code-reviewer + security-reviewer + dependency-auditor (each reads the same code, writes nothing)
- ❌ developer + test-writer (test-writer reads what developer writes — must be sequential)
