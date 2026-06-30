---
id: "0015"
title: Time-decay LEGACY tagging for git history search
status: waiting_verification
depends_on: ["0007"]
source: memory.md#deliverable-43-time-decay-for-git-history
---
## Problem

The git history index may contain commits from years ago that used APIs or patterns no longer valid. The operator agent could confidently implement deprecated approaches if these results appear untagged.

## Acceptance Criteria

- `scripts/bootstrap-git-history.sh` shall include a `commit_date` field (ISO date string `YYYY-MM-DD`) for each commit entry in `memory/archive/git/index.json`.
- `scripts/search-git-history.sh` shall tag entries where `commit_date` is older than 6 months from the current date with `[LEGACY]` appended to the message in output.
- The operator agent definition (`.claude/agents/operator.md`) shall include an instruction in the `## Memory Tools` section: "Never use code patterns from commits tagged `[LEGACY]` — they use outdated APIs or frameworks."
- The `scripts/search-git-history.sh` output shall visually distinguish legacy vs. recent commits (e.g., prefix `[LEGACY]` at the start of the commit line).

## Out of Scope

Major-version-bump detection in package manifests (too complex for current scope; date-based decay is sufficient). Automatic re-tagging when the 6-month threshold rolls over (re-running bootstrap is sufficient).

## Files/Interfaces Touched

- `scripts/bootstrap-git-history.sh` (add `commit_date` extraction)
- `scripts/search-git-history.sh` (add LEGACY tagging in output)
- `.claude/agents/operator.md` (update `## Memory Tools` section with LEGACY instruction)

## Implementation Notes

In `bootstrap-git-history.sh`, change the `git log` format to include `%cd` (committer date) with `--date=format:'%Y-%m-%d'`. Extract and include as `commit_date` in each JSON entry.

In `search-git-history.sh`, after filtering matches, compute today's date minus 6 months as a cutoff string (use `date -d '6 months ago' +%Y-%m-%d` on Linux or `date -v-6m +%Y-%m-%d` on macOS — detect platform). For each result entry, if `commit_date < cutoff`, prefix the output line with `[LEGACY]`.

## Verification

```bash
# Re-run bootstrap to get commit_date field
bash scripts/bootstrap-git-history.sh

# Verify commit_date field present
node -e "
  const data = JSON.parse(require('fs').readFileSync('memory/archive/git/index.json','utf8'));
  if (!data[0].commit_date) throw new Error('commit_date field missing');
  if (!/\d{4}-\d{2}-\d{2}/.test(data[0].commit_date)) throw new Error('commit_date not ISO format: ' + data[0].commit_date);
  console.log('PASS — commit_date: ' + data[0].commit_date);
"

# Search and verify LEGACY tagging appears (any commit older than 6 months)
bash scripts/search-git-history.sh "feat" | head -20

# Operator docs updated
grep -q "LEGACY" .claude/agents/operator.md && echo "PASS: LEGACY instruction in operator docs" || echo "FAIL"
```
