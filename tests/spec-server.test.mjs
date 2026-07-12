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
  const rf = path.join(dir, "r.md");
  fs.writeFileSync(rf, "## Overview\n\nGerman A1 study guide body.\n");
  cli(dir, "research", "add", "learn German A1", "Learning German to A1", rf, '["https://example.com/x"]');

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
  // read-only posture: non-GET on non-mutable routes stays 405, and OPTIONS is 405 on
  // every route on purpose — no preflight support means browsers refuse cross-origin
  // mutation (see the MUTABLE comment in spec-server.mjs)
  assert.equal((await fetch(base + "/api/metrics", { method: "POST" })).status, 405);
  assert.equal((await fetch(base + "/api/research/1", { method: "PUT" })).status, 405);
  assert.equal((await fetch(base + "/api/research/1", { method: "OPTIONS" })).status, 405);

  // research endpoints (same fixture: spec-db.mjs's module-level DB path binds to the
  // first import, so a second makeServer would reopen this test's deleted DB)
  const reports = (await get(base, "/api/research")).body;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].title, "Learning German to A1");
  assert.deepEqual(reports[0].sources, ["https://example.com/x"]);
  assert.equal("body_md" in reports[0], false);

  const bySeq = (await get(base, `/api/research/${reports[0].seq}`)).body;
  assert.equal(bySeq.slug, "learning-german-to-a1");
  assert.match(bySeq.body_md, /study guide body/);
  assert.deepEqual(bySeq.sources, ["https://example.com/x"]);

  const bySlug = await get(base, "/api/research/learning-german-to-a1");
  assert.equal(bySlug.status, 200);
  assert.equal(bySlug.body.seq, bySeq.seq);

  assert.equal((await get(base, "/api/research?q=German")).body.length, 1);
  assert.equal((await get(base, "/api/research?q=zzz")).body.length, 0);
  assert.equal((await get(base, "/api/research/999")).status, 404);

  // research mutations (spec 0034): PATCH edits with slug stable; DELETE removes
  const sendJson = (p, method, body) => fetch(base + p, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const patched = await sendJson("/api/research/learning-german-to-a1", "PATCH",
    { title: "German A1, revised", body_md: "updated body" });
  assert.equal(patched.status, 200);
  const patchedBody = await patched.json();
  assert.equal(patchedBody.title, "German A1, revised");
  assert.equal(patchedBody.slug, "learning-german-to-a1"); // slug never re-derived from title
  const afterPatch = (await get(base, "/api/research/learning-german-to-a1")).body;
  assert.equal(afterPatch.title, "German A1, revised");
  assert.match(afterPatch.body_md, /updated body/);

  // validation surface: bad JSON, unknown field, non-array sources, missing report
  const badJson = await fetch(base + "/api/research/1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: "{nope",
  });
  assert.equal(badJson.status, 400);
  assert.equal((await sendJson("/api/research/1", "PATCH", { slug: "x" })).status, 400);
  assert.equal((await sendJson("/api/research/1", "PATCH", {})).status, 400);
  assert.equal((await sendJson("/api/research/1", "PATCH", { sources: "not-array" })).status, 400);
  assert.equal((await sendJson("/api/research/999", "PATCH", { title: "T" })).status, 404);

  const del = await sendJson("/api/research/learning-german-to-a1", "DELETE");
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, true);
  assert.equal((await get(base, "/api/research/learning-german-to-a1")).status, 404);
  assert.equal((await get(base, "/api/research")).body.length, 0);
  assert.equal((await sendJson("/api/research/1", "DELETE")).status, 404);

  // memory mutations (spec 0035): PATCH edits in place, DELETE soft-deletes
  const memPatch = await sendJson("/api/memory/gotchas/1", "PATCH", { heading: "Edited gotcha" });
  assert.equal(memPatch.status, 200);
  assert.equal((await memPatch.json()).heading, "Edited gotcha");
  const memAfter = (await get(base, "/api/memory")).body;
  assert.equal(memAfter.length, 1);
  assert.equal(memAfter[0].heading, "Edited gotcha");
  assert.equal((await sendJson("/api/memory/gotchas/1", "PATCH", { notebook: "x" })).status, 400);
  assert.equal((await sendJson("/api/memory/gotchas/9", "PATCH", { heading: "X" })).status, 404);

  const memDel = await sendJson("/api/memory/gotchas/1", "DELETE");
  assert.equal(memDel.status, 200);
  assert.equal((await get(base, "/api/memory?spec_id=0002")).body.length, 0);
  assert.equal((await get(base, "/api/memory")).body.length, 0);
  assert.equal((await sendJson("/api/memory/gotchas/1", "DELETE")).status, 404); // already deleted
});
