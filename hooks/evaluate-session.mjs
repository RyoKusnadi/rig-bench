#!/usr/bin/env node
// Stop hook — scans the session transcript for our own failure vocabulary
// (GATE_FAIL, BLOCKED, ESCALATE, etc.) and captures recurring patterns as
// "instincts" under .claude/instincts/pending/. This is the Capture step (plus
// a cheap version of Validate, via an occurrence counter) from the
// Instincts v2 pipeline. Auto-promotion to subagents/rules/common/ happens
// via the /evolve command (see .claude/commands/evolve.md), not here.
//
// Respects RIGBENCH_DISABLED_HOOKS=evaluate-session.
//
// Stdin: JSON with transcript_path, session_id (Stop hook payload)
// This hook is purely observational — it must ALWAYS exit 0. Exiting 2 would
// force Claude to keep going instead of stopping, which is not the intent.
// runHook() already fails open on unexpected errors for the same reason.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readStdinJson, repoRoot, complete, runHook } from './lib/hook-utils.mjs';

const HOOK_NAME = 'evaluate-session';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

runHook(HOOK_NAME, 'Stop', root, null, () => {
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || 'unknown';

  if (!transcriptPath || !existsSync(transcriptPath)) complete();

  // This exact set is every `pipeline_gate`/finding-severity literal a
  // workflows/*.js STATES/TRANSITIONS table or an agent's structured output
  // schema can produce on a non-PASS path (see config/schemas/
  // {operator,inspector,scout}-output.schema.json and the STATES enums in
  // workflows/*.js) — i.e. our own failure vocabulary, not generic English
  // words like "fail" or "error" that would over-match prose. Add a keyword
  // here only when a new schema/workflow introduces a new gate literal.
  const KEYWORDS = /\b(GATE_FAIL|NO_TESTS|REGRESSION|EXAMPLE_FAIL|PREFLIGHT_FAIL|CRITICAL_BLOCK|SECRET_FOUND|BLOCKED|ESCALATE)\b/;
  const findings = []; // [keyword, snippet]

  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.role !== 'assistant') continue;

    const content = entry.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];

    for (const blk of blocks) {
      if (!blk || blk.type !== 'text') continue;
      const text = blk.text || '';
      const m = KEYWORDS.exec(text);
      if (m) {
        const snippet = text.slice(Math.max(0, m.index - 80), m.index + 160).trim();
        findings.push([m[1], snippet]);
      }
    }
  }

  if (!findings.length) complete();

  const instinctsDir = join(root, '.claude', 'instincts', 'pending');
  mkdirSync(instinctsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const seenThisRun = new Set();

  for (const [keyword, snippet] of findings) {
    const key = `${keyword}|${snippet.slice(0, 120)}`;
    const h = createHash('sha1').update(key).digest('hex').slice(0, 8);
    if (seenThisRun.has(h)) continue;
    seenThisRun.add(h);

    const path = join(instinctsDir, `INST-${h}.md`);

    if (existsSync(path)) {
      let body = readFileSync(path, 'utf8');
      const m = body.match(/^occurrences:\s*(\d+)/m);
      if (m) {
        body = body.replace(/^occurrences:\s*\d+/m, `occurrences: ${parseInt(m[1], 10) + 1}`);
      } else {
        body = body.replace('---\n', '---\noccurrences: 2\n');
      }
      if (/^last_seen:.*$/m.test(body)) {
        body = body.replace(/^last_seen:.*$/m, `last_seen: ${today}`);
      } else {
        body = body.replace('---\n', `---\nlast_seen: ${today}\n`);
      }
      writeFileSync(path, body);
    } else {
      const content = `---
name: inst-${h}
keyword: ${keyword}
confidence: 0.3
occurrences: 1
first_seen: ${today}
last_seen: ${today}
session_id: ${sessionId}
---

Captured by evaluate-session.mjs after the ${keyword} verdict appeared in a session
transcript.

## Snippet

> ${snippet}

## Notes

Promote to \`subagents/rules/common/\` (via \`/evolve\`) once this instinct has
recurred enough times across distinct sessions to be confident it's a real,
generalizable pattern rather than a one-off.
`;
      writeFileSync(path, content);
    }
  }

  complete();
});
