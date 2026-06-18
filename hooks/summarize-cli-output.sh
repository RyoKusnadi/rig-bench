#!/usr/bin/env bash
# PostToolUse hook — after a Bash call to a known verbose audit/test command,
# emits a condensed JSON pointer (counts, first failure) as supplementary
# hook feedback.
#
# Important: this does NOT shrink or replace the original command's stdout —
# that has already been returned to Claude as the Bash tool's result by the
# time this hook runs. It only adds a compact summary alongside it, so a
# long npm audit / go test transcript gets an extra "here's the gist" line
# instead of forcing a second manual re-read of the same output.
#
# Stdin: JSON with tool_name, tool_input.command, tool_response (stdout/output)
# Exit 0 always — this hook informs, it never blocks.

set -uo pipefail

input=$(cat)

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
cmd=$(echo "$input"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)
out=$(echo "$input"  | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('tool_response', {})
if isinstance(r, dict):
    print(r.get('stdout', r.get('output', '')))
else:
    print(r)
" 2>/dev/null || true)

if [[ "$tool" != "Bash" ]]; then
  exit 0
fi

emit() {
  python3 -c "
import json
print(json.dumps({'command': '''$1''', 'summary': '''$2'''}))
"
}

if echo "$cmd" | grep -qE '\bnpm audit\b'; then
  crit=$(echo "$out" | grep -oE '[0-9]+ critical' | head -1)
  high=$(echo "$out" | grep -oE '[0-9]+ high' | head -1)
  emit "npm audit" "${crit:-0 critical}, ${high:-0 high}"
  exit 0
fi

if echo "$cmd" | grep -qE '\bgo test\b'; then
  pass=$(echo "$out" | grep -c '^ok' || true)
  fail=$(echo "$out" | grep -c '^FAIL' || true)
  first_fail=$(echo "$out" | grep -E '^\s*--- FAIL|panic:' | head -1 | head -c 200)
  emit "go test" "${pass} ok, ${fail} FAIL${first_fail:+; first: $first_fail}"
  exit 0
fi

if echo "$cmd" | grep -qE '\bgolangci-lint\b'; then
  count=$(echo "$out" | grep -cE '^\S+\.go:[0-9]+' || true)
  emit "golangci-lint" "${count} findings"
  exit 0
fi

if echo "$cmd" | grep -qE '\bpytest\b'; then
  summary=$(echo "$out" | grep -E '^[0-9]+ (passed|failed|error)' | tail -1 | head -c 200)
  emit "pytest" "${summary:-no summary line found}"
  exit 0
fi

if echo "$cmd" | grep -qE '\bcargo audit\b'; then
  count=$(echo "$out" | grep -coE 'Vulnerability' || true)
  emit "cargo audit" "${count} vulnerabilities"
  exit 0
fi

if echo "$cmd" | grep -qE '\bpip-audit\b'; then
  count=$(echo "$out" | grep -coE 'VULN' || true)
  emit "pip-audit" "${count} matches"
  exit 0
fi

if echo "$cmd" | grep -qE '\bgovulncheck\b'; then
  count=$(echo "$out" | grep -coE '^Vulnerability #' || true)
  emit "govulncheck" "${count} vulnerabilities"
  exit 0
fi

exit 0
