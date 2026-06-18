// Shared helpers for Claude Code hooks. Plain Node.js (no deps) so hooks run
// identically on macOS, Linux, and Windows — the reason this harness moved
// off Bash (see todo.md "Cross-Platform Hook Migration").

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

export function repoRoot(importMetaUrl) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const hooksDir = dirname(fileURLToPath(importMetaUrl));
  return resolve(hooksDir, '..');
}

export function block(message, command) {
  console.log(`BLOCKED: ${message}`);
  if (command) console.log(`Command was: ${command}`);
  process.exit(2);
}

export function allow() {
  process.exit(0);
}
