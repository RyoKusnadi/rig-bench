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
  for (const s of ["check-specs.sh", "spec-status.sh", "check-state-sync.sh", "spec-metrics.sh", "spec-db.mjs"]) {
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
  const rows = states.map((s) => `| \`${s}\` | \`${s}/\` | x | x |`).join("\n");
  fs.writeFileSync(
    path.join(dir, "specs", "README.md"),
    `# specs\n\nMAX_VERIFY_ATTEMPTS = 2\n\nMAX_CONCURRENT_DISPATCH = 3\n\n| State | Folder | Entered by | Valid next states |\n|---|---|---|---|\n${rows}\n`,
  );
  return dir;
}

// Every required template section except Files/Interfaces Touched — fixture specs
// need all of them to pass the quality lint. Tests that exercise the
// Files-section parsing supply their own Files section via writeSpecWithBody.
const OTHER_SECTIONS =
  "## Problem\n\n## Acceptance Criteria\n\n## Out of Scope\n\n" +
  "## Implementation Notes\n\n## Verification\n";
const ALL_SECTIONS = `## Files/Interfaces Touched\n\n${OTHER_SECTIONS}`;

function writeSpec(repo, project, state, name, fm) {
  const dir = path.join(repo, "specs", project, state);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  fs.writeFileSync(path.join(dir, name), `---\n${lines}\n---\n\n${ALL_SECTIONS}`);
}

function writeSpecWithBody(repo, project, state, name, fm, body) {
  const dir = path.join(repo, "specs", project, state);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  fs.writeFileSync(path.join(dir, name), `---\n${lines}\n---\n\n${body}\n`);
}

function run(repo, script, ...args) {
  const res = spawnSync("/bin/bash", [path.join(repo, "scripts", script), ...args], {
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function runEnv(repo, env, script, ...args) {
  const res = spawnSync("/bin/bash", [path.join(repo, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Turn a fixture into a git repo with everything committed — the transition
// check only activates when a base ref resolves.
// Move a spec between lifecycle folders, updating its status field, and stage
// the move — the same shape as the skills' git mv + same-step sed. Staging
// matters: git only rename-detects tracked paths, so an unstaged copy+delete
// wouldn't register as a transition (git mv stages implicitly in the real flow).
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

test("check-specs: finished spec with empty pr field flagged (pr traceability)", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "finished", "0001-a.md", {
    id: "0001",
    status: "finished",
    pr: '""',
  });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[empty-pr\]/);
});

test("check-specs: finished spec without a pr key is grandfathered", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "finished", "0001-a.md", { id: "0001", status: "finished" });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No issues found/);
});

test("check-specs: finished spec with a recorded pr URL passes", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "finished", "0001-a.md", {
    id: "0001",
    status: "finished",
    pr: '"https://github.com/x/y/pull/1"',
  });
  writeSpec(repo, "p", "ready", "0002-b.md", {
    id: "0002",
    status: "ready",
    pr: '""', // empty pr outside finished/ is fine — recorded at PR-open time
  });
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
});

test("check-specs: shared file across ready specs without a chain flagged (file conflict)", (t) => {
  const repo = makeRepo(t);
  // 0001 uses a backticked path with trailing prose; 0002 lists the bare path —
  // extraction must normalize both to the same file.
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0001-a.md",
    { id: "0001", status: "ready" },
    "## Files/Interfaces Touched\n- `lib/foo.mjs` — add the parser\n\n" + OTHER_SECTIONS,
  );
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0002-b.md",
    { id: "0002", status: "ready" },
    "## Files/Interfaces Touched\n- lib/foo.mjs rework the parser\n\n" + OTHER_SECTIONS,
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[file-conflict\].*'0001' and '0002'.*'lib\/foo\.mjs'/);
});

