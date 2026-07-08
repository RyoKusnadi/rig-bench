# Gotchas

Surprising behaviors of this repo/tooling that cost time to discover. Entry format and
pruning convention: see `memory/README.md`.

## 2026-07-08 — Multi-line shell run under /bin/sh silently ships broken generated files (spec 0021 dogfooding)

A batch trace-generation command using bashisms (`declare -A`, `${map[$key]}`) was executed
through a tool whose default shell was /bin/sh (dash). Dash rejected the bashisms line by
line but kept executing: the loop still ran, files were still created — with their
interpolated sections empty — and the final listing looked plausible. The command "worked"
while writing 10 degraded artifacts; only reading stderr (a wall of `Bad substitution`)
revealed it. This is nastier than the bash-3.2 entry below: there the script died loudly;
here partial execution produced wrong *content* with a success-shaped exit. Rule: never
inline bashisms into a multi-line command whose executing shell you haven't pinned — write
the script to a file and run it with an explicit `bash script.sh`, and after any batch file
generation, read one generated file back before building on it.

## 2026-07-07 — Stacked PRs + squash merge silently lose content (specs 0012–0020, PRs #92–#100)

The 0012→0020 dependency chain was executed as stacked PRs — each spec's PR based on its
dependency's feature branch, per spec-exec's "Branch base" rule. Squash-merging those PRs
merged each one *into its base branch*, not into main: only the bottom PR (#92) reached
main, and the intermediate branches holding all implementation content were deleted on
merge. GitHub marked every PR "merged" throughout — nothing looked wrong until main's tree
was inspected. Content was recovered from surviving local branches and re-landed as one PR
(#100). Rule going forward: a stacked PR's content only reaches main if PRs merge strictly
leaf-first with base retargeting after each merge, or the whole stack re-lands as one PR
against main — when dispatching a dependent chain, prefer serializing merges (merge + pull
main between specs) over stacking, and always verify main's tree after merging a stack.

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
