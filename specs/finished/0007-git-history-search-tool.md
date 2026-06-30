---
id: "0007"
title: Git history search tool for operator agent
status: finished
depends_on: ["0002"]
source: memory.md#deliverable-21-git-history-search-tool
---
## Problem

When implementing a feature, the operator agent benefits from seeing how similar work was done in past commits. Without a search tool, it would need to call `git log` from scratch each time, which is slow and returns unstructured output.

## Acceptance Criteria

- `scripts/search-git-history.sh` shall be an executable shell script accepting a single query string argument.
- When called as `bash scripts/search-git-history.sh <query>`, it shall search `memory/archive/git/index.json` for matches in commit messages and file lists.
- The tool shall return the top 5 matching commits, formatted as human-readable text.
- Each result shall show: commit SHA (short form, first 8 chars), commit message, and files changed.
- If `memory/archive/git/index.json` does not exist or is an empty array, the script shall print a clear message ("No git history indexed yet — run scripts/bootstrap-git-history.sh first") and exit 1.
- The operator agent definition (`.claude/agents/operator.md`) shall document the `search_git_history` tool in the `## Memory Tools` section.

## Out of Scope

Full-text diff search (this searches the index only, not actual diff content). LEGACY tagging (that is spec 0013).

## Files/Interfaces Touched

- `scripts/search-git-history.sh` (new)
- `.claude/agents/operator.md` (update `## Memory Tools` section)

## Implementation Notes

Use `node -e` inline in the shell script to load `memory/archive/git/index.json`, filter entries where `message` or `files` contains the query (case-insensitive), take the first 5, and format output. In `operator.md`, append the `search_git_history` tool entry to the existing `## Memory Tools` section (added by spec 0005).

## Verification

```bash
# Run the bootstrap first so there's data
bash scripts/bootstrap-git-history.sh

# Test the search
bash scripts/search-git-history.sh "feat" && echo "PASS: exit 0" || echo "FAIL"

# Verify output contains commit info
bash scripts/search-git-history.sh "fix" | grep -q "[0-9a-f]\{7,\}" && echo "PASS: SHA found in output" || echo "FAIL: no SHA in output"

# Test missing index error
mv memory/archive/git/index.json memory/archive/git/index.json.bak
bash scripts/search-git-history.sh "test" 2>&1 | grep -qi "bootstrap\|not found\|run" && echo "PASS: helpful error shown" || echo "FAIL"
mv memory/archive/git/index.json.bak memory/archive/git/index.json

# Operator docs updated
grep -q "search_git_history\|search-git-history" .claude/agents/operator.md && echo "PASS: doc added" || echo "FAIL"
```
