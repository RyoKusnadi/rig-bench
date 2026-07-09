#!/usr/bin/env node
// spec-db.mjs — SQLite system of record for the spec lifecycle.
//
// Spec documents are never committed (CLAUDE.md non-negotiable), which makes local
// markdown per-machine state with no shared view. This CLI is Phase 1 of moving the
// system of record into a database: markdown stays the authoring format (bodies are
// stored verbatim), the DB owns state, dependencies, transition history, verification
// attempts, and terminal outcomes. Transition legality is enforced on write from
// workflows/state.yaml's valid_next — the state machine lives in data, this tool just
// reads it. Criteria snapshots are taken on every transition so drift between "what was
// agreed" and "what is being graded" is a query, not a git diff.
//
// Zero dependencies: uses node:sqlite (Node 22+). DB file: ./spec.db (gitignored).
//
// Usage:
//   scripts/spec-db.mjs init
//   scripts/spec-db.mjs import <project>
//   scripts/spec-db.mjs list [project] [status]
//   scripts/spec-db.mjs show <project> <id>
//   scripts/spec-db.mjs move <project> <id> <to_state> [actor]
//   scripts/spec-db.mjs record-attempt <project> <id> <PASS|FAIL> [trace-file]
//   scripts/spec-db.mjs drift <project> <id>
//   scripts/spec-db.mjs set <project> <id> <branch|pr|axis> <value>
//   scripts/spec-db.mjs ledger [project] [outcome]
//   scripts/spec-db.mjs export <project> <id>

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SPECDB_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.SPECDB_PATH ?? path.join(ROOT, "spec.db");
const STATE_YAML = path.join(ROOT, "workflows", "state.yaml");

// ── minimal state.yaml reader (states list only; the file is data by design) ──
export function readStates(file = STATE_YAML) {
  const text = fs.readFileSync(file, "utf8");
  const states = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    const name = line.match(/^\s*-\s*name:\s*(\S+)/);
    if (name) { cur = { name: name[1], valid_next: [] }; states.push(cur); continue; }
    if (!cur) continue;
    const vn = line.match(/^\s*valid_next:\s*\[([^\]]*)\]/);
    if (vn) cur.valid_next = vn[1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (states.length === 0) throw new Error(`no states parsed from ${file}`);
  return states;
}

// ── frontmatter parser for import/export (the subset the template defines) ──
export function parseSpec(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter block");
  const [, fm, body] = m;
  const get = (k) => fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1] ?? "";
  const dep = fm.match(/^depends_on:\s*\[([^\]]*)\]/m);
  const history = [...fm.matchAll(/^\s*-\s*(\w+)\s+(\S+)\s*$/gm)]
    .map(([, state, ts]) => ({ state, ts }));
  return {
    id: get("id"),
    title: get("title"),
    status: get("status"),
    verify_attempts: Number(get("verify_attempts") || 0),
    axis: get("axis"),
    depends_on: dep ? dep[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [],
    branch: get("branch"),
    pr: get("pr"),
    history,
    body: body ?? "",
  };
}

export function extractCriteria(body) {
  const out = [];
  let on = false;
  for (const line of body.split("\n")) {
    if (line === "## Acceptance Criteria" || line === "## Verification") { on = true; out.push(line); continue; }
    if (/^## /.test(line)) { on = false; }
    if (on) out.push(line);
  }
  return out.join("\n");
}

export function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS specs (
  project TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  axis TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  pr TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (project, id)
);
CREATE TABLE IF NOT EXISTS dependencies (
  project TEXT NOT NULL, id TEXT NOT NULL, depends_on TEXT NOT NULL,
  PRIMARY KEY (project, id, depends_on)
);
CREATE TABLE IF NOT EXISTS transitions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, id TEXT NOT NULL,
  from_state TEXT, to_state TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS attempts (
  project TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL,
  overall TEXT NOT NULL CHECK (overall IN ('PASS','FAIL')),
  trace_md TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (project, id, n)
);
CREATE TABLE IF NOT EXISTS ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('finished','blocked')),
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  axis TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS criteria_revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, id TEXT NOT NULL,
  at_state TEXT NOT NULL,
  criteria_md TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

function cmdInit(db) {
  db.exec(SCHEMA);
  console.log(`Initialized ${path.relative(ROOT, DB_PATH)}`);
}

function snapshotCriteria(db, project, id, atState, body) {
  db.prepare(
    "INSERT INTO criteria_revisions (project,id,at_state,criteria_md) VALUES (?,?,?,?)"
  ).run(project, id, atState, extractCriteria(body));
}

