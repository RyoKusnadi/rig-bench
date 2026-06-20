// Tests for hooks/pre-webfetch-security.mjs — PreToolUse SSRF guard for the
// WebFetch tool. Runs the hook as a real subprocess, same convention as
// tests/pre-tool-gatekeeper.test.js. Uses the exit-code protocol (block()/
// allow()) from hooks/lib/hook-utils.mjs.
//
// Deliberately avoids relying on live DNS/network for hostname-resolution
// cases — literal-IP, protocol, and parse-failure checks need no DNS, and the
// one resolution-dependent case uses "localhost" (which resolves to 127.0.0.1
// purely from /etc/hosts / the OS resolver's loopback entry, not the network).
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'pre-webfetch-security.mjs');

function runHook(url, env = {}) {
  const input = { tool_name: 'WebFetch', tool_input: { url } };
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('literal loopback IP (127.0.0.1) is blocked', () => {
  const result = runHook('http://127.0.0.1/secret');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /private\/reserved IP/);
});

test('literal cloud metadata IP (169.254.169.254) is blocked', () => {
  const result = runHook('http://169.254.169.254/latest/meta-data/');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /private\/reserved IP/);
});

test('literal private IP (10.x) is blocked', () => {
  const result = runHook('http://10.0.0.5/internal');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /private\/reserved IP/);
});

test('literal private IP (192.168.x) is blocked', () => {
  const result = runHook('http://192.168.1.1/');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /private\/reserved IP/);
});

test('non-http(s) protocol (file://) is blocked', () => {
  const result = runHook('file:///etc/passwd');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /protocol .* is not allowed/);
});

test('non-http(s) protocol (ftp://) is blocked', () => {
  const result = runHook('ftp://example.com/file');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /protocol .* is not allowed/);
});

test('unparseable URL is blocked', () => {
  const result = runHook('not a url at all');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /could not be parsed/);
});

test('localhost hostname resolves to loopback and is blocked', () => {
  const result = runHook('http://localhost/');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /private\/reserved IP|could not resolve/);
});

test('a public literal IP is allowed', () => {
  // 8.8.8.8 (Google public DNS) — literal IP, no DNS lookup needed, not in
  // any private/reserved range.
  const result = runHook('http://8.8.8.8/');
  assert.equal(result.status, 0);
});

test('RIGBENCH_DISABLED_HOOKS=pre-webfetch-security skips the hook entirely', () => {
  const result = runHook('http://127.0.0.1/secret', { RIGBENCH_DISABLED_HOOKS: 'pre-webfetch-security' });
  assert.equal(result.status, 0);
});

test('non-WebFetch tool_name is allowed without inspection', () => {
  const input = { tool_name: 'Read', tool_input: { file_path: 'x' } };
  const result = spawnSync('node', [HOOK_PATH], { input: JSON.stringify(input), encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0);
});
