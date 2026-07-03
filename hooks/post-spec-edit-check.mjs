#!/usr/bin/env node
// post-spec-edit-check.mjs — PostToolUse hook: after an Edit/Write that touches a spec file
// under specs/<project>/<state>/, run scripts/check-specs.sh <project> and surface any
// issues immediately (exit 2 puts stderr in front of the agent) instead of waiting for a
// manual `make check`.
//
// Feedback, not a gate: PostToolUse runs after the write — this catches drift at write time,
// it does not prevent it. Executes only the fixed repo script with the project name as its
// argument; never executes edited-file content. Fails OPEN on malformed input (same
// trade-off as pre-bash-safety.mjs, observable via stderr).
//
// Node built-ins only. Spec: specs/template/*/0007-post-spec-edit-check.md

import { spawnSync } from "node:child_process";
import path from "node:path";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const raw = await readStdin();

let filePath = "";
try {
  const event = JSON.parse(raw);
  filePath = String(event?.tool_input?.file_path ?? "");
} catch {
  process.stderr.write("post-spec-edit-check: could not parse hook input; allowing (fail-open).\n");
  process.exit(0);
}

if (!filePath) process.exit(0);

// Normalize to a repo-relative path.
const rel = path.relative(process.cwd(), path.resolve(process.cwd(), filePath));

// Match specs/<project>/<state>/<file>.md — the two top-level markdown files
// (specs/README.md, specs/spec-template.md) have only two segments and won't match.
const m = rel.match(/^specs\/([^/]+)\/[^/]+\/[^/]+\.md$/);
if (!m) process.exit(0);

const project = m[1];

const res = spawnSync("bash", ["scripts/check-specs.sh", project], { encoding: "utf8" });

if (res.status !== 0) {
  process.stderr.write(
    `post-spec-edit-check: check-specs.sh found issues after editing ${rel}:\n` +
      (res.stdout || "") +
      (res.stderr || ""),
  );
  process.exit(2);
}

process.exit(0);
