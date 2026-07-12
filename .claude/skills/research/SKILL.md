---
name: research
description: Runs web-search-backed research on a user-supplied topic and produces a structured, cited markdown learning guide or explainer, stored in spec.db (research_reports) and viewable in the dashboard's research panel. Use whenever the user asks to research or learn about a general topic — phrases like "/research how can I learn German for A1", "research how crypto works at a high level", "put together a learning guide for X", "give me a researched overview of Y with sources". Does not apply to planning or designing features for this repo (use spec-plan), to questions answerable from the codebase itself without web research, or to retrieving a report that already exists (use `node scripts/spec-db.mjs research list` / `research show`) — see the skill body for the full boundary.
---

# Research

Turn a topic the user wants to learn into a durable, sourced learning guide. The output is
not a chat answer that scrolls away: it's a markdown report saved to the DB via
`scripts/spec-db.mjs` (the only sanctioned write path — the server and dashboard are
read-only) and browsable in the dashboard's **research** panel.

**This applies when** the user gives a topic to research or learn — a skill, a concept, a
field. **It does not apply to** repo feature work (that's `spec-plan`), questions the
codebase itself answers (just read the code), or pulling up an existing report
(`node scripts/spec-db.mjs research list`, `research show <seq|slug>`). If the user asks a
quick factual question that needs no durable guide, just answer it — don't ceremonially
produce a report nobody will reopen.

## Phase 0 — Clarify the topic (only if vague)

If the topic already carries a goal, level, or scope ("learn German **for A1**", "how
crypto works **at a high level**"), skip this phase entirely — don't interrogate a clear
request.

If it doesn't ("research programming"), ask **at most 2–3 clarifying questions, batched in
one `AskUserQuestion` call**: what's the goal, what's the current level, any constraints
(time, budget, language). Fold the answers into the topic and move on.

## Phase 1 — Research fan-out

1. Run **2–4 `WebSearch` queries**: the topic roughly verbatim, a beginner/how-to variant,
   and an authoritative-source variant (official docs, standards bodies, established
   institutions — e.g. the Goethe-Institut for German levels, protocol docs for crypto).
2. From the results, pick **4–6 distinct, reputable sources** and `WebFetch` **3–5** of
   them. Skip paywalls, SEO farms, and duplicates of the same publisher.
3. Record the exact URL of every page actually fetched and used. **Those are the only
   citable sources** — never cite a page you didn't fetch.

## Phase 2 — Synthesize the report

Write 400–1200 words of markdown. Template — adapt the section names to the topic
("Learning Path" for learn-X topics, "How It Works" for explainers):

```markdown
# <Title>

## Overview
3–5 sentences: what this is, why it matters, what the reader will get.

## Key Concepts
- **Term** — one-line definition.

## Learning Path        <!-- or: ## How It Works -->
1. Ordered steps or milestones, concrete enough to act on.

## Resources
- [Source title](https://url) — one line on why/when to use it.

## Next Steps
2–4 concrete actions the reader can take this week.
```

Every non-obvious claim carries an inline `[source](url)` link to a fetched page. The
dashboard renders headings, lists, bold, code, and http(s) links; anything else falls back
to plain paragraphs — keep the markdown simple.

## Phase 3 — Save via the CLI

The CLI is the only write path. Write the body to a scratchpad temp file (never a file in
the repo tree), then:

```bash
node scripts/spec-db.mjs research add "<user's question>" "<report title>" <body-file> '["https://url1","https://url2"]'
```

- `sources` is a JSON array of the fetched URLs from Phase 1.
- Delete the temp file afterwards.
- Capture the printed `research#<seq> (<slug>) recorded` — the seq/slug is how the user
  retrieves it.

## Phase 4 — Report back

Give the user a 2–3 sentence summary of what the guide covers, then where to read it:

- CLI: `node scripts/spec-db.mjs research show <seq>` (or the slug)
- Dashboard: `make serve` → http://localhost:4870 → **research** toggle in the header
- The DB is per-machine (like the specs it lives beside); `node scripts/spec-db.mjs
  research export` prints markdown for backup or transfer — same trade as memory, see
  `memory/README.md`.

## Boundary notes

The `research` CLI family, API, and dashboard panel are shared tooling: keep them
general-purpose (CLAUDE.md non-negotiable) — no topic-specific special cases. And this
skill is for the user's learning topics, not a side door for repo planning; a request
shaped like "research how we should build feature X here" belongs to `spec-plan`.
