// spec-trace.test.mjs — behavior tests for scripts/spec-trace.sh, the query view over
// verification traces (specs/<project>/.traces/<id>/attempt-<n>.md). Runs the real
// script against fixture trees, matching how spec-scripts.test.mjs exercises the other
// dependency-free bash tools. Spec 0021.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "spec-trace.sh");

// A fixture repo root: specs/<project>/ lifecycle skeleton + an optional .traces tree.
// The script only needs specs/<project>/ to exist and does not read state.yaml, so the
// skeleton is deliberately minimal.
function makeFixture(t, { project = "template", traces = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-trace-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // scripts/spec-trace.sh resolves REPO_ROOT from its own location, so the script must
  // live under the fixture's scripts/ dir for cwd-independent resolution.
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "spec-trace.sh"));
  fs.chmodSync(path.join(dir, "scripts", "spec-trace.sh"), 0o755);

  fs.mkdirSync(path.join(dir, "specs", project), { recursive: true });

  for (const [id, attempts] of Object.entries(traces)) {
    const tdir = path.join(dir, "specs", project, ".traces", id);
    fs.mkdirSync(tdir, { recursive: true });
    for (const [n, body] of Object.entries(attempts)) {
      fs.writeFileSync(path.join(tdir, `attempt-${n}.md`), body);
    }
  }
  return dir;
}

function run(dir, args) {
  const res = spawnSync("bash", [path.join(dir, "scripts", "spec-trace.sh"), ...args], {
    encoding: "utf8",
    cwd: dir,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("list mode reports specs with traces, attempt counts, and latest attempt", (t) => {
  const dir = makeFixture(t, {
    traces: {
      "0021": { "1": "trace one\n", "2": "trace two\n" },
      "0005": { "1": "solo\n" },
    },
  });
  const { code, stdout } = run(dir, ["template"]);
  assert.equal(code, 0);
  assert.match(stdout, /Verification traces — template/);
  assert.match(stdout, /0021 — 2 attempt\(s\), latest: attempt-2/);
  assert.match(stdout, /0005 — 1 attempt\(s\), latest: attempt-1/);
});

test("list mode is a clean no-op when a project has no traces", (t) => {
  const dir = makeFixture(t, { traces: {} });
  const { code, stdout } = run(dir, ["template"]);
  assert.equal(code, 0);
  assert.match(stdout, /No verification traces recorded for 'template'\./);
});

test("show mode with no attempt prints the latest attempt", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "OLD attempt\n", "2": "NEWEST attempt\n" } },
  });
  const { code, stdout } = run(dir, ["template", "0021"]);
  assert.equal(code, 0);
  assert.match(stdout, /NEWEST attempt/);
  assert.doesNotMatch(stdout, /OLD attempt/);
});

test("show mode with an explicit attempt prints that attempt", (t) => {
  const dir = makeFixture(t, {
    traces: { "0021": { "1": "FIRST body\n", "2": "SECOND body\n" } },
  });
  const { code, stdout } = run(dir, ["template", "0021", "1"]);
  assert.equal(code, 0);
  assert.match(stdout, /FIRST body/);
  assert.doesNotMatch(stdout, /SECOND body/);
});

test("show mode fails clearly for an unknown spec id", (t) => {
  const dir = makeFixture(t, { traces: { "0021": { "1": "x\n" } } });
  const { code, stderr } = run(dir, ["template", "9999"]);
  assert.equal(code, 1);
  assert.match(stderr, /no verification trace for spec 9999/);
});

test("show mode fails clearly for a missing attempt number", (t) => {
  const dir = makeFixture(t, { traces: { "0021": { "1": "x\n" } } });
  const { code, stderr } = run(dir, ["template", "0021", "7"]);
  assert.equal(code, 1);
  assert.match(stderr, /no attempt-7 trace for spec 0021/);
});

test("fails clearly for a non-existent project", (t) => {
  const dir = makeFixture(t, { traces: {} });
  const { code, stderr } = run(dir, ["nonexistent"]);
  assert.equal(code, 1);
  assert.match(stderr, /specs\/nonexistent does not exist/);
});
