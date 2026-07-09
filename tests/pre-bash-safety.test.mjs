// pre-bash-safety.test.mjs — spawns the hook with sample PreToolUse events and asserts on
// its decision output. Run: npm test (node --test tests/). Spec 0004.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "hooks",
  "pre-bash-safety.mjs",
);

function runHook(stdin) {
  const res = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function eventFor(command) {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command } });
}

function decisionOf(out) {
  if (!out.stdout.trim()) return null;
  return JSON.parse(out.stdout).hookSpecificOutput?.permissionDecision ?? null;
}

const MUST_ASK = [
  "git push --force origin main",
  "git push -f",
  "git push --force-with-lease origin main",
  "cd repo && git reset --hard HEAD~3",
  "git branch -D feature-x",
  "git branch --delete --force feature-x",
  "git clean -fd",
  // extended ask-first patterns
  "rm -rf src",
  "rm -r -f ./build",
  "sudo rm -rf /var/data",
  "rm --recursive --force dist",
  "git stash drop",
  "git stash clear",
  "cd repo && git stash drop stash@{1}",
  "git push origin :feature",
  "git push origin --delete feature",
  "git checkout -- .",
  "git checkout main -- src/app.js",
  "git restore .",
  "git restore --staged --worktree file.txt",
];

const MUST_ALLOW = [
  "git status",
  "git push origin main",
  "git reset --soft HEAD~1",
  "git branch -d merged-branch",
  "git clean -fdX", // the Makefile's own clean — ignored files only
  "echo 'git push --force' > notes.txt && cat notes.txt", // matching here is acceptable either way; see below
  "ls -la",
  // extended ask-first patterns
  "rm -rf /tmp/scratch",
  "rm -rf /private/tmp/build-cache",
  "rm -rf node_modules",
  "rm -rf ./node_modules",
  "rm -f single-file.txt", // force without recursive
  "rm -r olddir", // recursive without force
  "git stash list",
  "git stash pop",
  "git push origin main:main", // full refspec — not a deletion
  "git checkout -b topic",
  "git checkout --track origin/topic",
  "git restore --staged file.txt", // unstage only — no working-tree discard
];

for (const cmd of MUST_ASK) {
  test(`asks on: ${cmd}`, () => {
    const out = runHook(eventFor(cmd));
    assert.equal(out.code, 0);
    assert.equal(decisionOf(out), "ask");
  });
}

// The echo case above is a known false-positive class (the hook matches raw strings, and
// asking on a harmless echo is an acceptable cost of the conservative design) — so it is
// exercised separately, asserting only that the hook doesn't crash, not which way it decides.
for (const cmd of MUST_ALLOW.filter((c) => !c.startsWith("echo"))) {
  test(`allows: ${cmd}`, () => {
    const out = runHook(eventFor(cmd));
    assert.equal(out.code, 0);
    assert.equal(decisionOf(out), null, `expected no decision output for: ${cmd}`);
  });
}

test("does not crash on string-literal false-positive class", () => {
  const out = runHook(eventFor("echo 'git push --force' > notes.txt"));
  assert.equal(out.code, 0);
});

test("fails open on garbage stdin", () => {
  const out = runHook("this is not json{{{");
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), "");
  assert.match(out.stderr, /fail-open/);
});

test("fails open on empty stdin", () => {
  const out = runHook("");
  assert.equal(out.code, 0);
});

test("no decision when command field is absent", () => {
  const out = runHook(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), "");
});
