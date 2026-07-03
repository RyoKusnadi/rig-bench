# Gotchas

Surprising behaviors of this repo/tooling that cost time to discover. Entry format and
pruning convention: see `memory/README.md`.

## 2026-07-03 — Spec files are gitignored; every add needs -f (spec 0002, PR #63–66)

`.gitignore` ignores `specs/*/*/*.md`, so `git add` on a spec file silently stages nothing
and the commit reports a clean tree. The skills' documented commands all use `git add -f`
for spec files — that flag is load-bearing, not habit. Same applies to anything created
under a lifecycle folder.
