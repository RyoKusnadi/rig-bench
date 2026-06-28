# config/schemas/

Canonical JSON Schemas (draft-07) for every structured-data boundary in this harness. Each schema is the single source of truth — `workflows/*.js` inline `GATE_SCHEMA`/`SCOUT_SCHEMA` constants (used by the Workflow tool's own `StructuredOutput` enforcement) are a subset of the matching schema here, and `lib/schema-validator.mjs` validates directly against these files on the manual/non-Workflow invocation path.

| Schema | Validates | Used by |
|---|---|---|
| `operator-output.schema.json` | `operator`'s completion block (`pipeline_gate`, `mode`, `verdict`, `findings`, ...) | `subagents/operator/operator.md` (its own output contract); every code-writing workflow's inline `GATE_SCHEMA` is a subset |
| `inspector-output.schema.json` | `inspector`'s completion block (REVIEW and EVALUATE modes) | `subagents/inspector/inspector.md`; `workflows/*.js` inspector-stage schemas |
| `scout-output.schema.json` | `scout`'s completion block (MANIFEST / GATE / VALIDATE_AGENT_FILE modes) | `subagents/scout/scout.md`; every workflow's inline `SCOUT_SCHEMA` |
| `researcher-output.schema.json` | `researcher`'s completion block (RESEARCH and SYNTHESIZE modes) | `subagents/researcher/researcher.md`; `workflows/research.js` |
| `research-intake.schema.json` | The questionnaire intake object (`research/{topic}/intake.json`) before a research run starts | `scripts/ask-questionnaire.mjs` (via `lib/schema-validator.mjs`) before writing `intake.json`; `workflows/research.js` expects `args.intake` to already satisfy this shape |
| `research-state.schema.json` | The research loop's accumulated state (`validated_facts`, `confidence_score`, `loop_log`, ...) | `lib/research-state.mjs` (documented reference for the shape — not imported by `workflows/research.js`, which mirrors it inline; see that file's header comment) |

Validation paths:

- **Workflow tool path** (`workflows/*.js`): the Workflow tool enforces `agent()`'s `schema` option directly at the tool-call layer — the inline `GATE_SCHEMA`/`SCOUT_SCHEMA` constants in each workflow script are what's actually passed, kept as a subset of the canonical schema here (drift between an inline constant and its schema file is a manual-review concern, not currently caught by a test — `tests/lib-workflow-sync.test.js` only checks the `TIER_MODELS`/`AGENT_MAX_RETRIES` constants, not these schemas).
- **Direct/manual invocation path** (no Workflow tool, e.g. `scripts/ask-questionnaire.mjs`): `lib/schema-validator.mjs`'s `validate()` loads one of these files and checks a parsed object against it directly.

See `subagents/SCHEMA.md` for the full frontmatter/output contract each agent's `.md` file follows, and `workflows/README.md`'s "Boundary schema validation between handoffs" section for why this lives at the JSON Schema layer instead of hand-rolled checks.
