#!/usr/bin/env node
// PostToolUse hook — logs every Bash command agents run to .claude/bash.log.
// Useful for auditing what agents actually executed.
// Stdin: JSON with tool_name, tool_input, tool_response

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readStdinJson, repoRoot, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Bash') allow();

const root = repoRoot(import.meta.url);
const logFile = join(root, '.claude', 'bash.log');
const maxLines = 500;

const cmd = input.tool_input?.command || '';
const resp = input.tool_response || {};
const exitCode = resp.exit_code ?? resp.exitCode ?? '?';
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

mkdirSync(dirname(logFile), { recursive: true });
appendFileSync(logFile, `[${ts}] exit=${exitCode} cmd=${cmd}\n`);

// Rotate: keep only the last `maxLines` lines to prevent unbounded growth
if (existsSync(logFile)) {
  const lines = readFileSync(logFile, 'utf8').split('\n');
  if (lines.length > maxLines + 100) {
    writeFileSync(logFile, lines.slice(-maxLines).join('\n'));
  }
}

allow();
