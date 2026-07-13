// spec-scripts.test.mjs — behavior tests for the lifecycle views that run over spec.db
// (`spec-db.mjs check`, `status`, `metrics`) plus check-state-sync.sh (the one remaining
// file-based consistency script). Run via npm test.
//
// Each test builds a throwaway repo skeleton (scripts/ + workflows/state.yaml +
// specs/spec-template.md + a minimal in-sync specs/README.md) in a temp dir and seeds
// specs through the real CLI — add/edit/dep/move — so the fixtures exercise the same
// write paths production uses. States the CLI can't legally produce (unknown status,
// finished-depends-on-unfinished) are seeded with direct SQL, which is exactly the
// out-of-band tampering `check` exists to catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-scripts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "workflows"));
  for (const s of ["check-state-sync.sh", "spec-db.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", s), path.join(dir, "scripts", s));
    fs.chmodSync(path.join(dir, "scripts", s), 0o755);
  }
  fs.copyFileSync(
    path.join(ROOT, "workflows", "state.yaml"),
    path.join(dir, "workflows", "state.yaml"),
  );
  fs.mkdirSync(path.join(dir, "specs"));
  // The quality lint derives its required-section list from the template.
  fs.copyFileSync(
    path.join(ROOT, "specs", "spec-template.md"),
    path.join(dir, "specs", "spec-template.md"),
  );
  // A minimal specs/README.md that agrees with the real state.yaml, so
  // check-state-sync.sh passes in the fixture repo by default.
  const states = fs
    .readFileSync(path.join(dir, "workflows", "state.yaml"), "utf8")
    .split("\n")
    .filter((l) => /^\s*-\s*name:/.test(l))
    .map((l) => l.replace(/^\s*-\s*name:\s*/, "").trim());
  const rows = states.map((s) => `| \`${s}\` | x | x |`).join("\n");
  fs.writeFileSync(
    path.join(dir, "specs", "README.md"),
    `# specs\n\nMAX_VERIFY_ATTEMPTS = 2\n\nMAX_CONCURRENT_DISPATCH = 3\n\n| State | Entered by | Valid next states |\n|---|---|---|\n${rows}\n`,
  );
  return dir;
}

// Required template sections as a fixture body; tests that exercise Files-section
// parsing pass their own `files` bullets.
function body({ files = ["`lib/x.mjs`"], extra = "" } = {}) {
  const fileLines = files.map((f) => `- ${f}`).join("\n");
  return (
    "## Problem\np\n\n## Acceptance Criteria\n- When A, the system shall B.\n\n" +
    "## Out of Scope\n- n\n\n## Files/Interfaces Touched\n" + fileLines + "\n\n" +
    "## Implementation Notes\nn\n\n## Verification\nRun make verify.\n" + extra
  );
}

