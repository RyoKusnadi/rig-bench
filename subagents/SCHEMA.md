# Agent Frontmatter Schema

Every agent file begins with a YAML frontmatter block (between `---` delimiters). This document defines every field, its type, allowed values, and whether it is mandatory, optional, or planned for a future roadmap item.

---

## Field reference

| Field | Type | Status | Description |
|---|---|---|---|
| `name` | string | **Mandatory** | Kebab-case identifier. Must match the directory name. Used for routing and display. |
| `description` | string (multi-line) | **Mandatory** | Plain-text description with `<example>` blocks for auto-invocation routing. |
| `tools` | list of strings | **Mandatory** | Tools this agent is explicitly allowed to call. Claude Code enforces this at runtime. |
| `disallowedTools` | list of strings | **Optional** | Tools this agent is explicitly blocked from calling. Dual enforcement with the OPERATION CONSTRAINTS prose block. |
| `model` | string | **Mandatory** | Model ID string. Use the most capable model appropriate for the agent's workload. |
| `color` | string | **Optional** | Terminal display color. No functional effect — purely cosmetic for pipeline readability. |
| `permission_mode` | string | **Mandatory** | Determines how tool calls are approved. See allowed values below. |
| `whenToUse` | list of strings | **Mandatory** | Short phrases describing when to invoke this agent. Powers auto-routing. |
| `isolation` | string | **Roadmap** | Set to `worktree` to run the agent in an isolated git worktree. Not currently used. |

---

## Field details

### `name`

```yaml
name: inspector
```

- Lowercase kebab-case only
- Must exactly match the directory name and the filename (e.g., agent at `subagents/inspector/inspector.md` → `name: inspector`)
- Used in `<task-notification>` XML, HANDOFF YAML, and calling-workflow pipeline logs

---

### `description`

```yaml
description: |
  One-line summary of what the agent does and when to use it.

  <example>
  Context: <short situation description>
  user: "<example user message>"
  assistant: "<how Claude should respond>"
  <uses agent-name agent>
  </example>
```

- Include 2–3 `<example>` blocks for Claude Code's auto-invocation routing
- The `<example>` format triggers the agent when user messages match the pattern
- The `context:` line is optional but helps with disambiguation

---

### `tools`

```yaml
tools: Read, Bash, Grep, Glob, WebFetch
```

Available tools (alphabetical):

| Tool | Purpose |
|---|---|
| `Bash` | Shell command execution |
| `Edit` | File editing (patch) |
| `Glob` | File pattern matching |
| `Grep` | Pattern search |
| `MultiEdit` | Multi-file editing |
| `NotebookEdit` | Jupyter notebook editing |
| `Read` | File reading |
| `WebFetch` | HTTP fetch (external URLs) |
| `WebSearch` | Web search |
| `Write` | File creation / overwrite |
| `mcp__ide__getDiagnostics` | IDE LSP diagnostics |

Read-only agents should list only: `Read, Bash, Grep, Glob` (and `WebFetch` for metadata lookups).

---

### `disallowedTools`

```yaml
disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]
```

- Applied as a runtime block by Claude Code
- **Dual enforcement pattern**: always pair with an OPERATION CONSTRAINTS prose block in the agent body for model-layer enforcement
- Read-only agents should always include this field

---

### `model`

```yaml
model: claude-sonnet-4-6
```

Allowed model IDs:

| Model | ID | When to use |
|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | Fast, low-cost passes — simple grep-only agents |
| Sonnet 4.6 | `claude-sonnet-4-6` | Default for both `operator` and `inspector` — good balance of speed and capability |
| Opus 4.8 | `claude-opus-4-8` | Complex reasoning, architectural analysis, maximum effort reviews |

Default to `claude-sonnet-4-6` unless there is a clear reason to use a different tier.

---

### `color`

```yaml
color: blue
```

Used for terminal display only. Suggested per-agent colors for visual differentiation:

| Agent | Color |
|---|---|
| `operator` | `blue` |
| `inspector` | `red` |

---

### `permission_mode`

```yaml
permission_mode: semi-auto
```

| Value | Meaning | Use for |
|---|---|---|
| `auto` | All tool calls proceed without user confirmation | Read-only, low-risk agents |
| `semi-auto` | Low-risk tools auto-approved; file mutations and Bash need approval | `inspector` — read-only, but Bash needs approval |
| `manual` | Every tool call requires explicit user approval | `operator` — writes code and pushes to git |

---

### `whenToUse`

```yaml
whenToUse:
  - "implement a feature or bug fix"
  - "after planning is done and requirements are clear"
  - "TDD cycle needed"
```

- Short imperative phrases (under 12 words each)
- 2–5 entries per agent
- Powers Claude Code's auto-routing: when user input matches these phrases, Claude suggests the agent

---

### `isolation` (Roadmap)

```yaml
isolation: worktree  # NOT YET IMPLEMENTED
```

When set to `worktree`, the agent runs in an isolated git worktree — useful for parallel agents mutating files without conflicts. Not currently wired up in this harness; reserved for a future Phase 2 item.

---

## Complete example

```yaml
---
name: example-agent
description: |
  One-sentence description of what this agent does and when to use it.

  <example>
  Context: Developer finished implementing a feature.
  user: "Review my changes before I commit"
  assistant: "I'll use the example-agent to check your changes."
  <uses example-agent agent>
  </example>

  <example>
  Context: Orchestrator dispatching this agent.
  assistant: "Running example-agent as stage N of the pipeline."
  <uses example-agent agent>
  </example>
tools: Read, Bash, Grep, Glob
disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]
model: claude-sonnet-4-6
color: yellow
permission_mode: semi-auto
whenToUse:
  - "first use case for auto-routing"
  - "second use case"
  - "third use case"
---
```

---

## Enforcement layers for read-only agents

Read-only agents use **dual enforcement**:

1. **Runtime layer** — `disallowedTools` in frontmatter blocks the tool call at the Claude Code level
2. **Model layer** — `OPERATION CONSTRAINTS` prose block in the agent body instructs the model to refuse before attempting the call

Both layers are required. A frontmatter block without a prose constraint allows the model to "try and fail"; a prose constraint without a frontmatter block allows the runtime to be bypassed by an explicit instruction.

See `inspector.md` for the canonical OPERATION CONSTRAINTS block format — it's the only read-only agent in the current roster.

---

## Completion signal convention

Every agent must emit a `<task-notification>` XML block as the **last element** of every response, followed by a `## HANDOFF` YAML block. These enable the calling workflow to parse structured completion data without reading free-form text.

See any agent file for the canonical format for its verdict vocabulary.
