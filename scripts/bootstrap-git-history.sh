#!/usr/bin/env bash
# Bootstraps an episodic memory index of recent Git commits.
#
# Extracts the last 50 commits (SHA, one-line message, comma-separated
# files changed) from the current repo and writes them as a JSON array
# to memory/archive/git/index.json. Existing content at that path is
# overwritten.
#
# Usage: bash scripts/bootstrap-git-history.sh  (run from repo root)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$REPO_ROOT"

OUT_DIR="memory/archive/git"
OUT_FILE="$OUT_DIR/index.json"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/git-history-index.XXXXXX.json")"
trap 'rm -f "$TMP_FILE"' EXIT

mkdir -p "$OUT_DIR"

# Collect the last 50 commits as SHA|||date|||message, then for each commit
# resolve its changed files via git diff-tree. Hand everything to a
# small Node script for safe JSON construction (avoids manual escaping).
git log --pretty=format:'%H|||%cd|||%s' --date=format:'%Y-%m-%d' -50 | node -e '
  const { execSync } = require("child_process");
  const fs = require("fs");

  const input = fs.readFileSync(0, "utf8");
  const lines = input.split("\n").filter((l) => l.length > 0);

  const entries = lines.map((line) => {
    const sep = "|||";
    const firstIdx = line.indexOf(sep);
    const secondIdx = line.indexOf(sep, firstIdx + sep.length);
    const sha = line.slice(0, firstIdx);
    const commit_date = line.slice(firstIdx + sep.length, secondIdx);
    const message = line.slice(secondIdx + sep.length);

    let files = "";
    try {
      const out = execSync(
        `git diff-tree --no-commit-id -r --name-only ${sha}`,
        { encoding: "utf8" }
      );
      files = out.split("\n").filter((f) => f.length > 0).join(",");
    } catch (e) {
      files = "";
    }

    return { sha, commit_date, message, files };
  });

  process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
' > "$TMP_FILE"

mv "$TMP_FILE" "$OUT_FILE"
trap - EXIT

COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$OUT_FILE','utf8')).length)")
echo "Wrote $COUNT commit(s) to $OUT_FILE"
