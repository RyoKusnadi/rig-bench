---
id: "0005"
title: Detect depends_on cycles and finished-depends-on-unfinished in check-specs.sh
status: finished
depends_on: ["0001"]
verify_attempts: 0
source: ""
---
## Problem

`check-specs.sh` catches dangling `depends_on` references, but not the two other ways the
dependency graph goes wrong: cycles (A depends on B depends on A — spec-exec would deadlock
on its "dependencies finished?" gate), and a `finished` spec depending on a spec that never
finished (which means the gate was bypassed). The removed `lib/spec-graph.mjs` covered this
with a separate module; this re-adds only the essential checks, inside the existing script.

## Acceptance Criteria

- If the `depends_on` graph of a project contains a cycle, then `check-specs.sh` shall
  report each cycle as an issue and exit 1.
- If a spec whose status is `finished` depends on a spec whose status is not `finished`,
  then `check-specs.sh` shall report it as an issue.
- When the dependency graph is acyclic and all finished specs' dependencies are finished,
  `check-specs.sh` shall report no new issues (existing behavior preserved).
- The checks shall use only bash built-ins and awk/grep/sed, consistent with the script's
  dependency-free rule (memory/decisions.md 2026-07-03).

## Out of Scope

- Execution ordering / topological sort output — spec-exec's prose gate already handles
  ordering; this only validates the graph is orderable.
- A standalone graph module (`lib/spec-graph.mjs` shape) — that died with the second strip
  pass; these are checks, not a library.

## Files/Interfaces Touched

- `scripts/check-specs.sh`

## Implementation Notes

Reuse the existing frontmatter parsing to build `id → deps` and `id → status` maps, then
iterative DFS with a white/gray/black color map for cycle detection (gray hit = cycle).
Dangling deps are already reported by the existing check — skip them in DFS rather than
double-reporting. Per memory/decisions.md, no YAML parser and no node dependency for this.

## Verification

`scripts/check-specs.sh template` passes on the current tree. With two scratch specs in
`draft/` depending on each other, the script reports a `dep-cycle` issue and exits 1; with a
scratch `finished` spec depending on a `draft` spec, it reports `finished-dep-unfinished`
(scratch files removed afterwards).
