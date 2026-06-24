#!/usr/bin/env node
// PreCompact hook — snapshots the current git diff, branch, active files, and
// a best-effort extraction of recent user messages before the harness
// compacts context, so a long operator/inspector session doesn't lose track
// of its original request across a compaction.
//
// Also writes Tier 2 of the Code Checkpoint Architecture (the Working-Set
// Checkpoint): the actual content of files under active
// modification, so the next session can resume editing without re-Reading
// them from disk. Tier 1 (the structural map of the whole repo) is a
// separate, on-demand script — see scripts/code-map.mjs.
//
// Respects RIGBENCH_DISABLED_HOOKS=pre-compact. Note: the *trigger* for
// compaction (the context-usage threshold Claude Code fires this at) is an
// internal platform behavior, not something this hook script controls or
// can assert against — it only reacts once the PreCompact event arrives.
//
// Stdin: JSON with transcript_path, compaction_type ("manual"|"auto"), reason
// This hook is observation-only — it must ALWAYS exit 0. Exiting 2 would block
// compaction entirely, which is never the intent. runHook() already fails
// open on unexpected errors for the same reason.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot, complete, runHook } from './lib/hook-utils.mjs';

const HOOK_NAME = 'pre-compact';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

// Cap how many active files get a working-set entry, and how big each entry
// can be — this snapshot rides inside additionalContext at the next
// SessionStart, so it must stay bounded, not mirror the entire diff.
const MAX_WORKING_SET_FILES = 10;
const MAX_FULL_CONTENT_LINES = 200;
const MAX_DIFF_LINES = 60;

const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+\w+/gm;

function buildWorkingSetCheckpoint(activeFiles) {
  const files = [];
  for (const relPath of activeFiles.slice(0, MAX_WORKING_SET_FILES)) {
    const fullPath = join(root, relPath);
    if (!existsSync(fullPath)) continue; // deleted in this diff — nothing to snapshot

    let content;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');

    let diff = '';
    try {
      diff = execSync(`git diff HEAD -- ${JSON.stringify(relPath)}`, { cwd: root, encoding: 'utf8' })
        .split('\n')
        .slice(-MAX_DIFF_LINES)
        .join('\n');
    } catch {
      diff = '';
    }

    if (lines.length <= MAX_FULL_CONTENT_LINES) {
      files.push({ path: relPath, mode: 'full', content, diff });
    } else {
      const signatures = content.match(EXPORT_DECL_RE) || [];
      files.push({ path: relPath, mode: 'signatures', signatures, diff });
    }
  }
  return files;
}

runHook(HOOK_NAME, 'PreCompact', root, null, () => {
  const stateDir = join(root, '.claude', 'session-state');
  mkdirSync(stateDir, { recursive: true });

  const compactionType = input.compaction_type || 'unknown';
  const reason = input.reason || '';
  const transcriptPath = input.transcript_path || '';

  let branch = '';
  let diffStat = '';
  let activeFiles = [];
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
  try {
    activeFiles = execSync('git diff HEAD --name-only', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    activeFiles = [];
  }

  let lastTestResults = [];
  const lastTestPath = join(stateDir, 'last-test-results.json');
  try {
    if (existsSync(lastTestPath)) lastTestResults = JSON.parse(readFileSync(lastTestPath, 'utf8'));
  } catch {
    lastTestResults = [];
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
    active_files: activeFiles,
    last_test_results: lastTestResults,
    recent_user_messages: recentUserMessages,
  };

  writeFileSync(join(stateDir, 'compact.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

  const workingSet = {
    timestamp: ts,
    files: buildWorkingSetCheckpoint(activeFiles),
  };
  writeFileSync(join(stateDir, 'working-set-checkpoint.json'), `${JSON.stringify(workingSet, null, 2)}\n`);

  complete();
});
