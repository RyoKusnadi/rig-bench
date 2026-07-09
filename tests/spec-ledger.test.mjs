// spec-ledger.test.mjs — behavior tests for scripts/spec-ledger.sh, the append-only
// structured record of terminal spec outcomes (memory/spec-ledger.jsonl). Spec 0025.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "spec-ledger.sh");

function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "spec-ledger.sh"));
  fs.chmodSync(path.join(dir, "scripts", "spec-ledger.sh"), 0o755);
  return dir;
}

function run(dir, args) {
  const res = spawnSync("bash", [path.join(dir, "scripts", "spec-ledger.sh"), ...args], {
    encoding: "utf8",
    cwd: dir,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function ledgerPath(dir) {
  return path.join(dir, "memory", "spec-ledger.jsonl");
}

test("append writes a well-formed line and creates memory/ if absent", (t) => {
  const dir = makeFixture(t);
  const { code, stdout } = run(dir, ["append", "template", "0021", "Trace capture", "finished", "0"]);
  assert.equal(code, 0);
  assert.match(stdout, /Recorded: template\/0021 — finished/);

  const contents = fs.readFileSync(ledgerPath(dir), "utf8").trim();
  const record = JSON.parse(contents);
  assert.equal(record.project, "template");
  assert.equal(record.id, "0021");
  assert.equal(record.title, "Trace capture");
  assert.equal(record.outcome, "finished");
  assert.equal(record.verify_attempts, 0);
  assert.equal(record.axis, "");
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("append accepts an optional axis argument and records it", (t) => {
  const dir = makeFixture(t);
  const { code } = run(dir, ["append", "template", "0027", "Axis tag", "finished", "0", "verification-loop"]);
  assert.equal(code, 0);
  const record = JSON.parse(fs.readFileSync(ledgerPath(dir), "utf8").trim());
  assert.equal(record.axis, "verification-loop");
});

test("append escapes double quotes in the title so the line stays valid JSON", (t) => {
  const dir = makeFixture(t);
  run(dir, ["append", "template", "0100", 'Title with "quotes" inside', "finished", "1"]);
  const contents = fs.readFileSync(ledgerPath(dir), "utf8").trim();
  const record = JSON.parse(contents); // throws if malformed
  assert.equal(record.title, 'Title with "quotes" inside');
});

test("append rejects an outcome other than finished/blocked", (t) => {
  const dir = makeFixture(t);
  const { code, stderr } = run(dir, ["append", "template", "0001", "x", "shipped", "0"]);
  assert.equal(code, 1);
  assert.match(stderr, /outcome must be 'finished' or 'blocked'/);
});

test("append rejects a non-numeric verify_attempts", (t) => {
  const dir = makeFixture(t);
  const { code, stderr } = run(dir, ["append", "template", "0001", "x", "finished", "abc"]);
  assert.equal(code, 1);
  assert.match(stderr, /verify_attempts must be a non-negative integer/);
});

test("list with no arguments prints every record", (t) => {
  const dir = makeFixture(t);
  run(dir, ["append", "template", "0021", "A", "finished", "0"]);
  run(dir, ["append", "other", "0002", "B", "blocked", "2"]);
  const { code, stdout } = run(dir, ["list"]);
  assert.equal(code, 0);
  assert.match(stdout, /"id":"0021"/);
  assert.match(stdout, /"id":"0002"/);
});

test("list filters by project", (t) => {
  const dir = makeFixture(t);
  run(dir, ["append", "template", "0021", "A", "finished", "0"]);
  run(dir, ["append", "other", "0002", "B", "blocked", "2"]);
  const { code, stdout } = run(dir, ["list", "template"]);
  assert.equal(code, 0);
  assert.match(stdout, /"id":"0021"/);
  assert.doesNotMatch(stdout, /"id":"0002"/);
});

test("list filters by project and outcome together", (t) => {
  const dir = makeFixture(t);
  run(dir, ["append", "template", "0021", "A", "finished", "0"]);
  run(dir, ["append", "template", "0099", "B", "blocked", "2"]);
  const { code, stdout } = run(dir, ["list", "template", "blocked"]);
  assert.equal(code, 0);
  assert.match(stdout, /"id":"0099"/);
  assert.doesNotMatch(stdout, /"id":"0021"/);
});

test("list is a clean no-op before any record has been written", (t) => {
  const dir = makeFixture(t);
  const { code, stdout } = run(dir, ["list"]);
  assert.equal(code, 0);
  assert.match(stdout, /No spec outcomes recorded yet\./);
});

test("list with a filter that matches nothing says so and exits zero", (t) => {
  const dir = makeFixture(t);
  run(dir, ["append", "template", "0021", "A", "finished", "0"]);
  const { code, stdout } = run(dir, ["list", "nonexistent-project"]);
  assert.equal(code, 0);
  assert.match(stdout, /No matching spec outcomes recorded\./);
});
