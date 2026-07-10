// spec-server.test.mjs — behavior tests for scripts/spec-server.mjs, the read-only
// HTTP layer over spec.db (Phase 3). Starts the real server on an ephemeral port
// against a fixture DB built through the real CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "scripts", "spec-db.mjs");

const STATE_YAML = `states:
  - name: ready
    folder: ready
    valid_next: [in_progress]
  - name: in_progress
    folder: in_progress
    valid_next: [waiting_verification]
  - name: waiting_verification
    folder: waiting_verification
    valid_next: [finished]
  - name: finished
    folder: finished
    valid_next: []
`;

function specMd(id, status) {
  return `---
id: "${id}"
title: Spec ${id}
status: ${status}
depends_on: []
verify_attempts: 0
history:
  - ${status} 2026-07-09T00:00:00Z
axis: "demo"
---
## Problem
p
## Acceptance Criteria
- When A, the system shall B.
## Verification
Run make verify.
`;
}

function cli(dir, ...args) {
  return spawnSync("node", ["--no-warnings", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, SPECDB_ROOT: dir, SPECDB_PATH: path.join(dir, "spec.db") },
  });
}

async function makeServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specsrv-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "workflows", "state.yaml"), STATE_YAML);
  fs.mkdirSync(path.join(dir, "web"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "web", "index.html"), path.join(dir, "web", "index.html"));
  for (const [id, status] of [["0001", "finished"], ["0002", "waiting_verification"]]) {
    const d = path.join(dir, "specs", "p", status);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${id}-x.md`), specMd(id, status));
  }
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, "memory", "gotchas.md"),
    "# Gotchas\n\n## A gotcha about 0002 (spec 0002)\n\ngotcha body\n");
  cli(dir, "import", "p");
  const tf = path.join(dir, "t.md");
  fs.writeFileSync(tf, "raw trace here\n");
  cli(dir, "record-attempt", "p", "0002", "FAIL", tf);
  cli(dir, "move", "p", "0002", "finished"); // snapshots criteria, ledgers

  process.env.SPECDB_ROOT = dir;
  process.env.SPECDB_PATH = path.join(dir, "spec.db");
  const { startServer } = await import(`../scripts/spec-server.mjs?fixture=${Date.now()}`);
  const server = startServer({ port: 0 });
  await new Promise((r) => server.on("listening", r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const get = async (base, p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
};

test("server: states, list, detail, attempt trace, drift, ledger, metrics, index, 404, read-only", async (t) => {
  const base = await makeServer(t);

  assert.equal((await get(base, "/health")).body.ok, true);

  const states = (await get(base, "/api/states")).body;
  assert.equal(states[0].name, "ready");

  const list = (await get(base, "/api/specs?project=p&status=finished")).body;
  assert.equal(list.length, 2); // 0001 imported finished + 0002 moved

  const detail = (await get(base, "/api/specs/p/0002")).body;
  assert.equal(detail.status, "finished");
  assert.equal(detail.attempts.length, 1);
  assert.equal(detail.transitions.at(-1).to_state, "finished");

  const att = (await get(base, "/api/specs/p/0002/attempts/1")).body;
  assert.match(att.trace_md, /raw trace here/);

  const drift = (await get(base, "/api/specs/p/0002/drift")).body;
  assert.equal(drift.comparable, true);
  assert.equal(drift.changed, false);

  const ledger = (await get(base, "/api/ledger?outcome=finished")).body;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].id, "0002");

  const mem = (await get(base, "/api/memory?spec_id=0002")).body;
  assert.equal(mem.length, 1);
  assert.equal(mem[0].notebook, "gotchas");
  assert.match(mem[0].body, /gotcha body/);

  const metrics = (await get(base, "/api/metrics?project=p")).body;
  assert.equal(metrics.finished, 2);
  assert.equal(metrics.finished_with_failed_attempts, 1);
  assert.equal(metrics.failure_rate_pct, 50);

  const index = await get(base, "/");
  assert.equal(index.status, 200);
  assert.match(index.body, /spec lifecycle/);

  assert.equal((await get(base, "/api/specs/p/9999")).status, 404);
  assert.equal((await fetch(base + "/api/specs", { method: "POST" })).status, 405);
});
