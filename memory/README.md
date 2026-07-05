# memory/

Durable, file-based memory for this harness. Three notebooks, plain markdown, grep as the
query engine. This is the deliberately-smaller replacement for the removed TF-IDF/SQLite
memory system: at this repo's scale, a vector store was
complexity without daily value, and these files are what it actually needed to be.

## The notebooks

| File | What goes in it |
|---|---|
| `decisions.md` | Choices with a rationale that future work should respect (or knowingly overturn) |
| `gotchas.md` | Surprising behaviors of this repo/tooling that cost time to discover |
| `lessons.md` | What verification failures, blocked specs, and postmortems taught |

## Entry format

```
## YYYY-MM-DD — Short imperative title (spec NNNN | PR #NN)

Free prose. Say what happened, what was concluded, and what a future reader should do
differently. A few sentences is the right size — an entry nobody reads is worse than none.
```

The `(spec NNNN | PR #NN)` provenance tag is required — memory without a pointer back to the
evidence decays into folklore.

## Pruning convention

Superseded entries are **struck through, not deleted**, with a pointer to what replaced them:

```
## ~~2026-01-01 — Old belief (spec 0004)~~

~~Original text...~~

**Superseded by** the 2026-03-01 entry below / spec 0009.
```

Git history is not the pruning mechanism — the working tree should show what was once
believed and why it changed, without archaeology.

## The lifecycle loop

These notebooks are wired into the spec lifecycle (spec 0003), not just available to it:

- **Write:** `spec-verify` appends a distilled `lessons.md` entry on every failed
  verification and every blocked escalation (and optionally on a pass that taught something
  durable) — see its Phase 6.
- **Read:** `spec-plan` consults `memory/` alongside the Non-negotiables check before
  drafting, folding relevant hits into the new spec's Implementation Notes.

That closes the loop: failures become lessons, lessons reach the next plan.

## Querying

`grep -ri <term> memory/` — that's the whole search system, on purpose. If these files ever
grow past what grep + headings can navigate, split by topic before reaching for an index.
