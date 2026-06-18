#!/usr/bin/env bash
# PostToolUse hook — after a Write/Edit to a source file, runs a scoped test
# command for that file's ecosystem and emits a compact JSON summary instead
# of letting a full test-runner transcript flow into context.
#
# Note: this hook's stdout is *additional* feedback shown to Claude — it does
# not (and cannot) shrink the Write/Edit tool's own result. It only replaces
# what would otherwise be a separate, manually-run, verbose test command.
#
# Stdin: JSON with tool_name and tool_input.file_path
# Exit 0 always — this hook informs, it never blocks.

set -uo pipefail

input=$(cat)

tool=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
file=$(echo "$input"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || true)

if [[ "$tool" != "Write" && "$tool" != "Edit" ]]; then
  exit 0
fi
if [[ -z "$file" || ! -f "$file" ]]; then
  exit 0
fi

ext="${file##*.}"
case "$ext" in
  go) ;;
  ts|tsx|js|jsx) ;;
  py) ;;
  *) exit 0 ;;
esac

dir=$(dirname "$file")

find_ancestor() {
  local d="$1" marker="$2"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/$marker" ]]; then
      echo "$d"
      return 0
    fi
    d=$(dirname "$d")
  done
  return 1
}

emit() {
  # $1=status $2=tool $3=exit_code $4=summary $5=first_error
  python3 -c "
import json
print(json.dumps({
  'status': '$1', 'tool': '$2', 'exit_code': $3,
  'summary': '''$4''', 'first_error': '''$5'''
}))
"
}

run_with_timeout() {
  # macOS ships neither `timeout` nor `gtimeout` by default — fall back to a
  # background-process + kill watcher when neither is available.
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 bash -c "$1" 2>&1
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 30 bash -c "$1" 2>&1
    return $?
  fi

  bash -c "$1" 2>&1 &
  local pid=$!
  ( sleep 30 && kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $rc
}

case "$ext" in
  go)
    root=$(find_ancestor "$dir" "go.mod") || { exit 0; }
    pkg_dir=$(python3 -c "import os; print(os.path.relpath('$dir', '$root'))")
    pkg_pattern="./..."
    [[ "$pkg_dir" != "." ]] && pkg_pattern="./${pkg_dir}/..."
    out=$(cd "$root" && run_with_timeout "go test ${pkg_pattern}")
    code=$?
    summary=$(echo "$out" | grep -E '^(ok|FAIL|---)' | tail -3 | tr '\n' ' ' | head -c 200)
    first_error=$(echo "$out" | grep -E '^\s*--- FAIL|panic:' | head -1 | head -c 200)
    status=$([ "$code" -eq 0 ] && echo "pass" || echo "fail")
    emit "$status" "go test" "$code" "${summary:-no output}" "${first_error:-}"
    ;;
  ts|tsx|js|jsx)
    root=$(find_ancestor "$dir" "package.json") || { exit 0; }
    base=$(basename "$file")
    if ! grep -qE '"(test|jest|vitest)"' "$root/package.json" 2>/dev/null; then
      emit "skip" "npm test" 0 "no test script found in package.json" ""
      exit 0
    fi
    out=$(cd "$root" && run_with_timeout "npm test -- --testPathPattern='${base}'")
    code=$?
    summary=$(echo "$out" | grep -Ei 'tests:|passed|failed' | tail -3 | tr '\n' ' ' | head -c 200)
    first_error=$(echo "$out" | grep -E '✕|FAIL ' | head -1 | head -c 200)
    status=$([ "$code" -eq 0 ] && echo "pass" || echo "fail")
    emit "$status" "npm test" "$code" "${summary:-no output}" "${first_error:-}"
    ;;
  py)
    root=$(find_ancestor "$dir" "pyproject.toml" || find_ancestor "$dir" "setup.py") || { exit 0; }
    out=$(cd "$root" && run_with_timeout "pytest '$dir' -q")
    code=$?
    summary=$(echo "$out" | tail -3 | tr '\n' ' ' | head -c 200)
    first_error=$(echo "$out" | grep -E '^FAILED|^E ' | head -1 | head -c 200)
    status=$([ "$code" -eq 0 ] && echo "pass" || echo "fail")
    emit "$status" "pytest" "$code" "${summary:-no output}" "${first_error:-}"
    ;;
esac

exit 0
