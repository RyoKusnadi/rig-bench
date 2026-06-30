#!/usr/bin/env bash
# search-git-history.sh — search the git history index for matching commits.
#
# Usage: bash scripts/search-git-history.sh <query>
#
# Searches memory/archive/git/index.json (built by scripts/bootstrap-git-history.sh)
# for commits whose message or changed-files list contains <query>
# (case-insensitive substring match). Prints the top 5 matches as
# human-readable text: short SHA, commit message, and files changed.

set -euo pipefail

QUERY="${1:-}"
INDEX_FILE="memory/archive/git/index.json"

if [ -z "$QUERY" ]; then
  echo "Usage: bash scripts/search-git-history.sh <query>" >&2
  exit 1
fi

if [ ! -f "$INDEX_FILE" ]; then
  echo "No git history indexed yet — run scripts/bootstrap-git-history.sh first" >&2
  exit 1
fi

# Compute 6-month cutoff date (macOS vs Linux)
if date -v-6m +%Y-%m-%d >/dev/null 2>&1; then
  CUTOFF_DATE="$(date -v-6m +%Y-%m-%d)"
else
  CUTOFF_DATE="$(date -d '6 months ago' +%Y-%m-%d)"
fi

node -e "
const fs = require('fs');

const indexFile = process.argv[1];
const query = process.argv[2].toLowerCase();
const cutoff = process.argv[3];

let data;
try {
  data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
} catch (err) {
  console.error('No git history indexed yet — run scripts/bootstrap-git-history.sh first');
  process.exit(1);
}

if (!Array.isArray(data) || data.length === 0) {
  console.error('No git history indexed yet — run scripts/bootstrap-git-history.sh first');
  process.exit(1);
}

const matches = data.filter((entry) => {
  const message = String(entry.message || '').toLowerCase();
  const files = String(entry.files || '').toLowerCase();
  return message.includes(query) || files.includes(query);
}).slice(0, 5);

if (matches.length === 0) {
  console.log('No matches found for \"' + process.argv[2] + '\"');
  process.exit(0);
}

matches.forEach((entry, i) => {
  const shortSha = String(entry.sha || '').slice(0, 8);
  const commitDate = String(entry.commit_date || '');
  const isLegacy = commitDate && cutoff && commitDate < cutoff;
  const prefix = isLegacy ? '[LEGACY] ' : '';
  console.log((i + 1) + '. ' + prefix + shortSha + ' — ' + entry.message);
  if (commitDate) {
    console.log('   date: ' + commitDate + (isLegacy ? ' (older than 6 months)' : ''));
  }
  console.log('   files: ' + (entry.files || '(none)'));
  console.log('');
});
" "$INDEX_FILE" "$QUERY" "$CUTOFF_DATE"
