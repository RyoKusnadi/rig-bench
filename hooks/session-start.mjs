#!/usr/bin/env node
// SessionStart hook — closes the memory lifecycle loop. evaluate-session.mjs
// (Stop) captures instincts and pre-compact.mjs (PreCompact) snapshots
// in-flight task state, but neither hook fires again to put that information
// back in front of the model. This hook injects both, before the user's
// first prompt, so a new session starts with the same context the last one
// ended with.
//
// Deliberately NOT task-type-aware (e.g. "load gotchas.md for bug-fix,
// conventions.md for new-feature"): SessionStart fires before the user's
// first prompt, so there's no workflow/task signal yet to filter on. That
// kind of task-aware retrieval already happens correctly elsewhere —
// operator.md Step 0 greps .claude/memory/ for keywords from the actual
// task once it's known. Duplicating that here would just be a second,
// out-of-sync mechanism for the same job.
//
// Respects RIGBENCH_DISABLED_HOOKS=session-start and
// RIGBENCH_SESSION_START_MAX_CHARS (default 8000) to cap injected context.
//
// Stdin: JSON with session_id, source ("startup"|"resume"|"compact"|"clear")
// Exit 0 always — this hook only adds context, it never blocks a session.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, runHook, complete } from './lib/hook-utils.mjs';

const HOOK_NAME = 'session-start';
const root = repoRoot(import.meta.url);
const MAX_CHARS = Number(process.env.RIGBENCH_SESSION_START_MAX_CHARS) || 8000;

runHook(HOOK_NAME, 'SessionStart', root, null, () => {
  const sections = [];

  // 1. Load high-confidence instincts — the pending ones seen most often
  // across sessions are the strongest signal something here is a real,
  // recurring pattern rather than a one-off. Top 3, by occurrence count.
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
          ranked.map((r) => `- [${r.keyword}, seen ${r.occurrences}x] ${r.snippet}`).join('\n') +
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
      const lastTest = (state.last_test_results || []).slice(-1)[0];
      sections.push(
        '## Resumed Context (from last PreCompact snapshot)\n' +
          `Branch: ${state.branch || '(unknown)'}\n` +
          `Last user request before compaction: ${lastMessage}\n` +
          `Active files: ${(state.active_files || []).join(', ') || '(none)'}\n` +
          `Last test result: ${lastTest ? `${lastTest.status} (${lastTest.tool})` : '(none captured)'}\n` +
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

  let contextInjection = sections.join('\n\n---\n\n');
  let truncated = false;
  if (contextInjection.length > MAX_CHARS) {
    // Truncate least-important-first: drop trailing sections (memory index,
    // then resumed context) before cutting the highest-priority instincts.
    while (sections.length > 1 && sections.join('\n\n---\n\n').length > MAX_CHARS) {
      sections.pop();
      truncated = true;
    }
    contextInjection = sections.join('\n\n---\n\n').slice(0, MAX_CHARS);
  }

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
  if (truncated) {
    console.error(`[session-start] context truncated to fit RIGBENCH_SESSION_START_MAX_CHARS=${MAX_CHARS}`);
  }

  complete();
});
