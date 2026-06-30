#!/usr/bin/env bash
# search-structure.sh — search memory/structure.json for files, exports, and
# imports matching a query string. Used by the operator agent to find
# relevant files without blind ripgrep searches.
#
# Usage:
#   bash scripts/search-structure.sh <query>

set -euo pipefail

QUERY="${1:-}"

if [ -z "$QUERY" ]; then
  echo "Usage: bash scripts/search-structure.sh <query>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_FILE="$REPO_ROOT/memory/structure.json"

if [ ! -f "$INDEX_FILE" ]; then
  echo "Error: structure index not found at memory/structure.json" >&2
  echo "Run scripts/build-structure-index.sh to generate it." >&2
  exit 1
fi

if [ ! -s "$INDEX_FILE" ]; then
  echo "Error: memory/structure.json is empty" >&2
  echo "Run scripts/build-structure-index.sh to regenerate it." >&2
  exit 1
fi

node -e "
const fs = require('fs');

const indexFile = process.argv[1];
const query = process.argv[2].toLowerCase();

let data;
try {
  data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
} catch (err) {
  console.error('Error: failed to parse memory/structure.json — ' + err.message);
  process.exit(1);
}

if (!Array.isArray(data) || data.length === 0) {
  console.error('Error: memory/structure.json contains no entries');
  process.exit(1);
}

function matches(entry) {
  if (entry.path && entry.path.toLowerCase().includes(query)) return true;
  if (Array.isArray(entry.exports) && entry.exports.some(e => String(e).toLowerCase().includes(query))) return true;
  if (Array.isArray(entry.imports) && entry.imports.some(i => String(i).toLowerCase().includes(query))) return true;
  return false;
}

const results = data.filter(matches).slice(0, 5);

if (results.length === 0) {
  console.log('No matches found for: ' + process.argv[2]);
  process.exit(0);
}

console.log('Found ' + results.length + ' match(es) for \"' + process.argv[2] + '\":');
console.log('');

results.forEach((entry, i) => {
  console.log((i + 1) + '. ' + entry.path);
  console.log('   type:    ' + (entry.type || 'unknown'));
  console.log('   exports: ' + (Array.isArray(entry.exports) && entry.exports.length ? entry.exports.join(', ') : '(none)'));
  console.log('   imports: ' + (Array.isArray(entry.imports) && entry.imports.length ? entry.imports.join(', ') : '(none)'));
  console.log('');
});
" "$INDEX_FILE" "$QUERY"
