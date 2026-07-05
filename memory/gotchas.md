# Gotchas

Surprising behaviors of this repo/tooling that cost time to discover. Entry format and
pruning convention: see `memory/README.md`.

## 2026-07-05 — Lifecycle scripts must stay bash-3.2 compatible (PR pending)

macOS ships bash 3.2 as /bin/bash, which predates associative arrays (`declare -A`,
bash 4.0) — check-specs.sh used them for the id/dep maps and died with `declare: -A:
invalid option` on every Mac, taking `make check` and two hook tests down with it. The
map- and graph-shaped logic now lives in a single awk program (awk has associative
arrays everywhere); keep it there. Related: under `set -o pipefail`, a
`grep field | head | sed` extraction returns grep's exit 1 when the field is absent and
silently kills the script — extract frontmatter fields with awk (`fm_field`), which
always exits 0, so missing-id/missing-status get *reported* instead of crashing the
checker.

## 2026-07-03 — Spec files are gitignored; every add needs -f (spec 0002, PR #63–66)

`.gitignore` ignores `specs/*/*/*.md`, so `git add` on a spec file silently stages nothing
and the commit reports a clean tree. The skills' documented commands all use `git add -f`
for spec files — that flag is load-bearing, not habit. Same applies to anything created
under a lifecycle folder.
