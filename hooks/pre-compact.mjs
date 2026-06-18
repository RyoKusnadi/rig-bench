#!/usr/bin/env node
// PreCompact hook — snapshots the current git diff, branch, and a best-effort
// extraction of recent user messages before the harness compacts context, so
// the original task intent survives a long-running operator/inspector session.
//
// Stdin: JSON with transcript_path, compaction_type ("manual"|"auto"), reason
// This hook is observation-only — it must ALWAYS exit 0. Exiting 2 would block
// compaction entirely, which is not the intent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';

const input = readStdinJson();
const root = repoRoot(import.meta.url);
const stateDir = join(root, '.claude', 'session-state');
mkdirSync(stateDir, { recursive: true });

const compactionType = input.compaction_type || 'unknown';
const reason = input.reason || '';
const transcriptPath = input.transcript_path || '';

let branch = '';
let diffStat = '';
try {
  branch = execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // not a git repo or detached HEAD — leave blank
}
try {
  diffStat = execSync('git diff HEAD --stat', { cwd: root, encoding: 'utf8' }).split('\n').slice(-20).join('\n');
} catch {
  // nothing to diff — leave blank
}

const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

let recentUserMessages = [];
if (transcriptPath && existsSync(transcriptPath)) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter((l) => l.trim());
    for (const line of lines.slice(-50)) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.role !== 'user') continue;
      let content = entry.content || '';
      if (Array.isArray(content)) {
        content = content
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text || '')
          .join(' ');
      }
      if (typeof content === 'string' && content.trim()) {
        recentUserMessages.push(content.trim().slice(0, 500));
      }
    }
  } catch {
    // best-effort only
  }
}
recentUserMessages = recentUserMessages.slice(-5);

const snapshot = {
  timestamp: ts,
  compaction_type: compactionType,
  reason,
  branch,
  git_diff_stat: diffStat,
  recent_user_messages: recentUserMessages,
};

writeFileSync(join(stateDir, 'compact.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

process.exit(0);
