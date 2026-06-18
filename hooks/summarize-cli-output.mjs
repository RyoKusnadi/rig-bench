#!/usr/bin/env node
// PostToolUse hook — after a Bash call to a known verbose audit/test command,
// emits a condensed JSON pointer (counts, first failure) as supplementary
// hook feedback.
//
// Important: this does NOT shrink or replace the original command's stdout —
// that has already been returned to Claude as the Bash tool's result by the
// time this hook runs. It only adds a compact summary alongside it, so a
// long npm audit / go test transcript gets an extra "here's the gist" line
// instead of forcing a second manual re-read of the same output.
//
// Stdin: JSON with tool_name, tool_input.command, tool_response (stdout/output)
// Exit 0 always — this hook informs, it never blocks.

import { readStdinJson, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Bash') allow();

const cmd = input.tool_input?.command || '';
const resp = input.tool_response;
const out = typeof resp === 'string' ? resp : resp?.stdout ?? resp?.output ?? '';

const emit = (command, summary) => {
  console.log(JSON.stringify({ command, summary }));
};

const count = (re) => (out.match(re) || []).length;
const firstMatch = (re) => (out.match(re) || [])[0];

if (/\bnpm audit\b/.test(cmd)) {
  const crit = firstMatch(/\d+ critical/) || '0 critical';
  const high = firstMatch(/\d+ high/) || '0 high';
  emit('npm audit', `${crit}, ${high}`);
  process.exit(0);
}

if (/\bgo test\b/.test(cmd)) {
  const pass = count(/^ok/gm);
  const fail = count(/^FAIL/gm);
  const firstFail = (firstMatch(/^\s*--- FAIL.*$|panic:.*$/m) || '').slice(0, 200);
  emit('go test', `${pass} ok, ${fail} FAIL${firstFail ? `; first: ${firstFail}` : ''}`);
  process.exit(0);
}

if (/\bgolangci-lint\b/.test(cmd)) {
  const findings = count(/^\S+\.go:\d+/gm);
  emit('golangci-lint', `${findings} findings`);
  process.exit(0);
}

if (/\bpytest\b/.test(cmd)) {
  const summary = (out.match(/^\d+ (passed|failed|error).*$/gm) || []).pop();
  emit('pytest', (summary || 'no summary line found').slice(0, 200));
  process.exit(0);
}

if (/\bcargo audit\b/.test(cmd)) {
  emit('cargo audit', `${count(/Vulnerability/g)} vulnerabilities`);
  process.exit(0);
}

if (/\bpip-audit\b/.test(cmd)) {
  emit('pip-audit', `${count(/VULN/g)} matches`);
  process.exit(0);
}

if (/\bgovulncheck\b/.test(cmd)) {
  emit('govulncheck', `${count(/^Vulnerability #/gm)} vulnerabilities`);
  process.exit(0);
}

allow();
