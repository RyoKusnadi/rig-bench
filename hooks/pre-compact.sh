#!/usr/bin/env bash
# PreCompact hook — snapshots the current git diff, branch, and a best-effort
# extraction of recent user messages before the harness compacts context, so
# the original task intent survives a long-running operator/inspector session.
#
# Stdin: JSON with transcript_path, compaction_type ("manual"|"auto"), reason
# This hook is observation-only — it must ALWAYS exit 0. Exiting 2 would block
# compaction entirely, which is not the intent.

set -uo pipefail

input=$(cat)
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="$repo_root/.claude/session-state"
mkdir -p "$state_dir"

compaction_type=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('compaction_type','unknown'))" 2>/dev/null || echo "unknown")
reason=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reason',''))" 2>/dev/null || true)
transcript_path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || true)

branch=$(cd "$repo_root" && git branch --show-current 2>/dev/null || echo "")
diff_stat=$(cd "$repo_root" && git diff HEAD --stat 2>/dev/null | tail -20 || echo "")
ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

pyscript=$(mktemp)
trap 'rm -f "$pyscript"' EXIT

cat > "$pyscript" <<'PYEOF'
import sys, json, os

transcript_path = sys.argv[1]
out_path = sys.argv[2]
branch = sys.argv[3]
diff_stat = sys.argv[4]
compaction_type = sys.argv[5]
reason = sys.argv[6]
ts = sys.argv[7]

recent_user_messages = []
if transcript_path and os.path.isfile(transcript_path):
    try:
        with open(transcript_path, "r", errors="ignore") as f:
            lines = [l for l in f if l.strip()]
        for line in lines[-50:]:
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("role") != "user":
                continue
            content = entry.get("content", "")
            if isinstance(content, list):
                texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
                content = " ".join(texts)
            if isinstance(content, str) and content.strip():
                recent_user_messages.append(content.strip()[:500])
    except Exception:
        pass

recent_user_messages = recent_user_messages[-5:]

snapshot = {
    "timestamp": ts,
    "compaction_type": compaction_type,
    "reason": reason,
    "branch": branch,
    "git_diff_stat": diff_stat,
    "recent_user_messages": recent_user_messages,
}

with open(out_path, "w") as f:
    json.dump(snapshot, f, indent=2)
    f.write("\n")
PYEOF

python3 "$pyscript" "$transcript_path" "$state_dir/compact.json" "$branch" "$diff_stat" "$compaction_type" "$reason" "$ts" || true

exit 0
