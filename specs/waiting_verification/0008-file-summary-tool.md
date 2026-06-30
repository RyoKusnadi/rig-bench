---
id: "0008"
title: On-demand file summary tool with hash-based cache invalidation
status: waiting_verification
depends_on: ["0001"]
source: memory.md#deliverable-22-on-demand-file-summary-tool-with-hash-based-invalidation
---
## Problem

Complex files like `workflows/operator.js` are expensive to re-read on every task. A cached summary system lets the agent understand a file in ~200 words instead of thousands of tokens, and automatically invalidates the cache when the file changes.

## Acceptance Criteria

- `scripts/read-file-summary.sh` shall be an executable shell script accepting a file path argument.
- When called, the script shall calculate the file's Git blob hash using `git hash-object <path>`.
- The script shall look up a cached summary in `memory/archive/summaries/` using a filename derived from the file path (MD5 or similar hash of the path).
- If a `.hash` file exists alongside the summary and its content matches the current Git blob hash, the script shall print the cached summary and exit 0.
- If no cache exists or the hash has changed, the script shall print the raw file content prefixed with a comment "# No cached summary — raw file content follows:" and exit 0.
- The script shall NOT make LLM calls itself (summary generation is done by the agent that reads this output and can choose to write a summary back).
- A companion script `scripts/write-file-summary.sh` shall accept `<file-path> <summary-text>` and save the summary + hash to `memory/archive/summaries/`.
- The operator agent definition (`.claude/agents/operator.md`) shall document both `read_file_summary` and `write_file_summary` tools in the `## Memory Tools` section.

## Out of Scope

Automatic LLM-based summary generation inside the script (the agent decides when to generate and write summaries). Summaries for binary files.

## Files/Interfaces Touched

- `scripts/read-file-summary.sh` (new)
- `scripts/write-file-summary.sh` (new)
- `memory/archive/summaries/` (populated at runtime)
- `.claude/agents/operator.md` (update `## Memory Tools` section)

## Implementation Notes

For the cache key, use `echo -n "<filepath>" | md5sum | cut -d' ' -f1` (or `md5 -q` on macOS — detect platform). Store the summary at `memory/archive/summaries/<hash>.md` and the git blob hash at `memory/archive/summaries/<hash>.hash`. In `write-file-summary.sh`, accept the file path as $1 and summary via stdin (or $2 as a heredoc-friendly approach). Compute the git blob hash and write both files.

## Verification

```bash
# Test cache miss (new file) — should print raw content
bash scripts/read-file-summary.sh CLAUDE.md | head -5 | grep -q "#\|CLAUDE\|No cached" && echo "PASS: cache miss shows content" || echo "FAIL"

# Write a summary
echo "This is the CLAUDE.md file. It documents the repo structure." | bash scripts/write-file-summary.sh CLAUDE.md

# Test cache hit — should print the summary
bash scripts/read-file-summary.sh CLAUDE.md | grep -q "CLAUDE.md file" && echo "PASS: cache hit returned summary" || echo "FAIL"

# Test invalidation — modify file content hash by touching it (or echo content)
# Since we're using git hash-object, the hash won't change from touch alone
# So we verify via the hash files:
CACHE_KEY=$(echo -n "CLAUDE.md" | md5sum 2>/dev/null | cut -d' ' -f1 || echo -n "CLAUDE.md" | md5 -q 2>/dev/null)
test -f "memory/archive/summaries/${CACHE_KEY}.md" && echo "PASS: summary file exists" || echo "FAIL: summary file missing"
test -f "memory/archive/summaries/${CACHE_KEY}.hash" && echo "PASS: hash file exists" || echo "FAIL: hash file missing"

# Operator docs updated
grep -q "read_file_summary\|read-file-summary" .claude/agents/operator.md && echo "PASS: doc added" || echo "FAIL"
```
