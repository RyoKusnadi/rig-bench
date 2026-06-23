#!/usr/bin/env node
// PreToolUse hook (matcher: Read) — tracks files read per session and blocks
// once a session exceeds RIGBENCH_MAX_READS (default 50). A session
// reading more than ~50 files via the Read tool usually means an agent gave
// up on Grep-based retrieval and started loading the repo wholesale — this
// forces a pivot back to Grep instead of silently burning context.
//
// Telemetry is intentionally coarse: total Read count + a capped list of
// recently read files per session_id, in .claude/agent-telemetry.json. This
// is NOT a security boundary — it's a context-budget guardrail, and it only
// sees tool calls that actually go through this hook (i.e. only sessions
// that have this hook wired into their settings.json).
//
// Respects RIGBENCH_DISABLED_HOOKS=read-budget and RIGBENCH_MAX_READS
// (default 50) to raise the threshold for legitimately broad tasks.
//
// Stdin: JSON with tool_name, tool_input.file_path, session_id
// Exit 0 = allow  |  Exit 2 = block once over budget

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readStdinJson, repoRoot, block, allow, runHook, withFileLock } from './lib/hook-utils.mjs';

const HOOK_NAME = 'read-budget';
const input = readStdinJson();
const root = repoRoot(import.meta.url);
const MAX_READS = Number(process.env.RIGBENCH_MAX_READS) || 50;

runHook(HOOK_NAME, 'PreToolUse', root, input.tool_name, () => {
  if (input.tool_name !== 'Read') allow();

  const sessionId = input.session_id || 'unknown';
  const file = input.tool_input?.file_path || '';

  const telemetryPath = join(root, '.claude', 'agent-telemetry.json');

  // Concurrent sessions can call this hook at the same instant — lock around
  // the read-modify-write so two increments to the same session never race
  // and silently drop a count.
  const entry = withFileLock(telemetryPath, () => {
    let telemetry = { sessions: {} };
    try {
      if (existsSync(telemetryPath)) telemetry = JSON.parse(readFileSync(telemetryPath, 'utf8'));
    } catch {
      telemetry = { sessions: {} };
    }
    if (!telemetry.sessions) telemetry.sessions = {};

    const e = telemetry.sessions[sessionId] || { count: 0, files: [] };
    e.count += 1;
    if (file) {
      e.files.push(file);
      e.files = e.files.slice(-50); // diagnostics only — count above is the source of truth
    }
    telemetry.sessions[sessionId] = e;

    try {
      mkdirSync(dirname(telemetryPath), { recursive: true });
      writeFileSync(telemetryPath, JSON.stringify(telemetry, null, 2));
    } catch {
      // telemetry write failure shouldn't block the read itself
    }

    return e;
  });

  if (entry.count > MAX_READS) {
    block(
      `by read-budget hook: this session has Read ${entry.count} files (budget: ${MAX_READS}).\n` +
        'This usually means retrieval gave up on Grep and started loading the repo wholesale. ' +
        'Grep for the specific symbol/module you need instead of Reading more files directly. ' +
        'If this task genuinely needs to read this many files, raise RIGBENCH_MAX_READS.',
      file
    );
  }

  allow();
});
