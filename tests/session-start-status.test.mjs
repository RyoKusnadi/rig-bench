// session-start-status.test.mjs — behavior tests for the SessionStart status hook.
// Spawns the hook with cwd pointed at fixture repos (scripts/spec-db.mjs + state.yaml +
// a seeded spec.db), matching how post-spec-edit-check.test.mjs exercises hook+CLI
// integration. Spec 0017.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks", "session-start-status.mjs");

function runHook(cwd) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart" }),
    encoding: "utf8",
    cwd,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "workflows"));
  fs.copyFileSync(path.join(ROOT, "scripts", "spec-db.mjs"), path.join(dir, "scripts", "spec-db.mjs"));
  fs.copyFileSync(path.join(ROOT, "workflows", "state.yaml"), path.join(dir, "workflows", "state.yaml"));
  return dir;
}

function db(dir, ...args) {
  return spawnSync("node", ["--no-warnings", path.join(dir, "scripts", "spec-db.mjs"), ...args], {
    encoding: "utf8",
    cwd: dir,
  });
}

test("prints spec-db status output for each project at session start", (t) => {
  const dir = makeFixture(t);
  db(dir, "init");
  db(dir, "add", "alpha", "A");
  db(dir, "add", "beta", "B");
  const out = runHook(dir);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /Spec status — alpha/);
  assert.match(out.stdout, /Spec status — beta/);
});

test("empty DB (no specs recorded) → silent exit 0 (fail-open)", (t) => {
  const dir = makeFixture(t);
  db(dir, "init");
  const out = runHook(dir);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, "");
});

test("no spec.db at all → silent exit 0 (fail-open)", (t) => {
  const dir = makeFixture(t);
  const out = runHook(dir);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /fail-open/);
});

test("missing CLI → silent exit 0 (fail-open)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "spec.db"), ""); // DB present, CLI absent
  const out = runHook(dir);
  assert.equal(out.code, 0);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /fail-open/);
});

test("hook is registered under SessionStart in settings.json", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8"),
  );
  const entries = settings.hooks?.SessionStart ?? [];
  const commands = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command);
  assert.ok(
    commands.some((c) => c.includes("session-start-status.mjs")),
    `SessionStart hooks: ${JSON.stringify(commands)}`,
  );
});
