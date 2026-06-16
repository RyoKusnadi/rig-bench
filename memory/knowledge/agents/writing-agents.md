# Writing a New Agent

How to create a new agent for this harness. Follow this guide to match the established patterns.

---

## File location

```
agents/<agent-name>/<agent-name>.md
```

One `.md` file per agent. The directory name, the file name, and the `name:` frontmatter field must all match exactly.

---

## Frontmatter (full schema)

```yaml
---
name: agent-name                    # kebab-case, matches directory and filename
description: |
  One-line summary of what this agent does and when to use it.

  <example>
  Context: <situation that triggers this agent>
  user: "<example user message>"
  assistant: "<how Claude should respond>"
  <uses agent-name agent>
  </example>

  <example>
  Context: <second situation>
  user: "<second user message>"
  assistant: "<response>"
  <uses agent-name agent>
  </example>
tools: Read, Bash, Grep, Glob      # only what's needed — list is enforced at runtime
disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]  # for read-only agents
model: claude-sonnet-4-6           # haiku for speed, sonnet for most, opus for deep analysis
color: blue                        # terminal display color only
permission_mode: semi-auto         # auto | semi-auto | manual
whenToUse:
  - "short phrase for auto-routing (2–5 items)"
  - "another trigger phrase"
---
```

See `agents/SCHEMA.md` for the full field reference.

---

## System prompt structure

```markdown
You are the **[role title]**. [One sentence on what you do and what you don't do.]

---

## Step 0 — Branch safety check (for agents that write files)

[Paste the standard branch safety block if this agent mutates source files]

---

## Step 1 — [First step]

[Numbered steps with specific instructions. Use code blocks for commands.]

---

## [Additional steps...]

---

## Output format

[The format the agent produces — tables, code blocks, report structure.]

---

## Hard rules

1. **[Most important constraint]**
2. **Never spawn sub-agents.**
3. **Never push to a remote** — route all push actions to git-assistant.

---

## Output — Completion signal

[task-notification XML block — see verdict vocabulary]

## HANDOFF

[HANDOFF YAML block]
```

---

## Key patterns

### Read-only agents

Agents that never modify files (planner, verifier, debugger, security-reviewer, dependency-auditor, secret-scanner, knowledge-base, memory-manager):

1. Add `disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]` to frontmatter
2. Add an `OPERATION CONSTRAINTS — READ-ONLY AGENT` prose block after the intro
3. `permission_mode: auto` (no file mutations = no confirmation needed)

### Branch-safety-first agents

Agents that write source files (developer, test-writer, refactorer, docs-writer, changelog-writer):

Add Step 0 with this block:

```bash
DEFAULT=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
DEFAULT=${DEFAULT:-main}
CURRENT=$(git branch --show-current)
if [ "$CURRENT" = "$DEFAULT" ]; then
  echo "BLOCKED: On default branch '$DEFAULT'. Create a feature branch first."
  exit 1
fi
```

### task-notification + HANDOFF

Every agent must end with both blocks. See `knowledge/agents/verdict-vocabulary.md` for valid verdicts.

```xml
<task-notification>
  <agent>your-agent-name</agent>
  <status>done</status>
  <verdict>YOUR_VERDICT</verdict>
  <finding-count total="0"/>
  <blocking>false</blocking>
  <artifacts><artifact>...</artifact></artifacts>
  <summary>One sentence.</summary>
  <pipeline-gate>PASS</pipeline-gate>
</task-notification>
```

```yaml
agent: your-agent-name
status: COMPLETE
task_id: "<provided by orchestrator>"
artifacts: []
findings: []
retry_count: 0
next_inputs: {}
```

---

## Checklist for a new agent

- [ ] File at `agents/<name>/<name>.md`
- [ ] Frontmatter: `name`, `description` (with 2–3 `<example>` blocks), `tools`, `model`, `color`, `permission_mode`, `whenToUse`
- [ ] Read-only? Add `disallowedTools` + OPERATION CONSTRAINTS prose block
- [ ] Writes files? Add branch safety check in Step 0
- [ ] Hard rules include "Never spawn sub-agents" and "Never push to a remote"
- [ ] `<task-notification>` XML block at end with defined verdicts
- [ ] `## HANDOFF` YAML block at end
- [ ] Added to orchestrator's agent registry table
- [ ] Added to `agents/README.md` agent table and detail section
- [ ] Added to `knowledge/agents/verdict-vocabulary.md`
- [ ] `TODO.md` updated
