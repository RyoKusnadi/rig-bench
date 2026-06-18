#!/usr/bin/env node
// SessionStart hook — closes the memory lifecycle loop. evaluate-session.mjs
// (Stop) captures instincts and pre-compact.mjs (PreCompact) snapshots
// in-flight task state, but neither hook fires again to put that information
// back in front of the model. This hook injects both, before the user's
// first prompt, so a new session starts with the same context the last one
// ended with.
//
// Stdin: JSON with session_id, source ("startup"|"resume"|"compact"|"clear")
// Exit 0 always — this hook only adds context, it never blocks a session.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/hook-utils.mjs';

const root = repoRoot(import.meta.url);

const sections = [];

// 1. Load high-confidence instincts — the pending ones seen most often across
// sessions are the strongest signal something here is a real, recurring
// pattern rather than a one-off. Top 3, by occurrence count.
const instinctsDir = join(root, '.claude', 'instincts', 'pending');
if (existsSync(instinctsDir)) {
  const files = readdirSync(instinctsDir).filter((f) => f.endsWith('.md'));
  const ranked = files
    .map((f) => {
      const body = readFileSync(join(instinctsDir, f), 'utf8');
      const occurrences = parseInt((body.match(/^occurrences:\s*(\d+)/m) || [, '0'])[1], 10);
      const keyword = (body.match(/^keyword:\s*(.+)$/m) || [, ''])[1].trim();
      const snippet = (body.match(/^>\s*(.+)$/m) || [, ''])[1].trim();
      return { occurrences, keyword, snippet };
    })
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 3);

  if (ranked.length) {
    sections.push(
      '## Active Project Instincts\n' +
        ranked
          .map((r) => `- [${r.keyword}, seen ${r.occurrences}x] ${r.snippet}`)
          .join('\n') +
        '\n\nRun `/evolve` once any of these recur enough to promote into a permanent rule under subagents/rules/common/.'
    );
  }
}

// 2. Load the pre-compact snapshot, if resuming a session that compacted
// mid-task — the closest available proxy for "what was I doing".
const compactState = join(root, '.claude', 'session-state', 'compact.json');
if (existsSync(compactState)) {
  try {
    const state = JSON.parse(readFileSync(compactState, 'utf8'));
    const lastMessage = (state.recent_user_messages || []).slice(-1)[0] || '(none captured)';
    sections.push(
      '## Resumed Context (from last PreCompact snapshot)\n' +
        `Branch: ${state.branch || '(unknown)'}\n` +
        `Last user request before compaction: ${lastMessage}\n` +
        `Diff in flight:\n${state.git_diff_stat || '(none)'}`
    );
  } catch {
    // malformed snapshot — skip rather than inject garbage
  }
}

// 3. Point at the project memory index — operator already reads this at
// Step 0 of BUILD/REFACTOR/DOCS, but surfacing it at SessionStart means a
// plain conversational turn (no agent dispatch) still sees it.
const memoryIndex = join(root, '.claude', 'memory', 'MEMORY.md');
if (existsSync(memoryIndex)) {
  sections.push(`## Project Memory Index\n${readFileSync(memoryIndex, 'utf8').trim()}`);
}

const contextInjection = sections.join('\n\n---\n\n');

if (contextInjection) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextInjection,
      },
    })
  );
}

process.exit(0);
