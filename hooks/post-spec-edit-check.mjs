#!/usr/bin/env node
// post-spec-edit-check.mjs — PostToolUse hook: after a Bash command that mutates specs
// through scripts/spec-db.mjs (add/edit/move/delete/dep/import), run
// `spec-db.mjs check <project>` and surface any issues immediately (exit 2 puts stderr
// in front of the agent) instead of waiting for a manual `make check`.
//
// Feedback, not a gate: PostToolUse runs after the mutation — this catches drift at
// write time, it does not prevent it. Executes only the fixed repo CLI with the project
// name parsed from the command; never executes command content itself. Fails OPEN on
// malformed input (same trade-off as pre-bash-safety.mjs, observable via stderr).
//
// Node built-ins only. Spec: 0007 (post-spec-edit check).

import { spawnSync } from "node:child_process";

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

let command = "";
try {
  const event = JSON.parse(raw);
  command = String(event?.tool_input?.command ?? "");
} catch {
  process.stderr.write("post-spec-edit-check: could not parse hook input; allowing (fail-open).\n");
  process.exit(0);
}

if (!command || !command.includes("spec-db.mjs")) process.exit(0);

// Token-parse the spec-db invocation: the project is the argument right after a
// spec-mutating verb (add/edit/move/delete/import), or after `dep add|rm`. `memory add`
// and `research add` don't match — their verb token is `memory`/`research`, not a
// spec verb. Quoted projects are unwrapped; anything failing the CLI's own
// [A-Za-z0-9_-]+ project charset is ignored rather than passed along.
const tokens = command.split(/\s+/);
const cliIdx = tokens.findIndex((t) => t.includes("spec-db.mjs"));
if (cliIdx === -1) process.exit(0);
const verbs = ["add", "edit", "move", "delete", "import"];
let project = "";
const verb = tokens[cliIdx + 1] ?? "";
if (verbs.includes(verb)) {
  project = tokens[cliIdx + 2] ?? "";
} else if (verb === "dep" && ["add", "rm"].includes(tokens[cliIdx + 2] ?? "")) {
  project = tokens[cliIdx + 3] ?? "";
}
project = project.replace(/^["']|["']$/g, "");
if (!/^[A-Za-z0-9_-]+$/.test(project)) process.exit(0);

const res = spawnSync("node", ["--no-warnings", "scripts/spec-db.mjs", "check", project], {
  encoding: "utf8",
});

if (res.status !== 0) {
  process.stderr.write(
    `post-spec-edit-check: spec-db.mjs check found issues after: ${command}\n` +
      (res.stdout || "") +
      (res.stderr || ""),
  );
  process.exit(2);
}

process.exit(0);
