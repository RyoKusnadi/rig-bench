#!/usr/bin/env node
// PostToolUse hook — after a Write/Edit to a source file, runs a scoped test
// command for that file's ecosystem and emits a compact JSON summary instead
// of letting a full test-runner transcript flow into context.
//
// Note: this hook's stdout is *additional* feedback shown to Claude — it does
// not (and cannot) shrink the Write/Edit tool's own result. It only replaces
// what would otherwise be a separate, manually-run, verbose test command.
//
// Also persists a rolling last-3 results to .claude/session-state/
// last-test-results.json, so pre-compact.mjs can fold recent test history
// into its snapshot for mid-session compaction recovery.
//
// Respects RIGBENCH_DISABLED_HOOKS=auto-run-tests.
//
// Stdin: JSON with tool_name and tool_input.file_path
// Exit 0 always — this hook informs, it never blocks.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, relative, extname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { readStdinJson, repoRoot, complete, runHook, withFileLock } from './lib/hook-utils.mjs';

const HOOK_NAME = 'auto-run-tests';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

function findAncestor(startDir, marker) {
  let d = startDir;
  for (;;) {
    if (existsSync(join(d, marker))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

// Single-quote a value for safe interpolation into a shell command string —
// closes the quote, escapes any embedded `'`, reopens it. Needed because
// `base`/`dir` come from a file path on disk, which (unlike a literal in the
// hook's own code) isn't guaranteed to be free of shell metacharacters.
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runWithTimeout(command, cwd) {
  try {
    const out = execSync(command, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, code: 0 };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    return { out, code: e.status ?? 1 };
  }
}

function recordResult(result) {
  const stateDir = join(root, '.claude', 'session-state');
  const path = join(stateDir, 'last-test-results.json');
  // Lock around the read-modify-write — concurrent Write/Edit calls in
  // parallel subagents can otherwise race and drop a result (same hazard as
  // read-budget's telemetry counters).
  withFileLock(path, () => {
    let history = [];
    try {
      if (existsSync(path)) history = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      history = [];
    }
    history.push({ ...result, timestamp: new Date().toISOString() });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path, JSON.stringify(history.slice(-3), null, 2));
  });
}

runHook(HOOK_NAME, 'PostToolUse', root, input.tool_name, () => {
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') complete();

  const file = input.tool_input?.file_path || '';
  if (!file || !existsSync(file)) complete();

  const ext = extname(file).slice(1);
  if (!['go', 'ts', 'tsx', 'js', 'jsx', 'py'].includes(ext)) complete();

  const dir = dirname(file);
  let result = null;

  if (ext === 'go') {
    const pkgRoot = findAncestor(dir, 'go.mod');
    if (!pkgRoot) complete();
    const pkgDir = relative(pkgRoot, dir);
    const pkgPattern = pkgDir === '' || pkgDir === '.' ? './...' : `./${pkgDir}/...`;
    const { out, code } = runWithTimeout(`go test ${pkgPattern}`, pkgRoot);
    const summary = (out.match(/^(ok|FAIL|---).*$/gm) || []).slice(-3).join(' ').slice(0, 200);
    const firstError = (out.match(/^\s*--- FAIL.*$|panic:.*$/m) || [''])[0].slice(0, 200);
    result = { status: code === 0 ? 'pass' : 'fail', tool: 'go test', exit_code: code, summary: summary || 'no output', first_error: firstError };
  } else if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    const pkgRoot = findAncestor(dir, 'package.json');
    if (!pkgRoot) complete();
    const pkgJson = readFileSync(join(pkgRoot, 'package.json'), 'utf8');
    if (!/"(test|jest|vitest)"/.test(pkgJson)) {
      result = { status: 'skip', tool: 'npm test', exit_code: 0, summary: 'no test script found in package.json', first_error: '' };
    } else {
      const base = basename(file);
      const { out, code } = runWithTimeout(`npm test -- --testPathPattern=${shellQuote(base)}`, pkgRoot);
      const summary = (out.match(/^.*?(tests:|passed|failed).*$/gim) || []).slice(-3).join(' ').slice(0, 200);
      const firstError = (out.match(/^.*(✕|FAIL ).*$/m) || [''])[0].slice(0, 200);
      result = { status: code === 0 ? 'pass' : 'fail', tool: 'npm test', exit_code: code, summary: summary || 'no output', first_error: firstError };
    }
  } else if (ext === 'py') {
    const pkgRoot = findAncestor(dir, 'pyproject.toml') || findAncestor(dir, 'setup.py');
    if (!pkgRoot) complete();
    const { out, code } = runWithTimeout(`pytest ${shellQuote(dir)} -q`, pkgRoot);
    const summary = out.split('\n').slice(-3).join(' ').slice(0, 200);
    const firstError = (out.match(/^FAILED.*$|^E .*$/m) || [''])[0].slice(0, 200);
    result = { status: code === 0 ? 'pass' : 'fail', tool: 'pytest', exit_code: code, summary: summary || 'no output', first_error: firstError };
  }

  if (result) {
    console.log(JSON.stringify(result));
    if (result.status !== 'skip') recordResult(result);
  }

  complete();
});
