#!/usr/bin/env bash
# check-specs.sh — consistency checks across one project's specs.
#
# Usage: scripts/check-specs.sh <project>
#        scripts/check-specs.sh          (only valid if exactly one specs/<project>/ folder exists)
#
# Extends the file-conflict grep pattern already documented in specs/README.md
# ("File-conflict gate") to catch the class of bug found reviewing PR #56:
#   - duplicate spec IDs within a project
#   - depends_on entries that don't resolve to any spec ID in the project
#   - specs whose Files/Interfaces Touched list has grown past the
#     "one deliverable" sizing rule (specs/README.md "Rule" section), which
#     nothing currently catches automatically
#   - a spec's frontmatter `status` not matching the lifecycle folder it's
#     physically sitting in (specs/README.md "State Transitions" invariant)
#
# Exits 1 if any issue is found. Runs via `make check`, which CI executes on
# every PR (.github/workflows/checks.yml); the post-spec-edit hook also runs it
# advisorily after spec edits.
#
# Portability: must run under bash 3.2 (macOS's /bin/bash). No associative
# arrays, readarray, or other bash-4isms — map- and graph-shaped logic lives
# in awk, which has associative arrays everywhere.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SIZING_THRESHOLD="${SIZING_THRESHOLD:-5}"

if [[ $# -eq 1 ]]; then
  PROJECT="$1"
elif [[ $# -eq 0 ]]; then
  PROJECTS=()
  while IFS= read -r -d '' d; do
    PROJECTS+=("$(basename "$d")")
  done < <(find specs -mindepth 1 -maxdepth 1 -type d -print0)
  if [[ ${#PROJECTS[@]} -ne 1 ]]; then
    echo "Error: no project given, and specs/ does not have exactly one project folder (found: ${PROJECTS[*]:-none})." >&2
    echo "Usage: scripts/check-specs.sh <project>" >&2
    exit 1
  fi
  PROJECT="${PROJECTS[0]}"
else
  echo "Usage: scripts/check-specs.sh [project]" >&2
  exit 1
fi

PROJECT_DIR="specs/${PROJECT}"
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: ${PROJECT_DIR} does not exist." >&2
  exit 1
fi

ISSUES=0

# Collect every spec file across all lifecycle folders for this project.
SPEC_FILES=()
while IFS= read -r -d '' f; do
  SPEC_FILES+=("$f")
done < <(find "$PROJECT_DIR" -mindepth 2 -maxdepth 2 -name '*.md' -print0 | sort -z)

if [[ ${#SPEC_FILES[@]} -eq 0 ]]; then
  echo "No spec files found under ${PROJECT_DIR}/."
  exit 0
fi

echo "Checking ${#SPEC_FILES[@]} spec(s) in ${PROJECT_DIR}/ ..."
echo ""

# ── Extract frontmatter helpers ─────────────────────────────────────────────
frontmatter() {
  awk '/^---$/{c++; next} c==1' "$1"
}

# First value of a frontmatter field, quotes stripped. Reads the frontmatter on
# stdin. Always exits 0 — under `set -o pipefail`, a grep-based extraction would
# kill the whole script on the first spec missing the field, instead of letting
# the missing-id/missing-status checks report it.
fm_field() {
  awk -v key="$1" '
    !done && $0 ~ "^" key ":" {
      sub("^" key ":[ \t]*", "")
      gsub(/^["\047]|["\047]$/, "")
      print
      done = 1
    }'
}

# ── Frontmatter facts, one line per spec: file<TAB>id<TAB>status<TAB>deps ───
SPEC_DATA=""
for f in "${SPEC_FILES[@]}"; do
  fm="$(frontmatter "$f")"
  id="$(printf '%s\n' "$fm" | fm_field id)"
  status_val="$(printf '%s\n' "$fm" | fm_field status)"
  deps_raw="$(printf '%s\n' "$fm" | fm_field depends_on)"
  deps_clean="$(printf '%s' "$deps_raw" | sed -E 's/^\[//; s/\]$//' | tr ',' ' ' | tr -d '\042\047')"
  SPEC_DATA+="${f}	${id}	${status_val}	${deps_clean}
"
done

# ── Map/graph checks: duplicate ids, dangling depends_on, cycles,
#    finished-depends-on-unfinished — one awk pass ──────────────
# Cycle detection is a recursive DFS with white(0)/gray(1)/black(2) coloring;
# a gray hit is a cycle. Dangling deps are reported once and never enter the
# dep graph, so no double-report.
GRAPH_REPORT="$(printf '%s' "$SPEC_DATA" | awk -F'\t' -v project_dir="$PROJECT_DIR" '
function dfs(node, path,    i, m, arr, d) {
  color[node] = 1
  m = split(deps[node], arr, " ")
  for (i = 1; i <= m; i++) {
    d = arr[i]
    if (d == "") continue
    if (color[d] == 1) {
      printf "ISSUE [dep-cycle]: depends_on cycle detected: \047%s\047 -> \047%s\047 (path:%s %s).\n", node, d, path, node
    } else if (color[d] == 0) {
      dfs(d, path " " node)
    }
  }
  color[node] = 2
}
{
  file = $1; id = $2; status = $3; rawdeps = $4
  if (id == "") {
    printf "ISSUE [missing-id]: %s has no \047id\047 field in frontmatter.\n", file
    next
  }
  if (id in id_file) {
    printf "ISSUE [duplicate-id]: id \047%s\047 used by both %s and %s.\n", id, id_file[id], file
    next
  }
  id_file[id] = file
  id_status[id] = status
  raw[id] = rawdeps
  order[++n] = id
}
END {
  for (i = 1; i <= n; i++) {
    id = order[i]
    m = split(raw[id], arr, " ")
    for (j = 1; j <= m; j++) {
      d = arr[j]
      if (d == "") continue
      if (!(d in id_file)) {
        printf "ISSUE [dangling-depends_on]: %s depends_on \047%s\047, which is not any spec\047s id in %s/.\n", id_file[id], d, project_dir
      } else {
        deps[id] = deps[id] " " d
      }
    }
  }
  for (i = 1; i <= n; i++) {
    if (color[order[i]] == 0) dfs(order[i], "")
  }
  for (i = 1; i <= n; i++) {
    id = order[i]
    if (id_status[id] != "finished") continue
    m = split(deps[id], arr, " ")
    for (j = 1; j <= m; j++) {
      d = arr[j]
      if (d == "") continue
      if (id_status[d] != "finished") {
        printf "ISSUE [finished-dep-unfinished]: spec \047%s\047 is finished but depends_on \047%s\047 (status: %s) is not.\n", id, d, (id_status[d] == "" ? "unknown" : id_status[d])
        print "  spec-exec\047s dependency gate should have prevented this — the graph and the folders disagree."
      }
    }
  }
}')"

if [[ -n "$GRAPH_REPORT" ]]; then
  printf '%s\n' "$GRAPH_REPORT"
  GRAPH_ISSUES="$(printf '%s\n' "$GRAPH_REPORT" | grep -c '^ISSUE')"
  ISSUES=$((ISSUES + GRAPH_ISSUES))
fi

# ── File-conflict gate: shared paths across ready/in_progress specs ──
# Two specs eligible for (concurrent) execution that touch the same file must be
# ordered via depends_on — either direction, directly or transitively. Path per
# bullet: the first backticked span if present, else the first token, so trailing
# prose on a bullet doesn't defeat matching. Automates the manual grep documented
# in specs/README.md's "File-conflict gate".
FILE_DATA=""
for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"
  [[ "$folder" == "ready" || "$folder" == "in_progress" ]] || continue
  fm="$(frontmatter "$f")"
  id="$(printf '%s\n' "$fm" | fm_field id)"
  [[ -z "$id" ]] && continue
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    FILE_DATA+="${id}	${p}
"
  done <<EOF
$(awk '
    /^## Files\/Interfaces Touched/ { infiles=1; next }
    /^## / && infiles { infiles=0 }
    infiles && /^- / {
      line = $0
      sub(/^- +/, "", line)
      if (match(line, /`[^`]+`/)) print substr(line, RSTART+1, RLENGTH-2)
      else { split(line, a, /[ \t]/); print a[1] }
    }' "$f")
EOF
done

CONFLICT_REPORT="$({ printf '%s' "$SPEC_DATA" | awk -F'\t' '{ printf "S\t%s\t%s\n", $2, $4 }'
  printf '%s' "$FILE_DATA" | awk -F'\t' '{ printf "F\t%s\t%s\n", $1, $2 }'; } | awk -F'\t' '
function reach(src, dst,    i, m, arr, d) {
  if (src == dst) return 1
  if (seen[src] == q) return 0
  seen[src] = q
  m = split(deps[src], arr, " ")
  for (i = 1; i <= m; i++) { d = arr[i]; if (d != "" && reach(d, dst)) return 1 }
  return 0
}
function ordered(a, b) { q++; if (reach(a, b)) return 1; q++; if (reach(b, a)) return 1; return 0 }
$1 == "S" { deps[$2] = $3 }
$1 == "F" { ids[$3] = ids[$3] " " $2 }
END {
  for (p in ids) {
    n = split(ids[p], arr, " ")
    for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) {
      a = arr[i]; b = arr[j]
      if (a == "" || b == "" || a == b) continue
      if (!ordered(a, b)) {
        printf "ISSUE [file-conflict]: specs \047%s\047 and \047%s\047 both touch \047%s\047 with no depends_on path between them.\n", a, b, p
        print "  specs/README.md File-conflict gate: chain the later spec onto the earlier via depends_on."
      }
    }
  }
}')"
if [[ -n "$CONFLICT_REPORT" ]]; then
  printf '%s\n' "$CONFLICT_REPORT"
  ISSUES=$((ISSUES + $(printf '%s\n' "$CONFLICT_REPORT" | grep -c '^ISSUE')))
fi

# ── Sizing heuristic: Files/Interfaces Touched growing past one deliverable ──
for f in "${SPEC_FILES[@]}"; do
  count="$(awk '
    /^## Files\/Interfaces Touched/ { infiles=1; next }
    /^## / && infiles { infiles=0 }
    infiles && /^- / { n++ }
    END { print n+0 }
  ' "$f")"
  if [[ "$count" -gt "$SIZING_THRESHOLD" ]]; then
    echo "ISSUE [sizing]: $f lists $count files under Files/Interfaces Touched (threshold: $SIZING_THRESHOLD)."
    echo "  specs/README.md's Rule: one spec = one deliverable. Consider splitting."
    ISSUES=$((ISSUES + 1))
  fi
done

# ── Status/folder mismatch: frontmatter status must match the lifecycle folder ──
# Valid states are derived from workflows/state.yaml (the machine-readable state
# table) rather than hand-maintained here (an earlier hand-maintained third copy was removed).
# Parsing stays line-oriented (awk only) to keep this script dependency-free.
STATE_YAML="workflows/state.yaml"
if [[ ! -f "$STATE_YAML" ]]; then
  echo "Error: $STATE_YAML is missing — it is the source of the valid state list." >&2
  exit 1
fi
VALID_STATES=()
while IFS= read -r s; do
  VALID_STATES+=("$s")
done < <(awk '/^[[:space:]]*-[[:space:]]*name:/ { print $NF }' "$STATE_YAML")
if [[ ${#VALID_STATES[@]} -eq 0 ]]; then
  echo "Error: no states parsed from $STATE_YAML — file present but yields no '- name:' entries." >&2
  exit 1
fi
for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"
  fm="$(frontmatter "$f")"
  status="$(printf '%s\n' "$fm" | fm_field status)"
  if [[ -z "$status" ]]; then
    echo "ISSUE [missing-status]: $f has no 'status' field in frontmatter."
    ISSUES=$((ISSUES + 1))
    continue
  fi
  is_valid=0
  for s in "${VALID_STATES[@]}"; do
    [[ "$status" == "$s" ]] && is_valid=1 && break
  done
  if [[ "$is_valid" -eq 0 ]]; then
    echo "ISSUE [unknown-status]: $f has status '$status', which isn't one of: ${VALID_STATES[*]}."
    ISSUES=$((ISSUES + 1))
  elif [[ "$status" != "$folder" ]]; then
    echo "ISSUE [status-mismatch]: $f has status '$status' but sits in '$folder/'."
    echo "  specs/README.md's State Transitions invariant: status must always match the physical folder."
    ISSUES=$((ISSUES + 1))
  fi
done

# ── Spec-quality lint ────────────────────────────────────────────
# Three prose invariants made checkable: clarification markers may not leave draft/,
# a generated failures section implies verify_attempts > 0, and every spec carries the
# template's required sections. The required-section list is derived from the template's
# own ## headings — no hand-maintained copy (same reasoning as the state.yaml-derived
# state list).
SPEC_TEMPLATE="specs/spec-template.md"
if [[ ! -f "$SPEC_TEMPLATE" ]]; then
  echo "Error: $SPEC_TEMPLATE is missing — it is the source of the required-section list." >&2
  exit 1
fi
REQUIRED_SECTIONS="$(awk '/^## / { sub(/^## /, ""); print }' "$SPEC_TEMPLATE")"

for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"

  # Unresolved clarification marker outside draft/ (colon form only — prose may
  # legitimately mention the marker's name without carrying a live question).
  if [[ "$folder" != "draft" ]] && grep -q '\[NEEDS CLARIFICATION:' "$f"; then
    echo "ISSUE [stray-clarification]: $f carries an unresolved clarification marker outside draft/."
    echo "  specs/README.md Ambiguity gate: resolve every marker before a spec leaves draft."
    ISSUES=$((ISSUES + 1))
  fi

  # Failures section present while verify_attempts says no verification ever failed.
  fm="$(frontmatter "$f")"
  attempts="$(printf '%s\n' "$fm" | fm_field verify_attempts)"
  [[ -z "$attempts" ]] && attempts=0
  if [[ "$attempts" == "0" ]] && grep -q '^## Verification Failures' "$f"; then
    echo "ISSUE [stale-failures-section]: $f has a Verification Failures section but verify_attempts is 0."
    echo "  Only spec-verify writes that section (and increments the counter) — one of the two is wrong."
    ISSUES=$((ISSUES + 1))
  fi

  # Required template sections, matched as exact heading lines.
  while IFS= read -r sec; do
    [[ -z "$sec" ]] && continue
    if ! grep -q "^## ${sec}\$" "$f"; then
      echo "ISSUE [missing-section]: $f is missing required section '## ${sec}'."
      echo "  specs/spec-template.md is the canonical section list — every spec carries all of them."
      ISSUES=$((ISSUES + 1))
    fi
  done <<EOF
$REQUIRED_SECTIONS
EOF
done

# ── Transition enforcement: folder moves must follow state.yaml valid_next ──
# Compares each spec's lifecycle folder between a base ref and the current tree via git
# rename detection, so a `git mv` between lifecycle folders is one transition, not a
# delete+add. Fail-open: no resolvable base ref (non-git fixture, shallow clone without
# the ref) skips the check silently. Base defaults to origin/main; override with
# TRANSITION_BASE_REF.
TRANS_BASE="${TRANSITION_BASE_REF:-origin/main}"
if git rev-parse --verify --quiet "$TRANS_BASE" >/dev/null 2>&1; then
  TRANSITION_REPORT="$({ awk -F: '
      /^[[:space:]]*-[[:space:]]*name:/ { cur = $2; gsub(/[[:space:]]/, "", cur) }
      /^[[:space:]]*valid_next:/ {
        line = $2
        sub(/^[[:space:]]*\[/, "", line)
        sub(/\].*$/, "", line)
        gsub(/,/, " ", line)
        printf "T\t%s\t%s\n", cur, line
      }' "$STATE_YAML"
    git diff --name-status -M --diff-filter=R "$TRANS_BASE" -- "$PROJECT_DIR/" 2>/dev/null |
      awk -F'\t' '$3 != "" { printf "R\t%s\t%s\n", $2, $3 }' || true; } | awk -F'\t' '
  function reach(src, dst,    i, m, arr, d) {
    if (src == dst) return 1
    if (seen[src] == q) return 0
    seen[src] = q
    m = split(nexts[src], arr, " ")
    for (i = 1; i <= m; i++) { d = arr[i]; if (d != "" && reach(d, dst)) return 1 }
    return 0
  }
  $1 == "T" { nexts[$2] = $3; known[$2] = 1 }
  $1 == "R" {
    n1 = split($2, a, "/"); n2 = split($3, b, "/")
    if (n1 < 4 || n2 < 4) next
    olds = a[3]; news = b[3]
    if (olds == news) next
    if (!(olds in known)) next   # unknown old folder — the unknown-status check owns that
    # Path reachability, not direct membership: a single PR legitimately collapses
    # multi-hop moves (ready -> in_progress -> waiting_verification) into one
    # endpoint pair, so illegal means "no path through valid_next" (e.g. anything
    # out of a terminal state, or anything back into draft).
    q++
    if (!reach(olds, news)) {
      printf "ISSUE [illegal-transition]: %s moved \047%s\047 -> \047%s\047, but no valid_next path leads from \047%s\047 to \047%s\047.\n", $3, olds, news, olds, news
      print "  specs/README.md State Transitions: moves must follow the valid_next table in workflows/state.yaml."
    }
  }')"
  if [[ -n "$TRANSITION_REPORT" ]]; then
    printf '%s\n' "$TRANSITION_REPORT"
    ISSUES=$((ISSUES + $(printf '%s\n' "$TRANSITION_REPORT" | grep -c '^ISSUE')))
  fi
fi

# ── Criteria drift: the test must not change while being taken ──
# A spec's Acceptance Criteria and Verification sections are what the implementation gets
# graded against; silently editing them after work starts is grading against a weakened
# test (Meta-Harness's held-out-set principle: the evaluation target is never exposed to —
# or editable by — the optimizing process). For each spec currently in in_progress/ or
# waiting_verification/, compare those two sections against the same spec id's content at
# the base ref (found by id, not path, since lifecycle moves rename the file). Any
# difference is a WARN, not an ISSUE — criteria changes can be legitimate scope decisions,
# but they must be visible, not silent. Same base and fail-open behavior as the
# transition check above: no resolvable base ref skips silently; a spec id absent at the
# base ref (drafted after it) is skipped.
DRIFT_BASE="${TRANSITION_BASE_REF:-origin/main}"
if git rev-parse --verify --quiet "$DRIFT_BASE" >/dev/null 2>&1; then
  extract_graded_sections() {
    awk '
      $0 == "## Acceptance Criteria" || $0 == "## Verification" { on=1; print; next }
      /^## / { on=0 }
      on { print }'
  }
  BASE_TREE="$(git ls-tree -r --name-only "$DRIFT_BASE" -- "$PROJECT_DIR/" 2>/dev/null || true)"
  for f in "${SPEC_FILES[@]}"; do
    folder="$(basename "$(dirname "$f")")"
    [[ "$folder" == "in_progress" || "$folder" == "waiting_verification" ]] || continue
    id="$(frontmatter "$f" | fm_field id)"
    [[ -n "$id" ]] || continue
    base_path="$(printf '%s\n' "$BASE_TREE" | grep "/${id}-[^/]*\.md$" | head -1 || true)"
    [[ -n "$base_path" ]] || continue
    base_sections="$(git show "$DRIFT_BASE:$base_path" 2>/dev/null | extract_graded_sections || true)"
    cur_sections="$(extract_graded_sections < "$f")"
    if [[ "$base_sections" != "$cur_sections" ]]; then
      echo "WARN [criteria-drift]: $f's Acceptance Criteria or Verification section differs from ${DRIFT_BASE}:${base_path}."
      echo "  The graded sections changed after work started — confirm this was a deliberate, human-approved scope change, not the implementation adjusting its own test."
    fi
  done
fi

# ── PR traceability: a finished spec with a pr key must carry a value ──
# Specs predating the branch/pr fields have no `pr:` key at all and are exempt;
# an empty value on a finished spec means the spec-exec recording step was skipped.
for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"
  [[ "$folder" == "finished" ]] || continue
  fm="$(frontmatter "$f")"
  has_pr="$(printf '%s\n' "$fm" | awk '/^pr:/ { print "yes"; exit }')"
  [[ "$has_pr" == "yes" ]] || continue
  pr_val="$(printf '%s\n' "$fm" | fm_field pr)"
  if [[ -z "$pr_val" ]]; then
    echo "ISSUE [empty-pr]: $f is finished but its 'pr' frontmatter field is empty."
    echo "  spec-exec records the PR URL when the draft PR opens — backfill it."
    ISSUES=$((ISSUES + 1))
  fi
done

# ── Memory writeback check: escalations must leave a lessons.md entry ──
# The lifecycle loop promises every blocked escalation (and every failed verification)
# a distilled memory/lessons.md entry — this makes the promise checkable. Provenance
# match: a "## " heading that mentions "spec" and contains the raw id, which accepts
# the documented tag forms — "(spec 0006)", "(spec 0006, PR #77)", "(spec 0006 | PR #77)"
# — and the plural batch form "(specs 0010+0011, ...)". Blocked without an entry is a
# hard ISSUE (escalations are exactly what the notebook exists for); a
# waiting_verification spec with failed attempts is a WARN only — attempt-1 failures
# may be mid-fix with the entry legitimately pending. LESSONS_FILE overrides the path
# (fixtures); a missing file counts as "no entries".
LESSONS_FILE="${LESSONS_FILE:-memory/lessons.md}"
for f in "${SPEC_FILES[@]}"; do
  folder="$(basename "$(dirname "$f")")"
  [[ "$folder" == "blocked" || "$folder" == "waiting_verification" ]] || continue
  fm="$(frontmatter "$f")"
  id="$(printf '%s\n' "$fm" | fm_field id)"
  [[ -z "$id" ]] && continue
  attempts="$(printf '%s\n' "$fm" | fm_field verify_attempts)"
  [[ -z "$attempts" ]] && attempts=0
  if [[ "$folder" == "waiting_verification" && "$attempts" == "0" ]]; then
    continue
  fi
  has_lesson="$(awk -v id="$id" '/^## / && /spec/ && index($0, id) { print "yes"; exit }' "$LESSONS_FILE" 2>/dev/null || true)"
  if [[ "$has_lesson" == "yes" ]]; then
    continue
  fi
  if [[ "$folder" == "blocked" ]]; then
    echo "ISSUE [missing-lesson]: $f is blocked but ${LESSONS_FILE} has no entry tagged (spec ${id})."
    echo "  spec-verify Phase 6b: a blocked escalation always gets a lessons.md entry."
    ISSUES=$((ISSUES + 1))
  else
    echo "WARN [missing-lesson]: $f has ${attempts} failed attempt(s) but ${LESSONS_FILE} has no entry tagged (spec ${id})."
    echo "  Advisory: spec-verify Phase 6a writes one on every failed verification."
  fi
done

echo ""
if [[ "$ISSUES" -eq 0 ]]; then
  echo "No issues found."
  exit 0
else
  echo "${ISSUES} issue(s) found."
  exit 1
fi