function run(repo, ...args) {
  const res = spawnSync("node", ["--no-warnings", path.join(repo, "scripts", "spec-db.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, SPECDB_ROOT: repo, SPECDB_PATH: path.join(repo, "spec.db") },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function runSh(repo, script, ...args) {
  const res = spawnSync("/bin/bash", [path.join(repo, "scripts", script), ...args], {
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function sql(repo, statement) {
  const res = spawnSync("node", ["--no-warnings", "--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(process.env.SPECDB_PATH);
    db.exec(${JSON.stringify(statement)});
  `], { encoding: "utf8", env: { ...process.env, SPECDB_PATH: path.join(repo, "spec.db") } });
  if (res.status !== 0) throw new Error(res.stderr);
}

// Seed one spec through the real write path: add, body, deps, then walk the lifecycle
// to the target state. Returns the allocated id.
function seed(repo, project, { title = "T", status = "draft", files, extra, deps = [] } = {}) {
  const add = run(repo, "add", project, title);
  const id = add.stdout.match(/\/(\d{4}) created/)[1];
  const bodyFile = path.join(repo, `body-${project}-${id}.md`);
  fs.writeFileSync(bodyFile, body({ files: files ?? ["`lib/x.mjs`"], extra: extra ?? "" }));
  run(repo, "edit", project, id, "body", bodyFile);
  for (const d of deps) run(repo, "dep", "add", project, id, d);
  const WALK = ["draft", "ready", "in_progress", "waiting_verification"];
  if (status !== "draft") {
    for (const next of WALK.slice(1, WALK.indexOf(status === "finished" || status === "blocked" ? "waiting_verification" : status) + 1)) {
      const mv = run(repo, "move", project, id, next, "test");
      if (mv.code !== 0) throw new Error(`seed move to ${next} failed: ${mv.stderr}`);
    }
    if (status === "finished" || status === "blocked") {
      const mv = run(repo, "move", project, id, status, "test");
      if (mv.code !== 0) throw new Error(`seed move to ${status} failed: ${mv.stderr}`);
    }
  }
  return id;
}

// ── spec-db.mjs check ────────────────────────────────────────────────────────

test("check: clean project → exit 0, no issues", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { title: "A", status: "finished" });
  run(repo, "set", "p", a, "pr", "https://github.com/x/y/pull/1");
  seed(repo, "p", { title: "B", status: "ready", files: ["`lib/other.mjs`"], deps: [a] });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No issues found/);
});

test("check: dangling deps, cycles, finished-dep-unfinished, unknown status", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { title: "A", status: "draft" });
  const b = seed(repo, "p", { title: "B", status: "draft", deps: [a] });
  run(repo, "dep", "add", "p", a, b); // cycle a <-> b
  run(repo, "dep", "add", "p", a, "9999"); // dangling
  const c = seed(repo, "p", { title: "C", status: "finished", files: ["`lib/c.mjs`"] });
  run(repo, "set", "p", c, "pr", "https://x/pr/1");
  run(repo, "dep", "add", "p", c, a); // finished depending on a draft
  sql(repo, "UPDATE specs SET status='shipped' WHERE id='0002'"); // out-of-band tamper
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  for (const marker of ["dangling-depends_on", "dep-cycle", "finished-dep-unfinished", "unknown-status"]) {
    assert.match(out.stdout, new RegExp(`ISSUE \\[${marker}\\]`), `expected ${marker}`);
  }
});

test("check: sizing threshold flags oversized Files/Interfaces Touched", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "p", { status: "ready", files: Array.from({ length: 7 }, (_, i) => `file${i}.js`) });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[sizing\].*7 files/);
});

test("check: finished spec with empty pr flagged; recorded pr passes", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "p", { title: "NoPr", status: "finished" });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[empty-pr\]/);
  run(repo, "set", "p", "0001", "pr", "https://github.com/x/y/pull/1");
  const ok = run(repo, "check", "p");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

test("check: shared file across ready specs without a chain flagged (file conflict)", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  // backticked-with-prose and bare-path forms must normalize to the same file
  seed(repo, "p", { status: "ready", files: ["`lib/foo.mjs` — add the parser"] });
  seed(repo, "p", { status: "ready", files: ["lib/foo.mjs rework the parser"] });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[file-conflict\].*'0001' and '0002'.*'lib\/foo\.mjs'/);
});

test("check: shared file with a transitive depends_on chain passes (file conflict)", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { status: "ready", files: ["`lib/foo.mjs`"] });
  const b = seed(repo, "p", { status: "ready", files: ["`lib/other.mjs`"], deps: [a] });
  // shares the file with a but is ordered only transitively (c→b→a)
  seed(repo, "p", { status: "draft", files: ["`lib/foo.mjs`"], deps: [b] });
  sql(repo, "UPDATE specs SET status='in_progress' WHERE id='0003'"); // bypass dep gate for the fixture shape
  const out = run(repo, "check", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No issues found/);
});

test("check: shared file outside ready/in_progress is not a conflict", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { status: "finished", files: ["`lib/foo.mjs`"] });
  run(repo, "set", "p", a, "pr", "https://x/pr/1");
  seed(repo, "p", { status: "ready", files: ["`lib/foo.mjs`"] });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
});

test("check: clarification marker outside draft flagged, inside draft allowed", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "p", { status: "ready", extra: "\n[NEEDS CLARIFICATION: which auth model?]\n" });
  seed(repo, "p", { status: "draft", extra: "\n[NEEDS CLARIFICATION: which auth model?]\n" });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[stray-clarification\].*0001/);
  assert.doesNotMatch(out.stdout, /ISSUE \[stray-clarification\].*0002/);
});

test("check: bare seeded marker (no colon) outside draft is also flagged", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "p", { status: "ready", extra: "\n[NEEDS CLARIFICATION]\n" });
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[stray-clarification\].*0001/);
});

test("check: failures section with verify_attempts 0 flagged; legitimate handoff passes", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const failures = "\n## Verification Failures\n\nAttempt 1 of 2.\n";
  seed(repo, "p", { status: "waiting_verification", extra: failures });
  const b = seed(repo, "p", { status: "waiting_verification", extra: failures, files: ["`lib/b.mjs`"] });
  const tf = path.join(repo, "trace.md");
  fs.writeFileSync(tf, "raw\n");
  run(repo, "record-attempt", "p", b, "FAIL", tf); // makes 0002's section legitimate
  run(repo, "memory", "add", "lessons", `2026-07-13 — failed once (spec ${b})`, "body", b);
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[stale-failures-section\].*0001/);
  assert.doesNotMatch(out.stdout, /ISSUE \[stale-failures-section\].*0002/);
});

test("check: missing required section flagged by name", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const id = seed(repo, "p", { status: "ready" });
  const bodyFile = path.join(repo, "no-oos.md");
  fs.writeFileSync(bodyFile, body().replace("## Out of Scope\n- n\n\n", ""));
  run(repo, "edit", "p", id, "body", bodyFile);
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[missing-section\].*'## Out of Scope'/);
  assert.doesNotMatch(out.stdout, /missing required section '## Problem'/);
});

test("check: blocked spec without a lessons entry flagged; tagged entry passes", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "p", { title: "Stuck", status: "blocked" });
  run(repo, "memory", "add", "lessons", "2026-01-01 — Something else (spec 0999)", "text", "0999");
  const out = run(repo, "check", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[missing-lesson\].*\(spec 0001\)/);
  // spec_id link OR heading tag both satisfy the check
  run(repo, "memory", "add", "lessons", "2026-01-02 — Went sideways (spec 0001, PR #7)", "text", "0001");
  const ok = run(repo, "check", "p");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

test("check: failed-attempt spec without lessons entry warns but passes", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const id = seed(repo, "p", { status: "waiting_verification" });
  const tf = path.join(repo, "trace.md");
  fs.writeFileSync(tf, "raw\n");
  run(repo, "record-attempt", "p", id, "FAIL", tf);
  // put the failures section in so the stale-failures lint stays quiet
  const bodyFile = path.join(repo, "with-failures.md");
  fs.writeFileSync(bodyFile, body({ extra: "\n## Verification Failures\n\nAttempt 1 of 2.\n" }));
  run(repo, "edit", "p", id, "body", bodyFile);
  const out = run(repo, "check", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /WARN \[missing-lesson\].*\(spec 0001\)/);
});

test("check: empty DB and missing DB are both clean exits", (t) => {
  const repo = makeRepo(t);
  const noDb = run(repo, "check");
  assert.equal(noDb.code, 0);
  assert.match(noDb.stdout, /No spec\.db yet/);
  run(repo, "init");
  const empty = run(repo, "check");
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /No specs recorded — nothing to check/);
});

// ── spec-db.mjs status ───────────────────────────────────────────────────────

test("status: counts per state and totals", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { title: "A", status: "finished" });
  run(repo, "set", "p", a, "pr", "https://x/pr/1");
  const b = seed(repo, "p", { title: "B", status: "finished" });
  run(repo, "set", "p", b, "pr", "https://x/pr/2");
  seed(repo, "p", { title: "C", status: "ready" });
  const out = run(repo, "status", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /finished\s+2/);
  assert.match(out.stdout, /ready\s+1/);
  assert.match(out.stdout, /total\s+3/);
});

test("status: failed attempts and blocked specs appear under attention", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { title: "Failed once", status: "waiting_verification" });
  const tf = path.join(repo, "trace.md");
  fs.writeFileSync(tf, "raw\n");
  run(repo, "record-attempt", "p", a, "FAIL", tf);
  seed(repo, "p", { title: "Stuck", status: "blocked" });
  const out = run(repo, "status", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /0001 — Failed once: waiting_verification with 1 failed attempt/);
  assert.match(out.stdout, /0002 — Stuck: BLOCKED/);
  assert.doesNotMatch(out.stdout, /\(none\)/);
});

test("status: no argument prints every project; clean project reports (none)", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  seed(repo, "alpha", { title: "A", status: "ready" });
  seed(repo, "beta", { title: "B", status: "ready" });
  const out = run(repo, "status");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Spec status — alpha/);
  assert.match(out.stdout, /Spec status — beta/);
  assert.match(out.stdout, /\(none\)/);
});

// ── spec-db.mjs metrics ──────────────────────────────────────────────────────

test("metrics: attempts distribution, failure rate, deps, and cycle time from transitions", (t) => {
  const repo = makeRepo(t);
  run(repo, "init");
  const a = seed(repo, "p", { title: "A", status: "waiting_verification" });
  const tf = path.join(repo, "trace.md");
  fs.writeFileSync(tf, "raw\n");
  run(repo, "record-attempt", "p", a, "FAIL", tf);
  run(repo, "move", "p", a, "finished", "test");
  run(repo, "set", "p", a, "pr", "https://x/pr/1");
  seed(repo, "p", { title: "B", status: "ready", files: ["`lib/b.mjs`"], deps: [a] });
  const out = run(repo, "metrics", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /attempts=0\s+1 spec\(s\)/);
  assert.match(out.stdout, /attempts=1\s+1 spec\(s\)/);
  assert.match(out.stdout, /1 of 1 finished spec\(s\) failed verification at least once \(100%\)/);
  assert.match(out.stdout, /specs with depends_on\s+1/);
  assert.match(out.stdout, /max chain depth\s+2 spec\(s\)/);
  assert.match(out.stdout, /0001\s+0 day\(s\)/); // ready→finished within the test run
});

// ── check-state-sync.sh ──────────────────────────────────────────────────────

test("check-state-sync: fixture README in sync → exit 0", (t) => {
  const repo = makeRepo(t);
  const out = runSh(repo, "check-state-sync.sh");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /in sync/);
});

test("check-state-sync: README missing a state row → drift reported", (t) => {
  const repo = makeRepo(t);
  const readme = path.join(repo, "specs", "README.md");
  const stripped = fs
    .readFileSync(readme, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("| `blocked`"))
    .join("\n");
  fs.writeFileSync(readme, stripped);
  const out = runSh(repo, "check-state-sync.sh");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[state-drift\]: state 'blocked' is in/);
});

test("check-state-sync: retry constant drift reported", (t) => {
  const repo = makeRepo(t);
  const readme = path.join(repo, "specs", "README.md");
  fs.writeFileSync(
    readme,
    fs.readFileSync(readme, "utf8").replace("MAX_VERIFY_ATTEMPTS = 2", "MAX_VERIFY_ATTEMPTS = 9"),
  );
  const out = runSh(repo, "check-state-sync.sh");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[retry-drift\]/);
});
