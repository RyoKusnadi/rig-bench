// spec-trace.test.mjs — behavior tests for `spec-db.mjs trace`, the query view over
// verification traces (attempt rows recorded by `record-attempt`). Spec 0021, carried
// through the DB cutover: same list/show/diff surface, computed from rows instead of
// specs/<project>/.traces/ files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "spec-db.mjs");

// Fixture: a DB seeded with one spec per traced id, plus its recorded attempts.
function makeFixture(t, { project = "template", traces = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-trace-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "workflows", "state.yaml"), path.join(dir, "workflows", "state.yaml"));
  run(dir, "init");
  const ids = Object.keys(traces).sort();
  let seq = 0;
  for (const id of ids) {
    // allocate specs until the sequence reaches this id (ids in fixtures are small)
    while (seq < Number(id)) {
      run(dir, "add", project, `spec ${++seq}`);
    }
    for (const [n, body] of Object.entries(traces[id])) {
      const tf = path.join(dir, `t-${id}-${n}.md`);
      fs.writeFileSync(tf, body);
      const res = run(dir, "record-attempt", project, id, "FAIL", tf);
      assert.equal(res.code, 0, res.stderr);
    }
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

test("list mode reports specs with traces, attempt counts, and latest attempt", (t) => {
  const dir = makeFixture(t, {
    traces: {
      "0005": { "1": "solo\n" },
      "0021": { "1": "trace one\n", "2": "trace two\n" },
    },
  });
  const { code, stdout } = run(dir, "trace", "template");
  assert.equal(code, 0);
  assert.match(stdout, /Verification traces — template/);
  assert.match(stdout, /0021 — 2 attempt\(s\), latest: attempt-2/);
  assert.match(stdout, /0005 — 1 attempt\(s\), latest: attempt-1/);
});

test("list mode is a clean no-op when a project has no traces", (t) => {
  const dir = makeFixture(t, { traces: {} });
  const { code, stdout } = run(dir, "trace", "template");
  assert.equal(code, 0);
  assert.match(stdout, /No verification traces recorded|\(none\)/);
});

test("show mode with no attempt prints the latest attempt", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "OLD attempt\n", "2": "NEWEST attempt\n" } },
  });
  const { code, stdout } = run(dir, "trace", "template", "0021");
  assert.equal(code, 0);
  assert.match(stdout, /NEWEST attempt/);
  assert.doesNotMatch(stdout, /OLD attempt/);
});

test("show mode with an explicit attempt prints that attempt", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "FIRST body\n", "2": "SECOND body\n" } },
  });
  const { code, stdout } = run(dir, "trace", "template", "0021", "1");
  assert.equal(code, 0);
  assert.match(stdout, /FIRST body/);
  assert.doesNotMatch(stdout, /SECOND body/);
});

test("show mode fails clearly for an unknown spec id", (t) => {
  const dir = makeFixture(t, { traces: { "0021": { "1": "x\n" } } });
  const { code, stderr } = run(dir, "trace", "template", "9999");
  assert.equal(code, 1);
  assert.match(stderr, /no spec 9999/);
});

test("show mode fails clearly for a missing attempt number", (t) => {
  const dir = makeFixture(t, { traces: { "0021": { "1": "x\n" } } });
  const { code, stderr } = run(dir, "trace", "template", "0021", "7");
  assert.equal(code, 1);
  assert.match(stderr, /no attempt-7 trace for spec 0021/);
});

test("diff mode compares the last two attempts by default (trace diff)", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "verdict: FAIL\ncommon line\n", "2": "verdict: PASS\ncommon line\n" } },
  });
  const { code, stdout } = run(dir, "trace", "diff", "template", "0021");
  assert.equal(code, 0);
  assert.match(stdout, /attempt-1 vs attempt-2/);
  assert.match(stdout, /-verdict: FAIL/);
  assert.match(stdout, /\+verdict: PASS/);
});

test("diff mode accepts an explicit attempt pair (trace diff)", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "one\n", "2": "two\n", "3": "three\n" } },
  });
  const { code, stdout } = run(dir, "trace", "diff", "template", "0021", "1", "3");
  assert.equal(code, 0);
  assert.match(stdout, /attempt-1 vs attempt-3/);
  assert.match(stdout, /-one/);
  assert.match(stdout, /\+three/);
});

test("diff mode fails clearly with fewer than two attempts (trace diff)", (t) => {
  const dir = makeFixture(t, { traces: { "0021": { "1": "only\n" } } });
  const { code, stderr } = run(dir, "trace", "diff", "template", "0021");
  assert.equal(code, 1);
  assert.match(stderr, /fewer than two attempts/);
});
