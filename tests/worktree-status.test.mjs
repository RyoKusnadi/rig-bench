// worktree-status.test.mjs — behavior tests for the dispatch-worktree hygiene script.
// Builds a scratch git repo with a real worktree on a spec-<id>-* branch and a seeded
// spec.db, and asserts the script flags staleness without mutating anything — the
// read-only invariant is asserted as the fixture's own delta (the worktree still exists
// afterwards). Spec 0019.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, ...args) {
  const res = spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

// A scratch repo with the script + CLI installed and one spec seeded in `state`
// (or no spec at all when specState is null).
function makeRepo(t, { specState }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "rig-bench-wt-"));
  t.after(() => {
    // Worktrees must be removed before the base dir; force covers dirty state.
    const repo = path.join(base, "repo");
    spawnSync("git", ["worktree", "remove", "--force", path.join(base, "repo-wt-0001")], {
      cwd: repo,
      encoding: "utf8",
    });
    fs.rmSync(base, { recursive: true, force: true });
  });
  const repo = path.join(base, "repo");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "workflows"), { recursive: true });
  for (const s of ["worktree-status.sh", "spec-db.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", s), path.join(repo, "scripts", s));
    fs.chmodSync(path.join(repo, "scripts", s), 0o755);
  }
  fs.copyFileSync(path.join(ROOT, "workflows", "state.yaml"), path.join(repo, "workflows", "state.yaml"));
  fs.writeFileSync(path.join(repo, ".gitignore"), "spec.db*\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  const db = (...a) =>
    spawnSync("node", ["--no-warnings", path.join(repo, "scripts", "spec-db.mjs"), ...a], {
      encoding: "utf8",
      cwd: repo,
    });
  db("init");
  if (specState) {
    db("add", "template", "Demo");
    const WALK = { ready: 1, in_progress: 2, waiting_verification: 3, finished: 4 };
    const chain = ["ready", "in_progress", "waiting_verification", "finished"].slice(0, WALK[specState] ?? 0);
    for (const next of chain) db("move", "template", "0001", next, "test");
  }
  return { base, repo };
}

function run(repo) {
  const res = spawnSync("/bin/bash", [path.join(repo, "scripts", "worktree-status.sh")], {
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("worktree for a non-in_progress spec is flagged stale, nothing removed", (t) => {
  const { base, repo } = makeRepo(t, { specState: "finished" });
  const wt = path.join(base, "repo-wt-0001");
  git(repo, "worktree", "add", wt, "-b", "spec-0001-demo");
  const out = run(repo);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /spec=0001\s+state=finished/);
  assert.match(out.stdout, /STALE/);
  assert.match(out.stdout, new RegExp(`git worktree remove .*repo-wt-0001`));
  assert.match(out.stdout, /1 dispatch worktree\(s\), 1 stale\./);
  // Read-only invariant: the worktree survives the run.
  assert.ok(fs.existsSync(wt), "worktree directory must still exist");
  assert.match(git(repo, "worktree", "list"), /repo-wt-0001/);
});

test("worktree for an in_progress spec is listed, not stale", (t) => {
  const { base, repo } = makeRepo(t, { specState: "in_progress" });
  const wt = path.join(base, "repo-wt-0001");
  git(repo, "worktree", "add", wt, "-b", "spec-0001-demo");
  const out = run(repo);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /spec=0001\s+state=in_progress/);
  assert.doesNotMatch(out.stdout, /STALE/);
  assert.match(out.stdout, /1 dispatch worktree\(s\), 0 stale\./);
});

test("worktree whose spec the DB doesn't know reports unknown and stale", (t) => {
  const { base, repo } = makeRepo(t, { specState: "finished" });
  // Branch id 0002 has no spec row anywhere.
  const wt = path.join(base, "repo-wt-0001"); // path id is ignored when branch matches
  git(repo, "worktree", "add", wt, "-b", "spec-0002-ghost");
  const out = run(repo);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /spec=0002\s+state=unknown/);
  assert.match(out.stdout, /STALE/);
});

test("no dispatch worktrees → empty-state message, exit 0", (t) => {
  const { repo } = makeRepo(t, { specState: "ready" });
  const out = run(repo);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /\(no dispatch worktrees found\)/);
});
