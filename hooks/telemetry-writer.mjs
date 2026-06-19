#!/usr/bin/env node
// PostToolUse hook (matcher: Workflow) — writes one telemetry/runs/{timestamp}-
// {workflow}.jsonl file per Workflow tool call, append-only, one JSON object
// per agent() call in that run.
//
// Why a hook and not workflow-script code: workflow scripts (workflows/*.js)
// have no filesystem access — they can only return data, not write files.
// Every workflow already returns `token_telemetry` ([{label, tokens}]) and
// `escalations` in its result object specifically so this hook (which DOES
// have real fs access) can persist them after the fact. See "Token
// Telemetry" in README.md for the full rationale.
//
// Honesty note: `tokens` here is an output-token delta from the Workflow
// tool's `budget.spent()` API — the only token signal exposed to a workflow
// script. There is no `input_tokens`/`cache_read_tokens`/`cache_creation_tokens`
// breakdown available at this layer, so this hook does not fabricate those
// fields; it logs what's actually measurable (label, output-token delta,
// escalation events, outcome) rather than padding the schema to match
// todo.md's literal field list with invented numbers.
//
// Respects RIGBENCH_DISABLED_HOOKS=telemetry-writer.
// Stdin: JSON with tool_name, tool_input, tool_response
// Exit 0 always — this hook informs, it never blocks.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson, repoRoot, complete, runHook } from './lib/hook-utils.mjs';

const HOOK_NAME = 'telemetry-writer';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

runHook(HOOK_NAME, 'PostToolUse', root, input.tool_name, () => {
  if (input.tool_name !== 'Workflow') complete();

  // The Workflow tool's result is whatever the script `return`ed, surfaced
  // on tool_response — but the exact wrapper shape isn't part of this
  // hook's documented contract, so check the common possibilities rather
  // than assuming one.
  const resp = input.tool_response || {};
  const result = resp.result || resp.output || resp;
  if (!result || typeof result !== 'object') complete();

  const workflowName =
    result.pipeline ||
    (input.tool_input && (input.tool_input.name || input.tool_input.scriptPath)) ||
    'unknown';

  const timestamp = new Date().toISOString();
  const runsDir = join(root, 'telemetry', 'runs');
  const fileSafeWorkflow = String(workflowName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const logFile = join(runsDir, `${timestamp.replace(/[:.]/g, '-')}-${fileSafeWorkflow}.jsonl`);

  mkdirSync(runsDir, { recursive: true });

  const tokenLog = Array.isArray(result.token_telemetry) ? result.token_telemetry : [];
  const escalations = Array.isArray(result.escalations) ? result.escalations : [];

  const lines = [];
  for (const entry of tokenLog) {
    lines.push(JSON.stringify({
      timestamp,
      workflow_name: workflowName,
      label: entry.label,
      output_tokens: entry.tokens,
      outcome: result.outcome,
    }));
  }
  for (const esc of escalations) {
    lines.push(JSON.stringify({
      timestamp,
      workflow_name: workflowName,
      event: 'escalation',
      state: esc.state,
      from_tier: esc.from,
      to_tier: esc.to,
      reason: esc.reason,
    }));
  }
  // Always log a run-summary line even if there's no per-stage telemetry,
  // so `scripts/report.mjs` can count total runs per workflow.
  lines.push(JSON.stringify({
    timestamp,
    workflow_name: workflowName,
    event: 'run_summary',
    outcome: result.outcome,
    total_output_tokens: tokenLog.reduce((sum, e) => sum + (e.tokens || 0), 0),
    escalation_count: escalations.length,
  }));

  if (lines.length > 0) appendFileSync(logFile, lines.join('\n') + '\n');

  complete();
});
