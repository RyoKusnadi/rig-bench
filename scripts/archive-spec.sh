#!/usr/bin/env bash
# archive-spec.sh — archive a finished spec into memory/archive/<spec-id>/
#
# Usage: scripts/archive-spec.sh <project> <spec-id>
#        scripts/archive-spec.sh <spec-id>   (only valid if exactly one specs/<project>/ folder exists)
#
# Finds the spec file in specs/<project>/finished/ matching the given ID prefix,
# copies it to memory/archive/<spec-id>/spec.md, records the most recent
# commit SHA that touched the spec file, extracts id/title/tags from the
# spec's YAML frontmatter, and appends/updates an entry in
# memory/archive/index.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -eq 2 ]]; then
  PROJECT="$1"
  SPEC_ID="$2"
elif [[ $# -eq 1 ]]; then
  SPEC_ID="$1"
  PROJECTS=()
  while IFS= read -r -d '' d; do
    PROJECTS+=("$(basename "$d")")
  done < <(find specs -mindepth 1 -maxdepth 1 -type d -print0)
  if [[ ${#PROJECTS[@]} -ne 1 ]]; then
    echo "Error: no project given, and specs/ does not have exactly one project folder (found: ${PROJECTS[*]:-none})." >&2
    echo "Usage: scripts/archive-spec.sh <project> <spec-id>" >&2
    exit 1
  fi
  PROJECT="${PROJECTS[0]}"
else
  echo "Error: spec ID argument is required." >&2
  echo "Usage: scripts/archive-spec.sh <project> <spec-id>" >&2
  exit 1
fi

# Find the spec file in specs/<project>/finished/ matching the given ID prefix.
SPEC_FILE=""
if [[ -d "specs/${PROJECT}/finished" ]]; then
  for f in specs/"${PROJECT}"/finished/"${SPEC_ID}"-*.md; do
    if [[ -f "$f" ]]; then
      SPEC_FILE="$f"
      break
    fi
  done
fi

if [[ -z "$SPEC_FILE" ]]; then
  echo "Error: spec '${SPEC_ID}' not found in specs/${PROJECT}/finished/." >&2
  exit 1
fi

ARCHIVE_DIR="memory/archive/${SPEC_ID}"
mkdir -p "$ARCHIVE_DIR"

# Copy the spec file to memory/archive/<spec-id>/spec.md.
cp "$SPEC_FILE" "${ARCHIVE_DIR}/spec.md"

# Extract the most recent commit SHA that touched the spec file.
COMMIT_SHA="$(git log --follow --pretty=format:"%H" -1 -- "$SPEC_FILE" || true)"
printf '%s' "$COMMIT_SHA" > "${ARCHIVE_DIR}/commit.sha"

# Extract the frontmatter block (everything between the first two '---' delimiters).
FRONTMATTER="$(awk '/^---$/{c++; next} c==1' "$SPEC_FILE")"

FM_ID="$(printf '%s\n' "$FRONTMATTER" | grep -E '^id:' | head -1 | sed -E 's/^id:[[:space:]]*//' | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'\$/\1/")"
FM_TITLE="$(printf '%s\n' "$FRONTMATTER" | grep -E '^title:' | head -1 | sed -E 's/^title:[[:space:]]*//' | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'\$/\1/")"

# tags may be a YAML inline array, e.g. tags: ["a", "b"] or tags: [a, b]
FM_TAGS_RAW="$(printf '%s\n' "$FRONTMATTER" | grep -E '^tags:' | head -1 | sed -E 's/^tags:[[:space:]]*//')"

if [[ -z "$FM_ID" ]]; then
  FM_ID="$SPEC_ID"
fi

ARCHIVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

INDEX_FILE="memory/archive/index.json"
mkdir -p "$(dirname "$INDEX_FILE")"

node -e '
const fs = require("fs");

const indexFile = process.argv[1];
const id = process.argv[2];
const title = process.argv[3];
const tagsRaw = process.argv[4];
const commitSha = process.argv[5];
const archivedAt = process.argv[6];

let tags = [];
if (tagsRaw && tagsRaw.trim().length > 0) {
  const inner = tagsRaw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim().length > 0) {
    tags = inner
      .split(",")
      .map((t) => t.trim().replace(/^["'"'"']|["'"'"']$/g, ""))
      .filter(Boolean);
  }
}

let data = [];
if (fs.existsSync(indexFile)) {
  const raw = fs.readFileSync(indexFile, "utf8").trim();
  if (raw.length > 0) {
    data = JSON.parse(raw);
  }
}

const entry = { id, title, tags, commit_sha: commitSha, archived_at: archivedAt };

const existingIdx = data.findIndex((e) => e.id === id);
if (existingIdx >= 0) {
  data[existingIdx] = entry;
} else {
  data.push(entry);
}

fs.writeFileSync(indexFile, JSON.stringify(data, null, 2) + "\n");
' "$INDEX_FILE" "$FM_ID" "$FM_TITLE" "$FM_TAGS_RAW" "$COMMIT_SHA" "$ARCHIVED_AT"

echo "Archived spec '${SPEC_ID}' -> ${ARCHIVE_DIR}/"
