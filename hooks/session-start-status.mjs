#!/usr/bin/env node
// session-start-status.mjs — SessionStart hook: print `spec-db.mjs status` output (all
// projects) so each session opens already knowing the lifecycle state (per-state counts,
// failed attempts, blocked specs) instead of relying on someone remembering to run
// `make status`. A SessionStart hook's stdout is added to the session context — plain
// printing is the whole delivery mechanism.
//
// Fail-open like the other hooks: a missing spec.db, a missing CLI, or a non-zero child
// exit all end in a silent exit 0 (stderr note only, keeping the skip observable).
// Never blocks a session. Node built-ins only. Spec: 0017 (session-start status hook).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CLI = path.join("scripts", "spec-db.mjs");

if (!fs.existsSync("spec.db") || !fs.existsSync(CLI)) {
  process.stderr.write("session-start-status: no spec.db or CLI; skipping (fail-open).\n");
  process.exit(0);
}

const res = spawnSync("node", ["--no-warnings", CLI, "status"], { encoding: "utf8" });
if (res.status === 0 && res.stdout && !/^No specs recorded\./.test(res.stdout)) {
  process.stdout.write(res.stdout.trimEnd() + "\n");
} else if (res.status !== 0) {
  process.stderr.write("session-start-status: spec-db.mjs status failed; skipping (fail-open).\n");
}
process.exit(0);