test("check-specs: shared file with a depends_on chain passes (file conflict)", (t) => {
  const repo = makeRepo(t);
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0001-a.md",
    { id: "0001", status: "ready" },
    "## Files/Interfaces Touched\n- `lib/foo.mjs`\n\n" + OTHER_SECTIONS,
  );
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0002-mid.md",
    { id: "0002", status: "ready", depends_on: "[0001]" },
    "## Files/Interfaces Touched\n- `lib/other.mjs`\n\n" + OTHER_SECTIONS,
  );
  // 0003 shares the file with 0001 but is ordered only transitively (0003→0002→0001).
  writeSpecWithBody(
    repo,
    "p",
    "in_progress",
    "0003-c.md",
    { id: "0003", status: "in_progress", depends_on: "[0002]" },
    "## Files/Interfaces Touched\n- `lib/foo.mjs`\n\n" + OTHER_SECTIONS,
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No issues found/);
});

test("check-specs: shared file outside ready/in_progress is not a conflict (file conflict)", (t) => {
  const repo = makeRepo(t);
  writeSpecWithBody(
    repo,
    "p",
    "finished",
    "0001-a.md",
    { id: "0001", status: "finished" },
    "## Files/Interfaces Touched\n- `lib/foo.mjs`\n\n" + OTHER_SECTIONS,
  );
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0002-b.md",
    { id: "0002", status: "ready" },
    "## Files/Interfaces Touched\n- `lib/foo.mjs`\n\n" + OTHER_SECTIONS,
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
});

test("check-specs: clarification marker outside draft flagged, inside draft allowed (quality lint)", (t) => {
  const repo = makeRepo(t);
  const body = `${ALL_SECTIONS}\n[NEEDS CLARIFICATION: which auth model?]\n`;
  writeSpecWithBody(repo, "p", "ready", "0001-a.md", { id: "0001", status: "ready" }, body);
  writeSpecWithBody(repo, "p", "draft", "0002-b.md", { id: "0002", status: "draft" }, body);
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[stray-clarification\].*0001/);
  assert.doesNotMatch(out.stdout, /ISSUE \[stray-clarification\].*0002/);
});

test("check-specs: failures section with verify_attempts 0 flagged (quality lint)", (t) => {
  const repo = makeRepo(t);
  writeSpecWithBody(
    repo,
    "p",
    "waiting_verification",
    "0001-a.md",
    { id: "0001", status: "waiting_verification", verify_attempts: "0" },
    `${ALL_SECTIONS}\n## Verification Failures\n\nAttempt 1 of 2.\n`,
  );
  // Same section with attempts > 0 is the legitimate spec-verify handoff.
  writeSpecWithBody(
    repo,
    "p",
    "waiting_verification",
    "0002-b.md",
    { id: "0002", status: "waiting_verification", verify_attempts: "1" },
    `${ALL_SECTIONS}\n## Verification Failures\n\nAttempt 1 of 2.\n`,
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[stale-failures-section\].*0001/);
  assert.doesNotMatch(out.stdout, /ISSUE \[stale-failures-section\].*0002/);
});

test("check-specs: missing required section flagged by name (quality lint)", (t) => {
  const repo = makeRepo(t);
  writeSpecWithBody(
    repo,
    "p",
    "ready",
    "0001-a.md",
    { id: "0001", status: "ready" },
    ALL_SECTIONS.replace("## Out of Scope\n\n", ""),
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[missing-section\].*'## Out of Scope'/);
  assert.doesNotMatch(out.stdout, /missing required section '## Problem'/);
});

test("check-specs: blocked spec without a lessons entry flagged (memory writeback)", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "blocked", "0001-a.md", { id: "0001", status: "blocked" });
  fs.mkdirSync(path.join(repo, "memory"));
  fs.writeFileSync(
    path.join(repo, "memory", "lessons.md"),
    "# Lessons\n\n## 2026-01-01 — Something else (spec 0999)\n\ntext\n",
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /ISSUE \[missing-lesson\].*\(spec 0001\)/);
});

