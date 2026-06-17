# Verdict Vocabulary

All verdicts for all agents. The orchestrator reads `<task-notification>` XML and parses `<verdict>` and `<pipeline-gate>` to decide whether to advance, retry, or escalate.

---

## Verdict table

| Agent | Verdicts | Pipeline gate values |
|---|---|---|
| `memory-manager` | `LOADED` · `SAVED` · `UPDATED` · `QUERIED` · `SCAFFOLDED` | `PASS` |
| `secret-scanner` | `CLEAN` · `ESCALATION` | `PASS` · `ESCALATE` |
| `planner` | `PLAN_READY` · `DECISION_NEEDED` | `PASS` · `BLOCK` |
| `developer` | `IMPLEMENTED` · `GATE_FAIL` | `PASS` · `BLOCK` |
| `test-writer` | `TESTS_PASS` · `COVERAGE_MISS` · `TEST_FAIL` | `PASS` · `BLOCK` |
| `refactorer` | `REFACTORED` · `NO_TESTS` · `REGRESSION` | `PASS` · `BLOCK` |
| `code-reviewer` | `CLEAN` · `MAJOR_ONLY` · `CRITICAL_BLOCK` | `PASS` · `BLOCK` · `ESCALATE` |
| `security-reviewer` | `CLEAN` · `HIGH_BLOCK` · `CRITICAL_BLOCK` · `SECRET_FOUND` | `PASS` · `BLOCK` · `ESCALATE` |
| `dependency-auditor` | `CLEAN` · `HYGIENE_FLAGS` · `HIGH_CVE` · `CRITICAL_CVE` | `PASS` · `BLOCK` |
| `verifier` | `VERIFIED` · `SPEC_VIOLATION` · `BLOCKED` | `PASS` · `BLOCK` |
| `debugger` | `ROOT_CAUSE_FOUND` · `INCONCLUSIVE` | `PASS` · `BLOCK` |
| `docs-writer` | `DOCS_UPDATED` · `EXAMPLE_FAIL` | `PASS` · `BLOCK` |
| `changelog-writer` | `CHANGELOG_UPDATED` · `NO_CHANGES` · `BLOCKED` | `PASS` |
| `git-assistant` | `PR_CREATED` · `PREFLIGHT_FAIL` | `PASS` · `BLOCK` |

---

## Gate rules (orchestrator logic)

| Verdict | Gate | Orchestrator action |
|---|---|---|
| Any `ESCALATION` or `SECRET_FOUND` | `ESCALATE` | Stop pipeline. Zero retries. Human must resolve. |
| `CRITICAL_BLOCK` (code-reviewer) | `BLOCK` | Return to developer with Critical findings. Retry ≤ 1. |
| `CRITICAL_BLOCK` / `HIGH_BLOCK` (security-reviewer) | `BLOCK` | Escalate to human if fix is non-obvious. |
| `SPEC_VIOLATION` (verifier) | `BLOCK` | Return to developer with fix instructions. Retry ≤ 1. |
| `CRITICAL_CVE` (dependency-auditor) | `BLOCK` | Block release pipeline only (report-only on feature pipeline). |
| `DECISION_NEEDED` (planner) | `BLOCK` | Stop. Human must answer decision before continuing. |
| `NO_TESTS` (refactorer) | `BLOCK` | Stop. Run test-writer first. Not a retry situation. |
| Any agent `BLOCKED` after 1 retry | `ESCALATE` | Stop pipeline. Report attempt history to human. |
| Absent or malformed `<task-notification>` | `BLOCK` | Treat as BLOCK. Never assume PASS on missing data. |

---

## `<task-notification>` XML format

```xml
<task-notification>
  <agent>code-reviewer</agent>
  <status>done</status>
  <verdict>CRITICAL_BLOCK</verdict>
  <effort-mode>medium</effort-mode>          <!-- code-reviewer only -->
  <finding-count total="2" critical="1" major="1" minor="0"/>
  <blocking>true</blocking>
  <escalation-required>false</escalation-required>
  <artifacts>
    <artifact>Pass A (spec): PASS</artifact>
    <artifact>Pass B (quality): 2 findings</artifact>
  </artifacts>
  <summary>1 Critical: SQL injection at handler.go:88. 1 Major: missing nil check at cache.go:42.</summary>
  <pipeline-gate>BLOCK</pipeline-gate>
</task-notification>
```
