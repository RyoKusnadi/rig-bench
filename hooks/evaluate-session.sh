#!/usr/bin/env bash
# Stop hook — scans the session transcript for our own failure vocabulary
# (GATE_FAIL, BLOCKED, ESCALATE, etc.) and captures recurring patterns as
# "instincts" under .claude/instincts/pending/. This is the Capture step (plus
# a cheap version of Validate, via an occurrence counter) from todo.md's
# Instincts v2 pipeline. Auto-promotion to .claude/rules/common/ and the
# /evolve clustering command are not implemented here.
#
# Stdin: JSON with transcript_path, session_id (Stop hook payload)
# This hook is purely observational — it must ALWAYS exit 0. Exiting 2 would
# force Claude to keep going instead of stopping, which is not the intent.

set -uo pipefail

input=$(cat)
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pyscript=$(mktemp)
trap 'rm -f "$pyscript"' EXIT

cat > "$pyscript" <<'PYEOF'
import sys, json, os, re, hashlib, datetime

repo_root = sys.argv[1]
try:
    payload = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)

transcript_path = payload.get("transcript_path", "")
session_id = payload.get("session_id", "unknown")

if not transcript_path or not os.path.isfile(transcript_path):
    sys.exit(0)

KEYWORDS = re.compile(
    r"\b(GATE_FAIL|NO_TESTS|REGRESSION|EXAMPLE_FAIL|PREFLIGHT_FAIL|"
    r"CRITICAL_BLOCK|SECRET_FOUND|BLOCKED|ESCALATE)\b"
)

findings = []  # (keyword, snippet)

try:
    with open(transcript_path, "r", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("role") != "assistant":
                continue
            content = entry.get("content", [])
            if isinstance(content, str):
                blocks = [{"type": "text", "text": content}]
            elif isinstance(content, list):
                blocks = content
            else:
                blocks = []
            for block in blocks:
                if not isinstance(block, dict) or block.get("type") != "text":
                    continue
                text = block.get("text", "")
                m = KEYWORDS.search(text)
                if m:
                    snippet = text[max(0, m.start() - 80): m.start() + 160].strip()
                    findings.append((m.group(1), snippet))
except Exception:
    sys.exit(0)

if not findings:
    sys.exit(0)

instincts_dir = os.path.join(repo_root, ".claude", "instincts", "pending")
os.makedirs(instincts_dir, exist_ok=True)

today = datetime.date.today().isoformat()
seen_this_run = set()

for keyword, snippet in findings:
    key = (keyword + "|" + snippet[:120]).encode("utf-8", "ignore")
    h = hashlib.sha1(key).hexdigest()[:8]
    if h in seen_this_run:
        continue
    seen_this_run.add(h)

    path = os.path.join(instincts_dir, f"INST-{h}.md")

    if os.path.isfile(path):
        with open(path, "r") as f:
            body = f.read()
        m = re.search(r"^occurrences:\s*(\d+)", body, re.MULTILINE)
        if m:
            count = int(m.group(1)) + 1
            body = re.sub(r"^occurrences:\s*\d+", f"occurrences: {count}", body, flags=re.MULTILINE)
        else:
            body = body.replace("---\n", "---\noccurrences: 2\n", 1)
        body = re.sub(r"^last_seen:.*$", f"last_seen: {today}", body, flags=re.MULTILINE)
        if "last_seen:" not in body:
            body = body.replace("---\n", f"---\nlast_seen: {today}\n", 1)
        with open(path, "w") as f:
            f.write(body)
    else:
        content = f"""---
name: inst-{h}
keyword: {keyword}
confidence: 0.3
occurrences: 1
first_seen: {today}
last_seen: {today}
session_id: {session_id}
---

Captured by evaluate-session.sh after the {keyword} verdict appeared in a session
transcript.

## Snippet

> {snippet}

## Notes

Promote to `.claude/rules/common/` once this instinct has recurred enough times
across distinct sessions to be confident it's a real, generalizable pattern rather
than a one-off.
"""
        with open(path, "w") as f:
            f.write(content)

sys.exit(0)
PYEOF

python3 "$pyscript" "$repo_root" <<<"$input" || true

exit 0
