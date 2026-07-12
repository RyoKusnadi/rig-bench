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

The method here is deliberately not "search once, summarize what came back." Good research
is a loop: decompose the question, search broad, evaluate what surfaced, drill into gaps,
cross-check what you'll rely on, and only then write. Each phase below exists to force one
of those steps.

## Phase 0 — Clarify the topic (only if vague)

If the topic already carries a goal, level, or scope ("learn German **for A1**", "how
crypto works **at a high level**"), skip this phase entirely — don't interrogate a clear
request.

If it doesn't ("research programming"), ask **at most 2–3 clarifying questions, batched in
one `AskUserQuestion` call**: what's the goal, what's the current level, any constraints
(time, budget, language). Fold the answers into the topic and move on.

## Phase 1 — Decompose into sub-questions

Before any search, break the topic into **3–6 sub-questions** that together would satisfy
the request — distinct angles, not rephrasings. For "learn German for A1" that might be:
what does A1 actually require (official definition), what's a realistic timeline, which
methods/resources work for self-study, how is A1 tested and by whom, what do learners
typically get wrong.

This list is the backbone of everything after it: it decides what to search for, it's the
coverage checklist that tells you when to stop, and it becomes the report's skeleton. Write
it down (in your working notes, not a repo file) before Phase 2.

## Phase 2 — Iterative search loop

Research in **rounds**, not one pass. Expect 1 round for a narrow topic, 2–3 for a broad
one.

**Round 1 — map the landscape.** Run 2–4 broad `WebSearch` queries: the topic roughly
verbatim, plus variants aimed at authoritative sources (official docs, standards bodies,
established institutions — e.g. the Goethe-Institut or CEFR for German levels, protocol
docs for crypto). Skim the result titles/domains before fetching anything: which
sub-questions do they cover, and who is actually authoritative here?

**Pick sources laterally, not by rank.** Search ranking rewards SEO, not accuracy —
content farms routinely outrank primary sources. For each candidate ask: who publishes
this, and are they an origin of this information or a repackager? Prefer primary and
authoritative sources (official docs, the organization that defines the standard, the
paper or announcement itself) over blog-spam summarizing them. If a promising claim
appears on a secondary site, trace it to its original source and fetch **that**. Skip
paywalls and near-duplicates of the same publisher.

**Fetch and map.** `WebFetch` the chosen sources and, as you read, map findings onto the
sub-question list. Note explicitly: which sub-questions are now covered, which are thin,
and where two sources **disagree** — disagreements are a finding, not noise.

**Later rounds — drill into gaps.** Each subsequent round's queries are written from the
gap list, and they get *narrower*: specific terms you learned in round 1, a named standard
or tool, a "site:" toward a known-authoritative domain. Fetch 1–3 more sources per round.

**Stop when** every sub-question is covered — the load-bearing ones by at least two
independent sources — or when a round surfaces nothing new (diminishing returns beats a
fixed quota; don't keep searching to fill a number, and don't stop at a number if a
sub-question is still open). Typical totals: 3–8 searches, 4–8 fetched sources.

Record the exact URL of every page actually fetched and used. **Those are the only citable
sources** — never cite a page you didn't fetch, and never cite a repackager for a claim
you traced to its origin.

## Phase 3 — Verify before writing

Before drafting, run down the claims the report will lean on — numbers, dates, timelines,
requirements, "the standard way to do X":

- A load-bearing claim needs **two independent sources** (different publishers, not one
  quoting the other). If it has one, either find a second, mark it in the report as
  single-sourced ("according to X…"), or drop it.
- Where sources disagreed, don't silently pick a winner or average them — say so in the
  report, with both citations, and note which source is better positioned to know.
- If a claim came from a secondary source and you couldn't reach the original, attribute
  it as secondhand rather than stating it flat.

This phase is cheap — a few minutes against notes you already have — and it's the
difference between a researched guide and a confident-sounding summary.

## Phase 4 — Synthesize the report

Write 400–2000 words of markdown, scaled to the topic (a narrow explainer stays short; a
multi-angle guide earns the length). The sub-questions from Phase 1 are the skeleton —
every one of them should be answerable from the finished report. Template — adapt the
section names to the topic ("Learning Path" for learn-X topics, "How It Works" for
explainers):

```markdown
# <Title>

## Overview
3–5 sentences: what this is, why it matters, what the reader will get.

## Key Concepts
- **Term** — one-line definition.

## Learning Path        <!-- or: ## How It Works -->
1. Ordered steps or milestones, concrete enough to act on.

## Where Sources Disagree   <!-- only if Phase 3 found real disagreements -->
- One bullet per disagreement: the claim, who says what, which reading is better supported.

## Resources
- [Source title](https://url) — one line on why/when to use it.

## Next Steps
2–4 concrete actions the reader can take this week.
```

Every non-obvious claim carries an inline `[source](url)` link to a fetched page;
single-sourced claims are attributed in the prose. Synthesize across sources — the report
answers the sub-questions in its own structure; it is not a sequence of per-source
summaries.

**Diagrams and images — when the shape of the thing is the point.** If the topic has a
process, architecture, timeline, or hierarchy (a request pipeline, a certification ladder,
how a transaction flows), show it, don't just narrate it:

- **Diagrams**: draw an ASCII/text diagram inside a fenced code block — boxes, arrows,
  indented trees. The dashboard renders fences as preformatted text, so these work with no
  extra tooling. Keep it under ~15 lines and label it with a one-line caption above.
- **Images**: `![caption](https://...)` embeds an image in the dashboard. Use only a
  direct image URL you actually saw on a page you fetched (an official chart, a spec's own
  figure) — never construct or guess an image URL, and skip it if the source's terms make
  hotlinking dubious. The image's page still belongs in `sources`.

One good diagram beats three decorative ones; if the topic is purely conceptual, skip
visuals entirely.

The dashboard renders headings, lists, bold, code, fenced blocks, http(s) links, and
`![...](https://...)` images; anything else falls back to plain paragraphs — keep the
markdown simple.

## Phase 5 — Save via the CLI

The CLI is the only write path. Write the body to a scratchpad temp file (never a file in
the repo tree), then:

```bash
node scripts/spec-db.mjs research add "<user's question>" "<report title>" <body-file> '["https://url1","https://url2"]'
```

- `sources` is a JSON array of the fetched URLs from Phase 2.
- Delete the temp file afterwards.
- Capture the printed `research#<seq> (<slug>) recorded` — the seq/slug is how the user
  retrieves it.

## Phase 6 — Report back

Give the user a 2–3 sentence summary of what the guide covers — including anything
surprising Phase 3 turned up (a disagreement, a claim that didn't survive verification) —
then where to read it:

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
