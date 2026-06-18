#!/usr/bin/env node
// PostToolUse hook — runs after every Bash call. Merges what used to be two
// separate processes (log-bash.mjs + summarize-cli-output.mjs) into one,
// since both fire on every single Bash call — halves the Node spawn
// overhead on the hot path without changing behavior.
//
// 1. Always appends an audit-trail line to .claude/bash.log.
// 2. If the command matches a known verbose tool, also emits a condensed
//    JSON pointer (counts, first failure) as supplementary hook feedback.
//
// Important: step 2 does NOT shrink or replace the original command's
// stdout — that has already been returned to Claude as the Bash tool's
// result by the time this hook runs. A PostToolUse hook's stdout is
// *additional* context, never a substitute for it (Claude Code has no
// "override tool_output" hook field). The only real lever against a 5,000
// line `go test`/`npm audit` transcript is the command invocation itself —
// see the "token-conscious command invocation" guidance in operator.md /
// inspector.md, which prefer `-q`/`--json`/`| tail -N` up front.
//
// Stdin: JSON with tool_name, tool_input.command, tool_response
// Exit 0 always — this hook informs, it never blocks.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readStdinJson, repoRoot, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Bash') allow();

const root = repoRoot(import.meta.url);
const cmd = input.tool_input?.command || '';

// ── 1. Audit log ───────────────────────────────────────────────────────
const logFile = join(root, '.claude', 'bash.log');
const maxLines = 500;
const resp = input.tool_response || {};
const exitCode = resp.exit_code ?? resp.exitCode ?? '?';
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

mkdirSync(dirname(logFile), { recursive: true });
appendFileSync(logFile, `[${ts}] exit=${exitCode} cmd=${cmd}\n`);

if (existsSync(logFile)) {
  const lines = readFileSync(logFile, 'utf8').split('\n');
  if (lines.length > maxLines + 100) {
    writeFileSync(logFile, lines.slice(-maxLines).join('\n'));
  }
}

// ── 2. Condensed summary for known verbose tools ─────────────────────────
const out = typeof resp === 'string' ? resp : resp.stdout ?? resp.output ?? '';

const emit = (command, summary) => {
  console.log(JSON.stringify({ command, summary }));
};

const count = (re) => (out.match(re) || []).length;
const firstMatch = (re) => (out.match(re) || [])[0];

if (/\bnpm audit\b/.test(cmd)) {
  const crit = firstMatch(/\d+ critical/) || '0 critical';
  const high = firstMatch(/\d+ high/) || '0 high';
  emit('npm audit', `${crit}, ${high}`);
} else if (/\bgo test\b/.test(cmd)) {
  const pass = count(/^ok/gm);
  const fail = count(/^FAIL/gm);
  const firstFail = (firstMatch(/^\s*--- FAIL.*$|panic:.*$/m) || '').slice(0, 200);
  emit('go test', `${pass} ok, ${fail} FAIL${firstFail ? `; first: ${firstFail}` : ''}`);
} else if (/\bgolangci-lint\b/.test(cmd)) {
  emit('golangci-lint', `${count(/^\S+\.go:\d+/gm)} findings`);
} else if (/\bpytest\b/.test(cmd)) {
  const summary = (out.match(/^\d+ (passed|failed|error).*$/gm) || []).pop();
  emit('pytest', (summary || 'no summary line found').slice(0, 200));
} else if (/\bcargo audit\b/.test(cmd)) {
  emit('cargo audit', `${count(/Vulnerability/g)} vulnerabilities`);
} else if (/\bpip-audit\b/.test(cmd)) {
  emit('pip-audit', `${count(/VULN/g)} matches`);
} else if (/\bgovulncheck\b/.test(cmd)) {
  emit('govulncheck', `${count(/^Vulnerability #/gm)} vulnerabilities`);
}

allow();
