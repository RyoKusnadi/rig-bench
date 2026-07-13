// spec-db.test.mjs — behavior tests for scripts/spec-db.mjs, the SQLite system of
// record for the spec lifecycle (DB-only since the file-tree cutover; `import` remains
// the legacy file-ingest path and keeps its file fixtures). Runs the real CLI against
// fixture repos via SPECDB_ROOT/SPECDB_PATH.

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

test("drift detects out-of-band criteria tampering across a move; silent otherwise", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  run(dir, "move", "p", "0001", "in_progress"); // second snapshot, unchanged
  assert.match(run(dir, "drift", "p", "0001").stdout, /No drift/);
  // the tampering vector left after the file cutover: the body is weakened without
  // going through `edit body` (which would re-snapshot and become the new baseline) —
  // e.g. a direct SQL write. The next move snapshots the tampered body and drift flags it.
  const mk = spawnSync("node", ["--no-warnings", "--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(process.env.SPECDB_PATH);
    db.prepare("UPDATE specs SET body_md = replace(body_md, 'shall B.', 'shall B or whatever.') WHERE id='0001'").run();
  `], { encoding: "utf8", env: { ...process.env, SPECDB_PATH: path.join(dir, "spec.db") } });
  assert.equal(mk.status, 0, mk.stderr);
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

test("add allocates the next id from the DB sequence", (t) => {
  const dir = makeFixture(t, [{ id: "0002", status: "ready" }]);
  run(dir, "import", "p");
  const add = run(dir, "add", "p", "A new idea", "tooling");
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /p\/0003 created \(draft\)/);
  assert.match(run(dir, "list", "p", "draft").stdout, /p\/0003/);
  // and no spec file materializes anywhere — the DB is the only store
  assert.ok(!fs.existsSync(path.join(dir, "specs", "p", "draft")));
});

test("add records stub body, transition, and criteria snapshot; validates input", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  // a brand-new project needs no setup — the first add starts its sequence
  const add = run(dir, "add", "fresh-project", "Stub spec");
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /fresh-project\/0001 created \(draft\)/);
  const show = run(dir, "show", "fresh-project", "0001");
  assert.match(show.stdout, /status: draft/);
  assert.match(show.stdout, /· -> draft/); // NULL -> draft transition
  assert.match(show.stdout, /## Acceptance Criteria/); // template stub body
  // title validation: quotes and newlines can't round-trip the export format
  assert.equal(run(dir, "add", "fresh-project", 'bad "quoted" title').code, 1);
  assert.equal(run(dir, "add", "bad/project", "T").code, 1); // charset gate
});

test("dep add/rm maintain the dependency edges", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  run(dir, "add", "p", "First");
  run(dir, "add", "p", "Second");
  assert.equal(run(dir, "dep", "add", "p", "0002", "0001").code, 0);
  assert.match(run(dir, "show", "p", "0002").stdout, /depends_on: 0001/);
  assert.equal(run(dir, "dep", "add", "p", "0002", "0002").code, 1); // self-dep refused
  assert.equal(run(dir, "dep", "rm", "p", "0002", "0001").code, 0);
  assert.match(run(dir, "show", "p", "0002").stdout, /depends_on: \(none\)/);
  assert.equal(run(dir, "dep", "rm", "p", "0002", "0001").code, 1); // already gone
  assert.equal(run(dir, "dep", "add", "p", "9999", "0001").code, 1); // unknown spec
});

test("edit updates scalar fields in the DB", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  const edit = run(dir, "edit", "p", "0001", "title", "Renamed title");
  assert.equal(edit.code, 0, edit.stderr);
  assert.match(run(dir, "show", "p", "0001").stdout, /Renamed title/);
  run(dir, "edit", "p", "0001", "axis", "tooling");
  run(dir, "edit", "p", "0001", "pr", "https://example.com/pr/9");
  const out = run(dir, "export", "p", "0001");
  assert.match(out.stdout, /^axis: "tooling"$/m);
  assert.match(out.stdout, /^pr: "https:\/\/example\.com\/pr\/9"$/m);
});

test("edit body re-snapshots so the next move reports no drift", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  const bodyFile = path.join(dir, "new-body.md");
  fs.writeFileSync(bodyFile, "## Problem\nnew\n## Acceptance Criteria\n- When C, the system shall D.\n## Verification\nRun make verify.\n");
  assert.equal(run(dir, "edit", "p", "0001", "body", bodyFile).code, 0);
  run(dir, "move", "p", "0001", "in_progress");
  const drift = run(dir, "drift", "p", "0001");
  assert.equal(drift.code, 0, drift.stdout); // sanctioned edit = new baseline, no drift
  assert.match(drift.stdout, /No drift/);
  assert.match(run(dir, "show", "p", "0001").stdout, /shall D/);
});

test("edit rejects status and quote-containing values", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "ready" }]);
  run(dir, "import", "p");
  const st = run(dir, "edit", "p", "0001", "status", "finished");
  assert.equal(st.code, 1);
  assert.match(st.stderr, /use 'move'/);
  assert.equal(run(dir, "edit", "p", "0001", "title", 'has "quotes"').code, 1);
  assert.equal(run(dir, "edit", "p", "0001", "nope", "v").code, 1);
  assert.equal(run(dir, "edit", "p", "9999", "title", "T").code, 1);
});

test("delete removes DB rows (incl. attempts) but keeps ledger", (t) => {
  const dir = makeFixture(t, [
    { id: "0001", status: "waiting_verification" },
    { id: "0002", status: "ready" },
  ]);
  run(dir, "import", "p");
  const tf = path.join(dir, "trace.md");
  fs.writeFileSync(tf, "trace body\n");
  run(dir, "record-attempt", "p", "0001", "FAIL", tf);
  run(dir, "move", "p", "0001", "finished"); // writes a ledger row
  const del = run(dir, "delete", "p", "0001");
  assert.equal(del.code, 0, del.stderr);
  assert.equal(run(dir, "show", "p", "0001").code, 1);
  assert.equal(run(dir, "trace", "p", "0001").code, 1); // attempts gone with the spec
  assert.match(run(dir, "ledger", "p", "finished").stdout, /p\/0001\s+finished/); // ledger survives
  assert.equal(run(dir, "delete", "p", "0001").code, 1); // already gone → 404/exit 1
});

test("set verify_attempts resets the attempt budget (un-block flow) and validates input", (t) => {
  const dir = makeFixture(t, [{ id: "0001", status: "waiting_verification" }]);
  run(dir, "import", "p");
  const tf = path.join(dir, "trace.md");
  fs.writeFileSync(tf, "t\n");
  run(dir, "record-attempt", "p", "0001", "FAIL", tf);
  run(dir, "record-attempt", "p", "0001", "FAIL", tf);
  run(dir, "move", "p", "0001", "blocked");
  run(dir, "move", "p", "0001", "ready", "human");
  assert.equal(run(dir, "set", "p", "0001", "verify_attempts", "0").code, 0);
  assert.match(run(dir, "list", "p", "ready").stdout, /attempts=0/);
  assert.equal(run(dir, "set", "p", "0001", "verify_attempts", "nope").code, 1);
});

test("delete refuses while another spec depends on it, succeeds after the dependent is deleted", (t) => {
  const dir = makeFixture(t, [
    { id: "0001", status: "ready" },
    { id: "0002", status: "ready", deps: ["0001"] },
  ]);
  run(dir, "import", "p");
  const refuse = run(dir, "delete", "p", "0001");
  assert.equal(refuse.code, 1);
  assert.match(refuse.stderr, /depended on by 0002/);
  assert.equal(run(dir, "delete", "p", "0002").code, 0);
  assert.equal(run(dir, "delete", "p", "0001").code, 0);
  assert.match(run(dir, "list", "p").stdout, /No specs recorded/);
});

test("memory edit updates heading/body/spec_id in place", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  run(dir, "memory", "add", "gotchas", "Original heading", "original body", "0001");
  assert.equal(run(dir, "memory", "edit", "gotchas", "1", "heading", "Fixed heading").code, 0);
  assert.equal(run(dir, "memory", "edit", "gotchas", "1", "body", "fixed body").code, 0);
  assert.equal(run(dir, "memory", "edit", "gotchas", "1", "spec_id", "0002").code, 0);
  const show = run(dir, "memory", "show", "gotchas", "1");
  assert.match(show.stdout, /## Fixed heading/);
  assert.match(show.stdout, /fixed body/);
  assert.doesNotMatch(show.stdout, /original/);
  assert.match(run(dir, "memory", "gotchas", "0002").stdout, /\[spec 0002\]\s+Fixed heading/);
  assert.equal(run(dir, "memory", "edit", "gotchas", "1", "notebook", "x").code, 1); // immutable field
});

test("memory delete hides the entry from list/show/search/export", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  run(dir, "memory", "add", "lessons", "Keep me", "kept body");
  run(dir, "memory", "add", "lessons", "Drop me", "dropped body");
  const del = run(dir, "memory", "delete", "lessons", "2");
  assert.equal(del.code, 0, del.stderr);
  assert.match(del.stdout, /lessons#2 deleted/);
  assert.doesNotMatch(run(dir, "memory", "lessons").stdout, /Drop me/);
  assert.equal(run(dir, "memory", "show", "lessons", "2").code, 1);
  assert.match(run(dir, "memory", "search", "dropped").stdout, /No memory entries match/);
  assert.doesNotMatch(run(dir, "memory", "export", "lessons").stdout, /Drop me/);
  assert.match(run(dir, "memory", "export", "lessons").stdout, /Keep me/);
});

test("memory add after delete never reuses the deleted seq", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  run(dir, "memory", "add", "nb", "One", "b1");
  run(dir, "memory", "add", "nb", "Two", "b2");
  run(dir, "memory", "add", "nb", "Three", "b3");
  run(dir, "memory", "delete", "nb", "3");
  const add = run(dir, "memory", "add", "nb", "Four", "b4");
  assert.match(add.stdout, /nb#4 recorded/); // tombstone keeps seq 3 occupied
  assert.equal(run(dir, "memory", "show", "nb", "3").code, 1);
  assert.match(run(dir, "memory", "show", "nb", "4").stdout, /## Four/);
});

test("memory edit/delete on missing or already-deleted entry exits 1", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  run(dir, "memory", "add", "nb", "H", "b");
  assert.equal(run(dir, "memory", "edit", "nb", "9", "heading", "X").code, 1);
  assert.equal(run(dir, "memory", "delete", "nb", "9").code, 1);
  run(dir, "memory", "delete", "nb", "1");
  assert.equal(run(dir, "memory", "delete", "nb", "1").code, 1); // already deleted
  assert.equal(run(dir, "memory", "edit", "nb", "1", "heading", "X").code, 1); // tombstone not editable
});

test("openDb migrates a pre-'deleted'-column memory_entries table", (t) => {
  const dir = makeFixture(t);
  // build the old-shape table directly, bypassing the current SCHEMA
  const mk = spawnSync("node", ["--no-warnings", "--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(process.env.SPECDB_PATH);
    db.exec(\`CREATE TABLE memory_entries (
      notebook TEXT NOT NULL, seq INTEGER NOT NULL, heading TEXT NOT NULL,
      spec_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      PRIMARY KEY (notebook, seq));
      INSERT INTO memory_entries (notebook,seq,heading,body) VALUES ('nb',1,'Old entry','old body');\`);
  `], { encoding: "utf8", env: { ...process.env, SPECDB_PATH: path.join(dir, "spec.db") } });
  assert.equal(mk.status, 0, mk.stderr);
  // any CLI pass through openDb() must ALTER the table in place; delete then works
  assert.match(run(dir, "memory", "nb").stdout, /Old entry/);
  assert.equal(run(dir, "memory", "delete", "nb", "1").code, 0);
  assert.doesNotMatch(run(dir, "memory", "nb").stdout, /Old entry/);
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

test("research edit updates fields in place and keeps slug/seq stable", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "original body\n");
  run(dir, "research", "add", "how X works", "Understanding X", bodyFile, '["https://a.example"]');
  const edit = run(dir, "research", "edit", "1", "title", "Understanding X, revised");
  assert.equal(edit.code, 0, edit.stderr);
  assert.match(edit.stdout, /research#1 \(understanding-x\) updated/); // slug unchanged
  const show = run(dir, "research", "show", "understanding-x"); // still resolvable by old slug
  assert.match(show.stdout, /# Understanding X, revised/);
  fs.writeFileSync(bodyFile, "replacement body\n");
  run(dir, "research", "edit", "understanding-x", "body", bodyFile);
  run(dir, "research", "edit", "1", "topic", "how X really works");
  run(dir, "research", "edit", "1", "sources", '["https://b.example"]');
  const after = run(dir, "research", "show", "1");
  assert.match(after.stdout, /replacement body/);
  assert.match(after.stdout, /topic: how X really works/);
  assert.match(after.stdout, /https:\/\/b\.example/);
  assert.doesNotMatch(after.stdout, /original body/);
});

test("research edit validates field, sources JSON, and missing report", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "body\n");
  run(dir, "research", "add", "topic", "Title", bodyFile);
  assert.equal(run(dir, "research", "edit", "1", "slug", "new-slug").code, 1); // immutable field
  assert.equal(run(dir, "research", "edit", "1", "sources", "not json").code, 1);
  assert.equal(run(dir, "research", "edit", "1", "sources", '{"a":1}').code, 1); // not an array
  assert.equal(run(dir, "research", "edit", "1", "body", path.join(dir, "nope.md")).code, 1);
  assert.equal(run(dir, "research", "edit", "999", "title", "T").code, 1);
});

test("research delete removes the report and show/export fail afterward", (t) => {
  const dir = makeFixture(t);
  run(dir, "init");
  const bodyFile = path.join(dir, "report.md");
  fs.writeFileSync(bodyFile, "body\n");
  run(dir, "research", "add", "topic", "Title", bodyFile);
  const del = run(dir, "research", "delete", "title");
  assert.equal(del.code, 0, del.stderr);
  assert.match(del.stdout, /research#1 \(title\) deleted/);
  assert.equal(run(dir, "research", "show", "1").code, 1);
  assert.equal(run(dir, "research", "export", "title").code, 1);
  assert.equal(run(dir, "research", "delete", "1").code, 1); // already gone
  assert.match(run(dir, "research").stdout, /No research reports recorded/);
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
