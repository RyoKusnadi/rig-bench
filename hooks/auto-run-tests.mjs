#!/usr/bin/env node
// PostToolUse hook — after a Write/Edit to a source file, runs a scoped test
// command for that file's ecosystem and emits a compact JSON summary instead
// of letting a full test-runner transcript flow into context.
//
// Note: this hook's stdout is *additional* feedback shown to Claude — it does
// not (and cannot) shrink the Write/Edit tool's own result. It only replaces
// what would otherwise be a separate, manually-run, verbose test command.
//
// Stdin: JSON with tool_name and tool_input.file_path
// Exit 0 always — this hook informs, it never blocks.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, basename, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { readStdinJson, allow } from './lib/hook-utils.mjs';

const input = readStdinJson();
if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') allow();

const file = input.tool_input?.file_path || '';
if (!file || !existsSync(file)) allow();

const ext = extname(file).slice(1);
if (!['go', 'ts', 'tsx', 'js', 'jsx', 'py'].includes(ext)) allow();

const dir = dirname(file);

function findAncestor(startDir, marker) {
  let d = startDir;
  while (d !== '/' && d !== '.') {
    if (existsSync(`${d}/${marker}`)) return d;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

function emit(status, tool, exitCode, summary, firstError) {
  console.log(
    JSON.stringify({
      status,
      tool,
      exit_code: exitCode,
      summary: summary || 'no output',
      first_error: firstError || '',
    })
  );
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

if (ext === 'go') {
  const root = findAncestor(dir, 'go.mod');
  if (!root) allow();
  const pkgDir = relative(root, dir);
  const pkgPattern = pkgDir === '' || pkgDir === '.' ? './...' : `./${pkgDir}/...`;
  const { out, code } = runWithTimeout(`go test ${pkgPattern}`, root);
  const summary = (out.match(/^(ok|FAIL|---).*$/gm) || []).slice(-3).join(' ').slice(0, 200);
  const firstError = (out.match(/^\s*--- FAIL.*$|panic:.*$/m) || [''])[0].slice(0, 200);
  emit(code === 0 ? 'pass' : 'fail', 'go test', code, summary, firstError);
} else if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
  const root = findAncestor(dir, 'package.json');
  if (!root) allow();
  const pkgJson = readFileSync(`${root}/package.json`, 'utf8');
  if (!/"(test|jest|vitest)"/.test(pkgJson)) {
    emit('skip', 'npm test', 0, 'no test script found in package.json', '');
    process.exit(0);
  }
  const base = basename(file);
  const { out, code } = runWithTimeout(`npm test -- --testPathPattern='${base}'`, root);
  const summary = (out.match(/^.*?(tests:|passed|failed).*$/gim) || []).slice(-3).join(' ').slice(0, 200);
  const firstError = (out.match(/^.*(✕|FAIL ).*$/m) || [''])[0].slice(0, 200);
  emit(code === 0 ? 'pass' : 'fail', 'npm test', code, summary, firstError);
} else if (ext === 'py') {
  const root = findAncestor(dir, 'pyproject.toml') || findAncestor(dir, 'setup.py');
  if (!root) allow();
  const { out, code } = runWithTimeout(`pytest '${dir}' -q`, root);
  const summary = out.split('\n').slice(-3).join(' ').slice(0, 200);
  const firstError = (out.match(/^FAILED.*$|^E .*$/m) || [''])[0].slice(0, 200);
  emit(code === 0 ? 'pass' : 'fail', 'pytest', code, summary, firstError);
}

process.exit(0);
