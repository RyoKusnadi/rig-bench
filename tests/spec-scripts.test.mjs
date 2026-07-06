// spec-scripts.test.mjs — behavior tests for the three lifecycle scripts:
// check-specs.sh, spec-status.sh, check-state-sync.sh.
// Run via npm test.
//
// Each test builds a throwaway repo skeleton (scripts/ + workflows/state.yaml +
// specs/<project>/) in a temp dir, so the scripts' cd-to-repo-root behavior is
// exercised without touching the real specs tree. Scripts run under /bin/bash
// deliberately — on macOS that's bash 3.2, the portability floor these scripts
// must hold (see memory/gotchas.md).

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
  for (const s of ["check-specs.sh", "spec-status.sh", "check-state-sync.sh"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", s), path.join(dir, "scripts", s));
    fs.chmodSync(path.join(dir, "scripts", s), 0o755);
  }
  fs.copyFileSync(
    path.join(ROOT, "workflows", "state.yaml"),
    path.join(dir, "workflows", "state.yaml"),
  );
  // A minimal specs/README.md that agrees with the real state.yaml, so
  // check-state-sync.sh passes in the fixture repo by default.
  const states = fs
    .readFileSync(path.join(dir, "workflows", "state.yaml"), "utf8")
    .split("\n")
    .filter((l) => /^\s*-\s*name:/.test(l))
    .map((l) => l.replace(/^\s*-\s*name:\s*/, "").trim());
  const rows = states.map((s) => `| \`${s}\` | \`${s}/\` | x | x |`).join("\n");
  fs.mkdirSync(path.join(dir, "specs"));
  fs.writeFileSync(
    path.join(dir, "specs", "README.md"),
    `# specs\n\nMAX_VERIFY_ATTEMPTS = 2\n\nMAX_CONCURRENT_DISPATCH = 3\n\n| State | Folder | Entered by | Valid next states |\n|---|---|---|---|\n${rows}\n`,
  );
  return dir;
}

function writeSpec(repo, project, state, name, fm) {
  const dir = path.join(repo, "specs", project, state);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  fs.writeFileSync(path.join(dir, name), `---\n${lines}\n---\n\n# ${name}\n`);
}

function run(repo, script, ...args) {
  const res = spawnSync("/bin/bash", [path.join(repo, "scripts", script), ...args], {
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// ── check-specs.sh ───────────────────────────────────────────────────────────

test("check-specs: clean project → exit 0, no issues", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "finished", "0001-a.md", { id: "0001", status: "finished" });
  writeSpec(repo, "p", "ready", "0002-b.md", {
    id: "0002",
    status: "ready",
    depends_on: "[0001]",
  });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No issues found/);
});

test("check-specs: reports every issue class and exits 1", (t) => {
  const repo = makeRepo(t);
  // duplicate id + dep cycle + dangling dep + finished-dep-unfinished +
  // missing id + status/folder mismatch, all in one project.
  writeSpec(repo, "p", "draft", "0001-a.md", {
    id: "0001",
    status: "draft",
    depends_on: "[0002, 9999]",
  });
  writeSpec(repo, "p", "draft", "0002-b.md", {
    id: "0002",
    status: "draft",
    depends_on: "[0001]",
  });
  writeSpec(repo, "p", "ready", "0003-dup.md", { id: "0001", status: "ready" });
  writeSpec(repo, "p", "finished", "0004-fin.md", {
    id: "0004",
    status: "finished",
    depends_on: "[0002]",
  });
  writeSpec(repo, "p", "ready", "0005-mismatch.md", { id: "0005", status: "draft" });
  writeSpec(repo, "p", "ready", "0006-noid.md", { status: "ready" });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  for (const marker of [
    "duplicate-id",
    "dep-cycle",
    "dangling-depends_on",
    "finished-dep-unfinished",
    "missing-id",
    "status-mismatch",
  ]) {
    assert.match(out.stdout, new RegExp(`ISSUE \\[${marker}\\]`), `expected ${marker}`);
  }
});

test("check-specs: spec missing a field is reported, not a silent crash", (t) => {
  // Regression: under set -o pipefail, grep-based field extraction returned 1
  // for absent fields and killed the script before any ISSUE line printed.
  const repo = makeRepo(t);
  writeSpec(repo, "p", "ready", "0001-nostatus.md", { id: "0001" });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[missing-status\]/);
});

test("check-specs: unknown status flagged against state.yaml's list", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "ready", "0001-a.md", { id: "0001", status: "shipped" });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[unknown-status\]/);
});

test("check-specs: sizing threshold flags oversized Files/Interfaces Touched", (t) => {
  const repo = makeRepo(t);
  const dir = path.join(repo, "specs", "p", "ready");
  fs.mkdirSync(dir, { recursive: true });
  const files = Array.from({ length: 7 }, (_, i) => `- file${i}.js`).join("\n");
  fs.writeFileSync(
    path.join(dir, "0001-big.md"),
    `---\nid: 0001\nstatus: ready\n---\n\n## Files/Interfaces Touched\n${files}\n\n## Next\n`,
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[sizing\].*7 files/);
});

test("check-specs: empty project → exit 0", (t) => {
  const repo = makeRepo(t);
  fs.mkdirSync(path.join(repo, "specs", "p", "ready"), { recursive: true });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0);
  assert.match(out.stdout, /No spec files found/);
});

// ── spec-status.sh ───────────────────────────────────────────────────────────

test("spec-status: counts per state and totals", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "finished", "0001-a.md", { id: "0001", status: "finished" });
  writeSpec(repo, "p", "finished", "0002-b.md", { id: "0002", status: "finished" });
  writeSpec(repo, "p", "ready", "0003-c.md", { id: "0003", status: "ready" });
  const out = run(repo, "spec-status.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /finished\s+2/);
  assert.match(out.stdout, /ready\s+1/);
  assert.match(out.stdout, /total\s+3/);
  assert.match(out.stdout, /\(none\)/);
});

test("spec-status: waiting_verification spec without verify_attempts → no crash", (t) => {
  // Regression: fm_field's grep pipeline + pipefail killed the script right
  // after "Needs attention:" whenever verify_attempts was absent — the normal
  // state for a spec that just entered waiting_verification.
  const repo = makeRepo(t);
  writeSpec(repo, "p", "waiting_verification", "0001-a.md", {
    id: "0001",
    title: "No attempts yet",
    status: "waiting_verification",
  });
  const out = run(repo, "spec-status.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /\(none\)/);
});

test("spec-status: failed attempts and blocked specs appear under attention", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "waiting_verification", "0001-a.md", {
    id: "0001",
    title: "Failed once",
    status: "waiting_verification",
    verify_attempts: "1",
  });
  writeSpec(repo, "p", "blocked", "0002-b.md", {
    id: "0002",
    title: "Stuck",
    status: "blocked",
  });
  const out = run(repo, "spec-status.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /0001 — Failed once: waiting_verification with 1 failed attempt/);
  assert.match(out.stdout, /0002 — Stuck: BLOCKED/);
  assert.doesNotMatch(out.stdout, /\(none\)/);
});

// ── check-state-sync.sh ──────────────────────────────────────────────────────

test("check-state-sync: fixture README in sync → exit 0", (t) => {
  const repo = makeRepo(t);
  const out = run(repo, "check-state-sync.sh");
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
  const out = run(repo, "check-state-sync.sh");
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
  const out = run(repo, "check-state-sync.sh");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[retry-drift\]/);
});
