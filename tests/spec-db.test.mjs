// spec-db.test.mjs — behavior tests for scripts/spec-db.mjs, the SQLite system of
// record for the spec lifecycle (Phase 1 of the DB migration). Runs the real CLI
// against fixture repos via SPECDB_ROOT/SPECDB_PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "scripts", "spec-db.mjs");

const STATE_YAML = `states:
  - name: draft
    folder: draft
    valid_next: [ready, abandoned]
  - name: ready
    folder: ready
    valid_next: [in_progress, abandoned]
  - name: in_progress
    folder: in_progress
    valid_next: [waiting_verification, blocked, abandoned]
  - name: waiting_verification
    folder: waiting_verification
    valid_next: [finished, blocked, in_progress]
  - name: finished
    folder: finished
    valid_next: []
  - name: blocked
    folder: blocked
    valid_next: [ready, abandoned]
  - name: abandoned
    folder: abandoned
    valid_next: []
`;

function specMd({ id, status, deps = [], title = "T" + id, extraBody = "" }) {
  return `---
id: "${id}"
title: ${title}
status: ${status}
depends_on: [${deps.map((d) => `"${d}"`).join(", ")}]
verify_attempts: 0
history:
  - ${status} 2026-07-09T00:00:00Z
axis: ""
---
## Problem
p
## Acceptance Criteria
- When A, the system shall B.
## Verification
Run make verify.
${extraBody}`;
}

function makeFixture(t, specs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specdb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "workflows", "state.yaml"), STATE_YAML);
  for (const s of specs) {
    const d = path.join(dir, "specs", "p", s.status);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${s.id}-x.md`), specMd(s));
  }
  return dir;
}

function run(dir, ...args) {
  const res = spawnSync("node", ["--no-warnings", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, SPECDB_ROOT: dir, SPECDB_PATH: path.join(dir, "spec.db") },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("init + import loads specs, deps, history, and criteria snapshot", (t) => {
  const dir = makeFixture(t, [
    { id: "0001", status: "finished" },
    { id: "0002", status: "ready", deps: ["0001"] },
  ]);
  assert.equal(run(dir, "init").code, 0);
  const imp = run(dir, "import", "p");
  assert.equal(imp.code, 0, imp.stderr);
  assert.match(imp.stdout, /Imported 2 spec\(s\)/);
  const show = run(dir, "show", "p", "0002");
  assert.match(show.stdout, /depends_on: 0001/);
  assert.match(show.stdout, /· -> ready/);
});

test("list filters by status", (t) => {
  const dir = makeFixture(t, [
    { id: "0001", status: "finished" },
    { id: "0002", status: "ready" },
  ]);
  run(dir, "import", "p");
  const out = run(dir, "list", "p", "ready");
  assert.match(out.stdout, /p\/0002/);
  assert.doesNotMatch(out.stdout, /p\/0001/);
});

test("move enforces valid_next and records transition + ledger on terminal states", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "waiting_verification" }]);
  run(dir, "import", "p");
  const bad = run(dir, "move", "p", "0001", "ready");
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /illegal transition 'waiting_verification' -> 'ready'/);
  const ok = run(dir, "move", "p", "0001", "finished", "tester");
  assert.equal(ok.code, 0, ok.stderr);
  const ledger = run(dir, "ledger", "p", "finished");
  assert.match(ledger.stdout, /p\/0001\s+finished/);
  const show = run(dir, "show", "p", "0001");
  assert.match(show.stdout, /waiting_verification -> finished\s+\(tester\)/);
});

test("move into in_progress blocks on unfinished dependencies", (t) => {
  const dir = makeFixture(t, [
    { id: "0001", status: "ready" },
    { id: "0002", status: "ready", deps: ["0001"] },
  ]);
  run(dir, "import", "p");
  const bad = run(dir, "move", "p", "0002", "in_progress");
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /dependencies not finished: 0001/);
});

test("record-attempt increments attempts on FAIL only and stores the trace", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "waiting_verification" }]);
  run(dir, "import", "p");
  const tf = path.join(dir, "trace.md");
  fs.writeFileSync(tf, "raw trace body\n");
  assert.equal(run(dir, "record-attempt", "p", "0001", "FAIL", tf).code, 0);
  assert.match(run(dir, "show", "p", "0001").stdout, /attempts: 1[\s\S]*attempt-1: FAIL/);
  assert.equal(run(dir, "record-attempt", "p", "0001", "PASS").code, 0);
  assert.match(run(dir, "show", "p", "0001").stdout, /attempts: 1[\s\S]*attempt-2: PASS/);
});

test("drift detects criteria change between snapshots and is silent otherwise", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  run(dir, "move", "p", "0001", "in_progress"); // second snapshot, unchanged
  assert.match(run(dir, "drift", "p", "0001").stdout, /No drift/);
  // weaken criteria directly in the DB body, then transition to snapshot it
  const db = path.join(dir, "spec.db");
  const upd = spawnSync("node", ["--no-warnings", "-e", `
    const {DatabaseSync}=require('node:sqlite');
    const d=new DatabaseSync(${JSON.stringify(db)});
    d.prepare("UPDATE specs SET body_md=replace(body_md,'shall B','shall B or whatever') WHERE id='0001'").run();
  `], { encoding: "utf8" });
  assert.equal(upd.status, 0, upd.stderr);
  run(dir, "move", "p", "0001", "waiting_verification");
  const out = run(dir, "drift", "p", "0001");
  assert.equal(out.code, 2);
  assert.match(out.stdout, /DRIFT: graded sections changed/);
});

test("export reproduces frontmatter with DB-held history", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  run(dir, "move", "p", "0001", "in_progress");
  const out = run(dir, "export", "p", "0001");
  assert.match(out.stdout, /^---\nid: "0001"/);
  assert.match(out.stdout, /status: in_progress/);
  assert.match(out.stdout, /- in_progress 20/);
  assert.match(out.stdout, /## Acceptance Criteria/);
});

test("set records branch/pr and export carries them", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  assert.equal(run(dir, "set", "p", "0001", "branch", "feat/x").code, 0);
  assert.equal(run(dir, "set", "p", "0001", "pr", "https://example.com/pr/1").code, 0);
  assert.equal(run(dir, "set", "p", "0001", "status", "finished").code, 1); // not allowed
  const out = run(dir, "export", "p", "0001");
  assert.match(out.stdout, /branch: "feat\/x"/);
  assert.match(out.stdout, /pr: "https:\/\/example.com\/pr\/1"/);
});

test("legacy JSONL ledger is imported when present", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "finished" }]);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, "memory", "spec-ledger.jsonl"),
    '{"project":"p","id":"0009","title":"Old","outcome":"blocked","verify_attempts":2,"axis":"","timestamp":"2026-07-01T00:00:00Z"}\n');
  run(dir, "import", "p");
  const out = run(dir, "ledger", "p", "blocked");
  assert.match(out.stdout, /p\/0009\s+blocked\s+attempts=2/);
});
