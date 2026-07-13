// post-spec-edit-check.test.mjs — routing tests for the PostToolUse spec-mutation hook.
// The hook watches Bash commands for spec-db.mjs mutations and runs the consistency
// check for the mutated project. Run via npm test. Spec 0007.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks", "post-spec-edit-check.mjs");

function runHook(stdin, cwd = ROOT) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
    cwd,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function eventFor(command) {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command } });
}

// A fixture repo whose DB contains a check-clean or check-dirty project, so the hook's
// child `spec-db.mjs check` run has something real to report against.
function makeFixture(t, { dirty }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-postedit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "workflows"));
  fs.mkdirSync(path.join(dir, "specs"));
  fs.copyFileSync(path.join(ROOT, "scripts", "spec-db.mjs"), path.join(dir, "scripts", "spec-db.mjs"));
  fs.copyFileSync(path.join(ROOT, "workflows", "state.yaml"), path.join(dir, "workflows", "state.yaml"));
  fs.copyFileSync(path.join(ROOT, "specs", "spec-template.md"), path.join(dir, "specs", "spec-template.md"));
  const db = (...a) =>
    spawnSync("node", ["--no-warnings", path.join(dir, "scripts", "spec-db.mjs"), ...a], {
      encoding: "utf8",
      cwd: dir,
    });
  db("init");
  db("add", "p", "Fixture spec");
  if (dirty) db("dep", "add", "p", "0001", "9999"); // dangling depends_on → check ISSUE
  return dir;
}

test("spec-db mutation on a clean project → check runs, exit 0", (t) => {
  const dir = makeFixture(t, { dirty: false });
  const out = runHook(eventFor('node scripts/spec-db.mjs edit p 0001 title "New title"'), dir);
  assert.equal(out.code, 0, out.stderr);
});

test("spec-db mutation on a project with issues → exit 2 with the report on stderr", (t) => {
  const dir = makeFixture(t, { dirty: true });
  const out = runHook(eventFor("node scripts/spec-db.mjs dep add p 0001 9999"), dir);
  assert.equal(out.code, 2);
  assert.match(out.stderr, /dangling-depends_on/);
});

for (const cmd of [
  "git status",
  "node scripts/spec-db.mjs list p",
  'node scripts/spec-db.mjs memory add lessons "H" "b"', // memory verb, not a spec verb
  'node scripts/spec-db.mjs research add topic "T" body.md',
  "node scripts/spec-db.mjs check p", // the check itself must not recurse
]) {
  test(`no check for non-mutating command: ${cmd}`, () => {
    const out = runHook(eventFor(cmd));
    assert.equal(out.code, 0);
    assert.equal(out.stderr, "");
  });
}

test("project failing the charset gate is ignored", () => {
  const out = runHook(eventFor("node scripts/spec-db.mjs edit ../evil 0001 title x"));
  assert.equal(out.code, 0);
  assert.equal(out.stderr, "");
});

test("fails open on garbage stdin", () => {
  const out = runHook("nope{{{");
  assert.equal(out.code, 0);
  assert.match(out.stderr, /fail-open/);
});

test("no command field → exit 0 silently", () => {
  const out = runHook(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  assert.equal(out.code, 0);
  assert.equal(out.stderr, "");
});
