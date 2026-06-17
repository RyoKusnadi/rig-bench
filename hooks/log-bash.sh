#!/usr/bin/env bash
# PostToolUse hook — logs every Bash command agents run to .claude/bash.log.
# Useful for auditing what agents actually executed.
# Stdin: JSON with tool_name, tool_input, tool_response

set -euo pipefail

input=$(cat)
log_file=".claude/bash.log"
max_lines=500

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)

if [[ "$tool" != "Bash" ]]; then
  exit 0
fi

cmd=$(echo "$input"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)
exit_code=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('tool_response',{}); print(r.get('exit_code', r.get('exitCode','?')))" 2>/dev/null || true)
ts=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$(dirname "$log_file")"
printf '[%s] exit=%s cmd=%s\n' "$ts" "${exit_code:-?}" "$cmd" >> "$log_file"

# Rotate: keep only the last $max_lines lines to prevent unbounded growth
line_count=$(wc -l < "$log_file" 2>/dev/null || echo 0)
if [ "$line_count" -gt $((max_lines + 100)) ]; then
  tail -n "$max_lines" "$log_file" > "${log_file}.tmp" && mv "${log_file}.tmp" "$log_file"
fi

exit 0
