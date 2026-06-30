---
id: "0005"
title: Structural search tool for operator agent
status: finished
depends_on: ["0003"]
source: memory.md#deliverable-13-structural-search-tool
---
## Problem

The operator agent has no way to leverage the structural index. It needs a CLI tool it can call to find relevant files without blind ripgrep searches.

## Acceptance Criteria

- `scripts/search-structure.sh` shall be an executable shell script accepting a single query string argument.
- When called as `bash scripts/search-structure.sh <query>`, it shall search `memory/structure.json` for matches in file paths, exported symbol names, and import paths.
- The tool shall return the top 5 matching entries, formatted as human-readable text (not raw JSON).
- Each result shall show: file path, file type, exports list, and imports list.
- If `memory/structure.json` does not exist or is empty, the script shall print a clear error message and exit 1.
- The operator agent definition (`/.claude/agents/operator.md`) shall document the `search_structure` tool: its name, description ("Search the codebase structure to find files, functions, and dependencies"), input format, and example usage.

## Out of Scope

Fuzzy matching or semantic search. Simple case-insensitive substring match is sufficient.

## Files/Interfaces Touched

- `scripts/search-structure.sh` (new)
- `.claude/agents/operator.md` (append tool documentation section)

## Implementation Notes

Use `node -e` inline in the shell script to load and filter `memory/structure.json`. Filter entries where `path`, any `exports` element, or any `imports` element contains the query (case-insensitive). Take the first 5 matches. Format output with `console.log`. 

In `operator.md`, add a `## Memory Tools` section before `## Hard Rules` that documents each available tool with name, description, and usage example. The operator's system prompt already uses Bash — adding this section ensures future operators know to call `bash scripts/search-structure.sh <query>` when exploring the codebase.

## Verification

```bash
# Basic functionality
bash scripts/search-structure.sh "operator"

# Returns results (exit 0) when index exists
bash scripts/search-structure.sh "operator" && echo "PASS: exit 0" || echo "FAIL: non-zero exit"

# Errors when index missing
mv memory/structure.json memory/structure.json.bak
bash scripts/search-structure.sh "test" 2>&1 | grep -q "error\|not found\|does not exist" && echo "PASS: error message shown" || echo "FAIL"
mv memory/structure.json.bak memory/structure.json

# Operator agent docs updated
grep -q "search_structure\|search-structure" .claude/agents/operator.md && echo "PASS: doc added" || echo "FAIL: doc missing"
```
