#!/usr/bin/env bash
# build-structure-index.sh
#
# Scans the repo for source files and writes a structural index to
# memory/structure.json. Each entry records the file's relative path,
# type, exported symbols, and import paths (regex-based, JS/TS-aware).
#
# Usage: bash scripts/build-structure-index.sh
# Must be run from the repo root.

set -euo pipefail

REPO_ROOT="$(pwd)"
OUT_DIR="${REPO_ROOT}/memory"
OUT_FILE="${OUT_DIR}/structure.json"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/structure-index.XXXXXX.json")"

mkdir -p "${OUT_DIR}"

cleanup() {
  rm -f "${TMP_FILE}"
}
trap cleanup EXIT

# Determine file "type" from its extension.
file_type() {
  local f="$1"
  case "$f" in
    *.ts|*.tsx) echo "typescript" ;;
    *.js|*.jsx|*.mjs|*.cjs) echo "javascript" ;;
    *.md|*.mdx) echo "markdown" ;;
    *.sh|*.bash) echo "shell" ;;
    *.json) echo "json" ;;
    *.yml|*.yaml) echo "yaml" ;;
    *.go) echo "go" ;;
    *.py) echo "python" ;;
    *) echo "other" ;;
  esac
}

# Escape a string for embedding inside a JSON string literal.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

first_entry=1

printf '[' > "${TMP_FILE}"

while IFS= read -r -d '' file; do
  # Normalize to a relative path like "scripts/foo.sh"
  rel_path="${file#./}"

  type="$(file_type "$rel_path")"

  exports=()
  imports=()

  if [[ "$type" == "javascript" || "$type" == "typescript" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && exports+=("$line")
    done < <(grep -hoE '^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|class|const|let|var)[[:space:]]+[A-Za-z0-9_$]+' "$file" 2>/dev/null | sed -E 's/^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|class|const|let|var)[[:space:]]+//' || true)

      while IFS= read -r line; do
        [[ -n "$line" ]] && exports+=("default")
      done < <(grep -hoE '^[[:space:]]*export[[:space:]]+default[[:space:]]*($|[^A-Za-z])' "$file" 2>/dev/null || true)

    while IFS= read -r line; do
      [[ -n "$line" ]] && imports+=("$line")
    done < <(grep -hoE "from[[:space:]]+['\"][^'\"]+['\"]" "$file" 2>/dev/null | sed -E "s/from[[:space:]]+['\"]([^'\"]+)['\"]/\1/" || true)
  fi

  # Build JSON arrays for exports/imports
  exports_json="["
  for i in "${!exports[@]}"; do
    [[ $i -gt 0 ]] && exports_json+=","
    exports_json+="\"$(json_escape "${exports[$i]}")\""
  done
  exports_json+="]"

  imports_json="["
  for i in "${!imports[@]}"; do
    [[ $i -gt 0 ]] && imports_json+=","
    imports_json+="\"$(json_escape "${imports[$i]}")\""
  done
  imports_json+="]"

  if [[ $first_entry -eq 0 ]]; then
    printf ',' >> "${TMP_FILE}"
  fi
  first_entry=0

  printf '{"path":"%s","type":"%s","exports":%s,"imports":%s}' \
    "$(json_escape "$rel_path")" "$type" "$exports_json" "$imports_json" >> "${TMP_FILE}"

done < <(find . \
  \( -path ./node_modules -o -path ./.git -o -path ./dist -o -path ./build -o -path ./memory \) -prune \
  -o -type f -print0)

printf ']' >> "${TMP_FILE}"

mv "${TMP_FILE}" "${OUT_FILE}"
trap - EXIT

echo "Structure index written to ${OUT_FILE}"
