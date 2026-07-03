// post-spec-edit-check.test.mjs — routing tests for the PostToolUse spec-edit hook.
// Run via npm test. Spec 0007.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks", "post-spec-edit-check.mjs");

function runHook(stdin) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
    cwd: ROOT,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function eventFor(file_path) {
  return JSON.stringify({ tool_name: "Edit", tool_input: { file_path } });
}

test("spec-folder edit triggers the check (clean tree → exit 0)", () => {
  const out = runHook(eventFor("specs/template/finished/0001-state-sync-check.md"));
  assert.equal(out.code, 0, out.stderr);
});

test("absolute spec path also triggers (clean tree → exit 0)", () => {
  const out = runHook(eventFor(path.join(ROOT, "specs/template/finished/0001-state-sync-check.md")));
  assert.equal(out.code, 0, out.stderr);
});

for (const p of [
  "specs/README.md",
  "specs/spec-template.md",
  "memory/lessons.md",
  "scripts/check-specs.sh",
  "specs/template/finished/not-markdown.txt",
]) {
  test(`no check for non-spec path: ${p}`, () => {
    const out = runHook(eventFor(p));
    assert.equal(out.code, 0);
    assert.equal(out.stderr, "");
  });
}

test("fails open on garbage stdin", () => {
  const out = runHook("nope{{{");
  assert.equal(out.code, 0);
  assert.match(out.stderr, /fail-open/);
});

test("no file_path field → exit 0 silently", () => {
  const out = runHook(JSON.stringify({ tool_name: "Edit", tool_input: {} }));
  assert.equal(out.code, 0);
  assert.equal(out.stderr, "");
});
