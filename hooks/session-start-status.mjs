#!/usr/bin/env node
// session-start-status.mjs — SessionStart hook: print scripts/spec-status.sh output for
// every project under specs/, so each session opens already knowing the lifecycle state
// (per-state counts, failed attempts, blocked specs) instead of relying on someone
// remembering to run `make status`. A SessionStart hook's stdout is added to the session
// context — plain printing is the whole delivery mechanism.
//
// Fail-open like the other hooks: no specs/ projects, a missing script, or a non-zero
// child exit all end in a silent exit 0 (stderr note only, keeping the skip observable).
// Never blocks a session. Node built-ins only. Spec: specs/template/*/0017-session-start-status-hook.md

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SCRIPT = path.join("scripts", "spec-status.sh");

let projects = [];
try {
  // Directories only — plain listing would pick up spec-template.md
  // (specs/README.md "Resolving the target project").
  projects = fs
    .readdirSync("specs", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
} catch {
  process.stderr.write("session-start-status: no specs/ directory; skipping (fail-open).\n");
  process.exit(0);
}

if (projects.length === 0 || !fs.existsSync(SCRIPT)) {
  process.stderr.write("session-start-status: nothing to report; skipping (fail-open).\n");
  process.exit(0);
}

const chunks = [];
for (const project of projects) {
  const res = spawnSync("bash", [SCRIPT, project], { encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    chunks.push(res.stdout.trimEnd());
  } else {
    process.stderr.write(
      `session-start-status: ${SCRIPT} ${project} failed; skipping that project (fail-open).\n`,
    );
  }
}

if (chunks.length > 0) {
  process.stdout.write(chunks.join("\n\n") + "\n");
}
process.exit(0);
