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
| `model_tier` | string | **Mandatory** | One of `frontier` \| `standard` \| `economy`. Resolved to an actual model ID at runtime — see [Model Tier Registry](#model-tier-registry) below. Replaces the old hardcoded `model:` field. |
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
- Used in the trailing JSON completion block (`"agent"` field) and calling-workflow pipeline logs

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

### `model_tier`

```yaml
model_tier: standard
```

Declares the agent's **default** tier — the tier used when a calling workflow doesn't override it for a specific stage/mode. The actual model ID is resolved at runtime by the JS orchestrator from `config/model-tiers.json`, not hardcoded in the agent file. Agents never see or choose a model ID directly; they only know their tier (for the self-description rule each agent's prompt includes — see `operator.md`/`inspector.md`).

| Tier | Model | When to use |
|---|---|---|
| `economy` | Haiku 4.5 | Secret scanning, dependency auditing, formatting, changelog/docs generation, low-effort review, SHIP-mode pre-flight |
| `standard` | Sonnet 4.6 | Standard feature implementation, bug fixes, refactors, TDD cycles, medium/high-effort review |
| `frontier` | Opus 4.8 | Complex architectural planning, ambiguous bug diagnosis, multi-file refactors, maximum-effort review |

A workflow may pass a per-call `model` override (resolved from a different tier than the agent's default) via `agent()`'s `opts.model` — see "Model Tier Registry" below and `workflows/README.md`'s "Model routing per call" section.

---

## Model Tier Registry

`config/model-tiers.json` is the single source of truth mapping each tier name to a model ID, `max_tokens`, `temperature`, and a human-readable `use_cases` note. Because workflow scripts have no filesystem access, they cannot `require()` this file at runtime — each workflow embeds a small `TIER_MODELS` constant mirroring its values (see any `workflows/*.js` file). Treat `config/model-tiers.json` as the canonical reference; update both it and every workflow's `TIER_MODELS` constant together if a tier's model ID changes.

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
model_tier: standard
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

Every agent must emit exactly one JSON block (wrapped in ```json ... ```) as the **last element** of every response — no text after it. Required fields: `verdict`, `pipeline_gate`, `summary`, `blocking`, `findings` (empty array if none). `status` and `artifacts` are additional, agent-specific context.

Workflow-driven calls (`workflows/*.js`) never parse this text directly — they pass a `schema` option to `agent()` and the harness forces a validated structured tool call instead. The trailing JSON block matters for direct/manual invocation, where the caller has to parse the response text itself.

See any agent file's "Output — Strict JSON Schema" section for its canonical field values and verdict vocabulary.
