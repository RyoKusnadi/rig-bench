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

test("drift detects file-side criteria tampering across a move; silent otherwise", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  run(dir, "move", "p", "0001", "in_progress"); // second snapshot, unchanged
  assert.match(run(dir, "drift", "p", "0001").stdout, /No drift/);
  // the realistic tampering vector: the implementer weakens the criteria ON DISK
  // mid-implementation; move must refresh from the file (dual-write source of truth)
  // before snapshotting, or the drift comparison sees two copies of the stale import
  const f = path.join(dir, "specs", "p", "ready", "0001-x.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("shall B.", "shall B or whatever."));
  run(dir, "move", "p", "0001", "waiting_verification");
  const out = run(dir, "drift", "p", "0001");
  assert.equal(out.code, 2);
  assert.match(out.stdout, /DRIFT: graded sections changed/);
  // and the DB body was reconciled to the file
  assert.match(run(dir, "show", "p", "0001").stdout, /shall B or whatever/);
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

test("memory notebooks mirror into the DB with spec-id links; re-import replaces", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "finished" }]);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, "memory", "lessons.md"),
    "# Lessons\n\npreamble ignored\n\n## 2026-07-01 — First lesson (spec 0001)\n\nbody one\n\n## 2026-07-02 — General lesson\n\nbody two\n");
  const imp = run(dir, "import", "p");
  assert.match(imp.stdout, /2 memory entries/);
  const bySpec = run(dir, "memory", "lessons", "0001");
  assert.match(bySpec.stdout, /\[spec 0001\]\s+2026-07-01 — First lesson/);
  assert.doesNotMatch(bySpec.stdout, /General lesson/);
  // mirror semantics: shrink the file, re-import, count follows the file
  fs.writeFileSync(path.join(dir, "memory", "lessons.md"),
    "# Lessons\n\n## 2026-07-03 — Only lesson now\n\nbody\n");
  run(dir, "import", "p");
  const all = run(dir, "memory", "lessons");
  assert.match(all.stdout, /Only lesson now/);
  assert.doesNotMatch(all.stdout, /First lesson/);
});

test("research add/list/show/search round-trip with slug and sources", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "## Overview\n\nX is a thing worth learning.\n");
  const add = run(dir, "research", "add", "how X works", "Understanding X", bodyFile,
    '["https://a.example","https://b.example"]');
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /research#1 \(understanding-x\) recorded/);
  assert.match(run(dir, "research").stdout, /research#1\s+\S+\s+Understanding X — how X works/);
  for (const key of ["1", "understanding-x"]) {
    const show = run(dir, "research", "show", key);
    assert.match(show.stdout, /# Understanding X/);
    assert.match(show.stdout, /topic: how X works/);
    assert.match(show.stdout, /https:\/\/a\.example[\s\S]*https:\/\/b\.example/);
    assert.match(show.stdout, /worth learning/);
  }
  assert.match(run(dir, "research", "search", "worth learning").stdout, /research#1/);
  assert.match(run(dir, "research", "search", "zzz").stdout, /No research reports match/);
  // slug dedupe on duplicate title
  const dup = run(dir, "research", "add", "another topic", "Understanding X", bodyFile);
  assert.match(dup.stdout, /research#2 \(understanding-x-2\) recorded/);
});

test("research add validates args and sources JSON", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "body\n");
  assert.equal(run(dir, "research", "add", "topic", "Title").code, 1); // missing body-file
  assert.equal(run(dir, "research", "add", "topic", "Title", path.join(dir, "nope.md")).code, 1);
  assert.equal(run(dir, "research", "add", "topic", "Title", bodyFile, "not json").code, 1);
  assert.equal(run(dir, "research", "add", "topic", "Title", bodyFile, '{"a":1}').code, 1); // not an array
  assert.equal(run(dir, "research", "show", "999").code, 1);
});

test("research export prints markdown", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "the body text\n");
  run(dir, "research", "add", "how X works", "Understanding X", bodyFile);
  run(dir, "research", "add", "how Y works", "Understanding Y", bodyFile);
  const all = run(dir, "research", "export");
  assert.match(all.stdout, /# Understanding X[\s\S]*the body text[\s\S]*# Understanding Y/);
  const one = run(dir, "research", "export", "1");
  assert.match(one.stdout, /# Understanding X/);
  assert.doesNotMatch(one.stdout, /Understanding Y/);
});

test("CLI dispatch runs when invoked through a symlinked path (main-module guard)", (t) => {
  // The old guard compared import.meta.url (realpath-resolved by Node's ESM loader)
  // against a naive file://argv[1]; through a symlink they differ and every command
  // became a silent no-op with exit 0. The symlink is constructed explicitly so this
  // fails against the old guard on any platform, not just symlinked-tmpdir macOS.
  const dir = makeFixture(t);
  const link = path.join(dir, "scripts-link");
  fs.symlinkSync(path.join(REPO, "scripts"), link);
  const res = spawnSync("node", ["--no-warnings", path.join(link, "spec-db.mjs"), "init"], {
    encoding: "utf8",
    env: { ...process.env, SPECDB_ROOT: dir, SPECDB_PATH: path.join(dir, "spec.db") },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Initialized spec\.db/);
  assert.ok(fs.existsSync(path.join(dir, "spec.db")), "DB file must actually be created");
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