test("check-specs: blocked spec with a matching lessons entry passes (memory writeback)", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "blocked", "0001-a.md", { id: "0001", status: "blocked" });
  writeSpec(repo, "p", "blocked", "0002-b.md", { id: "0002", status: "blocked" });
  // 0001 tagged singular+PR form, 0002 via the plural batch form — both accepted.
  fs.mkdirSync(path.join(repo, "memory"));
  fs.writeFileSync(
    path.join(repo, "memory", "lessons.md"),
    "# Lessons\n\n## 2026-01-01 — Went sideways (spec 0001, PR #7)\n\ntext\n\n" +
      "## 2026-01-02 — Batch run (specs 0002+0003, PRs #8–#9)\n\ntext\n",
  );
  const out = run(repo, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
});

test("check-specs: failed-attempt spec without lessons entry warns but passes (memory writeback)", (t) => {
  const repo = makeRepo(t);
  writeSpecWithBody(
    repo,
    "p",
    "waiting_verification",
    "0001-a.md",
    { id: "0001", status: "waiting_verification", verify_attempts: "1" },
    `${ALL_SECTIONS}\n## Verification Failures\n\nAttempt 1 of 2.\n`,
  );
  // LESSONS_FILE override keeps fixtures off the real notebook (and proves the knob).
  const lessons = path.join(repo, "other-lessons.md");
  fs.writeFileSync(lessons, "# Lessons\n");
  const out = runEnv(repo, { LESSONS_FILE: lessons }, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /WARN \[missing-lesson\].*\(spec 0001\)/);
});

test("blocked spec with a DB lessons entry passes the memory check (DB path)", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "blocked", "0001-a.md", { id: "0001", status: "blocked", verify_attempts: 2 });
  const env = { SPECDB_ROOT: repo, SPECDB_PATH: path.join(repo, "spec.db") };
  const db = (...a) => spawnSync("node", ["--no-warnings", path.join(repo, "scripts", "spec-db.mjs"), ...a], { encoding: "utf8", cwd: repo, env: { ...process.env, ...env } });
  db("init");
  db("memory", "add", "lessons", "2026-07-09 — Blocked and learned (spec 0001)", "body", "0001");
  const out = runEnv(repo, {}, "check-specs.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout, /missing-lesson/);
});

test("blocked spec with a DB but no lessons entry is still flagged (DB path)", (t) => {
  const repo = makeRepo(t);
  writeSpec(repo, "p", "blocked", "0001-a.md", { id: "0001", status: "blocked", verify_attempts: 2 });
  const env = { SPECDB_ROOT: repo, SPECDB_PATH: path.join(repo, "spec.db") };
  spawnSync("node", ["--no-warnings", path.join(repo, "scripts", "spec-db.mjs"), "init"], { encoding: "utf8", cwd: repo, env: { ...process.env, ...env } });
  const out = runEnv(repo, {}, "check-specs.sh", "p");
  assert.equal(out.code, 1);
  assert.match(out.stdout, /ISSUE \[missing-lesson\].*\(spec 0001\)/);
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

// ── spec-metrics.sh ──────────────────────────────────────────────────────────

test("spec-metrics: history entries drive cycle time without git (state timestamps)", (t) => {
  const repo = makeRepo(t); // deliberately not a git repo — history must suffice
  const dir = path.join(repo, "specs", "p", "finished");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "0001-a.md"),
    `---\nid: "0001"\nstatus: finished\nverify_attempts: 0\nhistory:\n` +
      `  - ready 2026-01-01T08:00:00Z\n  - in_progress 2026-01-02T08:00:00Z\n` +
      `  - finished 2026-01-04T09:30:00Z\n---\n\n${ALL_SECTIONS}`,
  );
  const out = run(repo, "spec-metrics.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /0001\s+3 day\(s\)/);
  assert.doesNotMatch(out.stdout, /0001\s+3 day\(s\) \*/); // not the git-estimated form
});

test("spec-metrics: finished spec without history falls back to git skip (state timestamps)", (t) => {
  const repo = makeRepo(t); // non-git fixture: no history and no git → skip message
  writeSpec(repo, "p", "finished", "0001-a.md", { id: "0001", status: "finished" });
  const out = run(repo, "spec-metrics.sh", "p");
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /\(no finished specs with history entries or git tracking\)/);
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
