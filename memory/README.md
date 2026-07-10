# Memory

The repo's durable memory: what was **decided** (and why), what was **discovered the hard
way**, and what failures **taught**. It lives in the DB (`memory_entries` in `spec.db`,
per-machine like everything else the DB holds) in three notebooks:

- **decisions** — choices with rationale; overturning one should be a choice, not an accident.
- **gotchas** — environment and tooling surprises that cost time once and shouldn't again.
- **lessons** — what verification failures, blocked specs, and postmortems taught.

## Commands

```bash
node scripts/spec-db.mjs memory add <notebook> "<heading>" "<body>" [spec_id]
node scripts/spec-db.mjs memory <notebook> [spec_id]    # list (optionally by linked spec)
node scripts/spec-db.mjs memory search "<term>"
node scripts/spec-db.mjs memory show <notebook> <seq>
node scripts/spec-db.mjs memory export [notebook]        # markdown out — backup/transfer
```

## Entry conventions

Headings are `<ISO date> — <title>`; lessons headings end with the provenance tag
`(spec NNNN)` — the missing-lesson check in `check-specs.sh` and the dashboard's
related-memory join both key on it (pass the id as the fourth `add` argument too, so the
link is structural, not just textual). Bodies carry the transferable part, not a replay of
events: what class of thing this was, and what a future spec or session should do
differently. A lesson that teaches nothing is still worth one line saying so — once.

## Lifecycle wiring

spec-plan consults memory before drafting (`memory search`); spec-verify records a lessons
entry on every failed verification and every blocked escalation (`memory add lessons …`);
the dashboard's spec detail pane shows entries linked by spec id.

## Migration note (2026-07-09)

The notebooks were markdown files in this directory until the DB migration. The files were
archived and removed; `scripts/spec-db.mjs import <project>` still parses any `memory/*.md`
present into the DB, which is both the one-time migration path and the restore path (unzip
an archive or `memory export > memory/<notebook>.md`, then import). The DB being per-machine
is accepted deliberately — same trade the spec documents made — with `export` as the
portability escape hatch.