function cmdImport(db, project) {
  if (!project) die("import needs a project");
  db.exec(SCHEMA);
  const projDir = path.join(ROOT, "specs", project);
  if (!fs.existsSync(projDir)) die(`specs/${project} does not exist`);
  const states = readStates();
  let n = 0;
  const insSpec = db.prepare(
    `INSERT INTO specs (project,id,title,status,verify_attempts,axis,branch,pr,body_md)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(project,id) DO UPDATE SET title=excluded.title, status=excluded.status,
       verify_attempts=excluded.verify_attempts, axis=excluded.axis,
       branch=excluded.branch, pr=excluded.pr,
       body_md=excluded.body_md, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  );
  const insDep = db.prepare("INSERT OR IGNORE INTO dependencies (project,id,depends_on) VALUES (?,?,?)");
  const insTr = db.prepare("INSERT INTO transitions (project,id,from_state,to_state,actor,at) VALUES (?,?,?,?,?,?)");
  for (const st of states) {
    const dir = path.join(projDir, st.name);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const spec = parseSpec(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!spec.id) die(`${f}: missing id`);
      if (spec.status !== st.name) die(`${f}: status '${spec.status}' but sits in ${st.name}/`);
      insSpec.run(project, spec.id, spec.title, spec.status, spec.verify_attempts, spec.axis, spec.branch, spec.pr, spec.body);
      for (const d of spec.depends_on) insDep.run(project, spec.id, d);
      let prev = null;
      for (const h of spec.history) { insTr.run(project, spec.id, prev, h.state, "import", h.ts); prev = h.state; }
      snapshotCriteria(db, project, spec.id, spec.status, spec.body);
      n++;
    }
  }
  // legacy JSONL ledger, if present
  const jl = path.join(ROOT, "memory", "spec-ledger.jsonl");
  let l = 0;
  if (fs.existsSync(jl)) {
    const ins = db.prepare("INSERT INTO ledger (project,id,title,outcome,verify_attempts,axis,at) VALUES (?,?,?,?,?,?,?)");
    for (const line of fs.readFileSync(jl, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      ins.run(r.project, r.id, r.title, r.outcome, r.verify_attempts ?? 0, r.axis ?? "", r.timestamp);
      l++;
    }
  }
  console.log(`Imported ${n} spec(s) for '${project}'${l ? `, ${l} ledger record(s)` : ""}.`);
}

function cmdList(db, project, status) {
  let sql = "SELECT project,id,status,verify_attempts,title FROM specs";
  const where = [], args = [];
  if (project) { where.push("project=?"); args.push(project); }
  if (status) { where.push("status=?"); args.push(status); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY project,id";
  const rows = db.prepare(sql).all(...args);
  if (rows.length === 0) { console.log("No specs recorded."); return; }
  for (const r of rows) {
    console.log(`${r.project}/${r.id}  [${r.status}]  attempts=${r.verify_attempts}  ${r.title}`);
  }
}

function getSpec(db, project, id) {
  const r = db.prepare("SELECT * FROM specs WHERE project=? AND id=?").get(project, id);
  if (!r) die(`no spec ${id} in '${project}'`);
  return r;
}

function cmdShow(db, project, id) {
  const r = getSpec(db, project, id);
  const deps = db.prepare("SELECT depends_on FROM dependencies WHERE project=? AND id=? ORDER BY depends_on").all(project, id);
  const trs = db.prepare("SELECT from_state,to_state,actor,at FROM transitions WHERE project=? AND id=? ORDER BY seq").all(project, id);
  const atts = db.prepare("SELECT n,overall,at FROM attempts WHERE project=? AND id=? ORDER BY n").all(project, id);
  console.log(`${r.project}/${r.id} — ${r.title}`);
  console.log(`status: ${r.status}   attempts: ${r.verify_attempts}   axis: ${r.axis || "(none)"}`);
  if (r.branch || r.pr) console.log(`branch: ${r.branch || "(none)"}   pr: ${r.pr || "(none)"}`);
  console.log(`depends_on: ${deps.map((d) => d.depends_on).join(", ") || "(none)"}`);
  for (const t of trs) console.log(`  ${t.at}  ${t.from_state ?? "·"} -> ${t.to_state}  (${t.actor})`);
  for (const a of atts) console.log(`  attempt-${a.n}: ${a.overall}  ${a.at}`);
  console.log("---");
  console.log(r.body_md.trimEnd());
}

function cmdMove(db, project, id, toState, actor = "cli") {
  const states = readStates();
  const names = states.map((s) => s.name);
  if (!names.includes(toState)) die(`'${toState}' is not a state (${names.join(", ")})`);
  const spec = getSpec(db, project, id);
  const cur = states.find((s) => s.name === spec.status);
  if (!cur.valid_next.includes(toState)) {
    die(`illegal transition '${spec.status}' -> '${toState}' (valid: ${cur.valid_next.join(", ") || "none"})`);
  }
  // unfinished-dependency gate on the way into in_progress and finished
  if (toState === "in_progress" || toState === "finished") {
    const bad = db.prepare(
      `SELECT d.depends_on FROM dependencies d
       LEFT JOIN specs s ON s.project=d.project AND s.id=d.depends_on
       WHERE d.project=? AND d.id=? AND (s.status IS NULL OR s.status != 'finished')`
    ).all(project, id);
    if (bad.length) die(`dependencies not finished: ${bad.map((b) => b.depends_on).join(", ")}`);
  }
  db.prepare("UPDATE specs SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE project=? AND id=?")
    .run(toState, project, id);
  db.prepare("INSERT INTO transitions (project,id,from_state,to_state,actor) VALUES (?,?,?,?,?)")
    .run(project, id, spec.status, toState, actor);
  snapshotCriteria(db, project, id, toState, spec.body_md);
  if (toState === "finished" || toState === "blocked") {
    db.prepare("INSERT INTO ledger (project,id,title,outcome,verify_attempts,axis) VALUES (?,?,?,?,?,?)")
      .run(project, id, spec.title, toState, spec.verify_attempts, spec.axis);
  }
  console.log(`${project}/${id}: ${spec.status} -> ${toState}`);
}

function cmdRecordAttempt(db, project, id, overall, traceFile) {
  if (overall !== "PASS" && overall !== "FAIL") die("overall must be PASS or FAIL");
  const spec = getSpec(db, project, id);
  const n = spec.verify_attempts + 1;
  const trace = traceFile ? fs.readFileSync(traceFile, "utf8") : "";
  db.prepare("INSERT INTO attempts (project,id,n,overall,trace_md) VALUES (?,?,?,?,?)")
    .run(project, id, n, overall, trace);
  if (overall === "FAIL") {
    db.prepare("UPDATE specs SET verify_attempts=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE project=? AND id=?")
      .run(n, project, id);
  }
  console.log(`${project}/${id}: attempt-${n} ${overall} recorded`);
}

function cmdDrift(db, project, id) {
  getSpec(db, project, id);
  const revs = db.prepare(
    "SELECT at_state, criteria_md, at FROM criteria_revisions WHERE project=? AND id=? ORDER BY seq DESC LIMIT 2"
  ).all(project, id);
  if (revs.length < 2) { console.log("Fewer than two criteria snapshots — nothing to compare."); return; }
  const [latest, prev] = revs;
  if (latest.criteria_md === prev.criteria_md) {
    console.log(`No drift: criteria identical between '${prev.at_state}' (${prev.at}) and '${latest.at_state}' (${latest.at}).`);
  } else {
    console.log(`DRIFT: graded sections changed between '${prev.at_state}' (${prev.at}) and '${latest.at_state}' (${latest.at}).`);
    process.exitCode = 2;
  }
}

function cmdSet(db, project, id, field, value) {
  const allowed = ["branch", "pr", "axis"];
  if (!allowed.includes(field)) die(`set supports only: ${allowed.join(", ")}`);
  getSpec(db, project, id);
  db.prepare(`UPDATE specs SET ${field}=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE project=? AND id=?`)
    .run(value ?? "", project, id);
  console.log(`${project}/${id}: ${field} set`);
}

function cmdLedger(db, project, outcome) {
  let sql = "SELECT project,id,title,outcome,verify_attempts,at FROM ledger";
  const where = [], args = [];
  if (project) { where.push("project=?"); args.push(project); }
  if (outcome) { where.push("outcome=?"); args.push(outcome); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY seq";
  const rows = db.prepare(sql).all(...args);
  if (rows.length === 0) { console.log("No matching ledger records."); return; }
  for (const r of rows) console.log(`${r.at}  ${r.project}/${r.id}  ${r.outcome}  attempts=${r.verify_attempts}  ${r.title}`);
}

function cmdExport(db, project, id) {
  const r = getSpec(db, project, id);
  const deps = db.prepare("SELECT depends_on FROM dependencies WHERE project=? AND id=? ORDER BY depends_on").all(project, id);
  const trs = db.prepare("SELECT to_state,at FROM transitions WHERE project=? AND id=? ORDER BY seq").all(project, id);
  const fm = [
    "---",
    `id: "${r.id}"`,
    `title: ${r.title}`,
    `status: ${r.status}`,
    `depends_on: [${deps.map((d) => `"${d.depends_on}"`).join(", ")}]`,
    `verify_attempts: ${r.verify_attempts}`,
    `branch: "${r.branch}"`,
    `pr: "${r.pr}"`,
    trs.length ? "history:" : "history: []",
    ...trs.map((t) => `  - ${t.to_state} ${t.at}`),
    `axis: "${r.axis}"`,
    "---",
  ].join("\n");
  process.stdout.write(fm + "\n" + r.body_md);
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  switch (cmd) {
    case "init": cmdInit(db); break;
    case "import": cmdImport(db, args[0]); break;
    case "list": cmdList(db, args[0], args[1]); break;
    case "show": cmdShow(db, args[0], args[1]); break;
    case "move": cmdMove(db, args[0], args[1], args[2], args[3]); break;
    case "record-attempt": cmdRecordAttempt(db, args[0], args[1], args[2], args[3]); break;
    case "drift": cmdDrift(db, args[0], args[1]); break;
    case "set": cmdSet(db, args[0], args[1], args[2], args[3]); break;
    case "ledger": cmdLedger(db, args[0], args[1]); break;
    case "export": cmdExport(db, args[0], args[1]); break;
    default:
      console.error("Usage: spec-db.mjs <init|import|list|show|move|record-attempt|drift|set|ledger|export> ...");
      process.exit(1);
  }
}
