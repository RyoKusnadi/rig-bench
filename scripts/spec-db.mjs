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
//   scripts/spec-db.mjs memory [notebook] [spec_id]          (list)
//   scripts/spec-db.mjs memory add <notebook> <heading> <body> [spec_id]
//   scripts/spec-db.mjs memory search <term>
//   scripts/spec-db.mjs memory show <notebook> <seq>
//   scripts/spec-db.mjs memory export [notebook]
//   scripts/spec-db.mjs memory edit <notebook> <seq> <heading|body|spec_id> <value>
//   scripts/spec-db.mjs memory delete <notebook> <seq>       (soft delete; seq never reused)
//   scripts/spec-db.mjs research                              (list)
//   scripts/spec-db.mjs research add <topic> <title> <body-file> [sources-json]
//   scripts/spec-db.mjs research show <seq|slug>
//   scripts/spec-db.mjs research search <term>
//   scripts/spec-db.mjs research export [seq|slug]
//   scripts/spec-db.mjs research edit <seq|slug> <title|topic|body|sources> <value>
//   scripts/spec-db.mjs research delete <seq|slug>
//   scripts/spec-db.mjs ledger [project] [outcome]
//   scripts/spec-db.mjs export <project> <id>

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 5)) {
  // Throw (don't process.exit) so importers — the server, the test runner — get a
  // clean, attributable failure with this message instead of a silent process death.
  throw new Error(
    `spec-db requires Node >= 22.5 (node:sqlite). Current: ${process.versions.node}. ` +
    `CI note: .github/workflows/checks.yml must pin node-version '22'.`
  );
}
const { DatabaseSync } = await import("node:sqlite");
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ── memory notebook parser: "## <heading>" delimited entries; markdown stays the
//    authoritative, committed source — the DB is a queryable mirror refreshed on import ──
export function parseMemory(text) {
  const entries = [];
  const parts = text.split(/^## /m).slice(1); // drop preamble
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : part.slice(nl + 1)).trim();
    const specId = heading.match(/\(spec (\d{4})/)?.[1] ?? "";
    entries.push({ heading, spec_id: specId, body });
  }
  return entries;
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
  // busy_timeout: the server holds a long-lived connection while the CLI opens its own;
  // WAL allows one writer at a time, and without a timeout a concurrent write throws
  // SQLITE_BUSY immediately instead of briefly waiting its turn.
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;");
  // migration: pre-0035 DBs lack memory_entries.deleted — CREATE TABLE IF NOT EXISTS
  // can't add a column to an existing table, so both the CLI and the server (which all
  // pass through here) upgrade in place.
  const hasMem = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_entries'").get();
  if (hasMem && !db.prepare("PRAGMA table_info(memory_entries)").all().some((c) => c.name === "deleted")) {
    db.exec("ALTER TABLE memory_entries ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
  }
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
CREATE TABLE IF NOT EXISTS memory_entries (
  notebook TEXT NOT NULL,
  seq INTEGER NOT NULL,
  heading TEXT NOT NULL,
  spec_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- soft delete: entries are cited externally as notebook#seq, so a tombstone keeps
  -- occupying its seq and MAX(seq)+1 in \`memory add\` can never re-issue a deleted number
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notebook, seq)
);
CREATE TABLE IF NOT EXISTS criteria_revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, id TEXT NOT NULL,
  at_state TEXT NOT NULL,
  criteria_md TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS research_reports (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

// Mutation cores throw instead of exiting — die() would kill the server process that
// shares them. `status` maps to the HTTP code (400/404/409); CLI wrappers catch → die().
function fail(status, msg) { const e = new Error(msg); e.status = status; throw e; }

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
  // memory notebooks: mirror into memory_entries (markdown stays authoritative)
  let m = 0;
  const memDir = path.join(ROOT, "memory");
  if (fs.existsSync(memDir)) {
    const insM = db.prepare("INSERT INTO memory_entries (notebook,seq,heading,spec_id,body) VALUES (?,?,?,?,?)");
    for (const f of fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
      const notebook = f.replace(/\.md$/, "");
      db.prepare("DELETE FROM memory_entries WHERE notebook=?").run(notebook);
      parseMemory(fs.readFileSync(path.join(memDir, f), "utf8")).forEach((e, i) => {
        insM.run(notebook, i + 1, e.heading, e.spec_id, e.body);
        m++;
      });
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
  console.log(`Imported ${n} spec(s) for '${project}'${l ? `, ${l} ledger record(s)` : ""}${m ? `, ${m} memory entr${m === 1 ? "y" : "ies"}` : ""}.`);
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

function findSpecFile(project, id) {
  const projDir = path.join(ROOT, "specs", project);
  if (!fs.existsSync(projDir)) return null;
  for (const state of readStates()) {
    const dir = path.join(projDir, state.name);
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith(".md"));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

function cmdMove(db, project, id, toState, actor = "cli") {
  const states = readStates();
  const names = states.map((s) => s.name);
  if (!names.includes(toState)) die(`'${toState}' is not a state (${names.join(", ")})`);
  let spec = getSpec(db, project, id);
  // Dual-write: the file tree is the source of truth, and the body may have been edited
  // on disk since import. Refresh from the file (when present) before snapshotting, so a
  // criteria snapshot records what the spec says NOW — otherwise drift compares two
  // copies of the same stale import and mid-flight tampering is invisible.
  const file = findSpecFile(project, id);
  if (file) {
    const parsed = parseSpec(fs.readFileSync(file, "utf8"));
    if (parsed.body !== spec.body_md) {
      db.prepare("UPDATE specs SET body_md=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE project=? AND id=?")
        .run(parsed.body, project, id);
      spec = { ...spec, body_md: parsed.body };
    }
  }
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

// Core memory mutations shared by the CLI wrappers and the server's PATCH/DELETE
// handlers. Delete is a soft delete (tombstone row) so a cited notebook#seq is never
// re-issued to an unrelated entry — see the schema comment on memory_entries.deleted.
export function memoryEdit(db, notebook, seq, patch) {
  const allowed = ["heading", "body", "spec_id"];
  const keys = Object.keys(patch ?? {});
  if (keys.length === 0) fail(400, `no editable fields in patch (editable: ${allowed.join(", ")})`);
  const sets = [], vals = [];
  for (const k of keys) {
    if (!allowed.includes(k)) fail(400, `unknown field '${k}' (editable: ${allowed.join(", ")})`);
    if (typeof patch[k] !== "string") fail(400, `${k} must be a string`);
    sets.push(`${k}=?`);
    vals.push(patch[k]);
  }
  const live = db.prepare("SELECT 1 FROM memory_entries WHERE notebook=? AND seq=? AND deleted=0").get(notebook, seq);
  if (!live) fail(404, `no entry ${notebook}#${seq}`);
  db.prepare(`UPDATE memory_entries SET ${sets.join(", ")} WHERE notebook=? AND seq=?`).run(...vals, notebook, seq);
  return db.prepare("SELECT notebook,seq,heading,spec_id,body FROM memory_entries WHERE notebook=? AND seq=?").get(notebook, seq);
}

export function memoryDelete(db, notebook, seq) {
  const res = db.prepare("UPDATE memory_entries SET deleted=1 WHERE notebook=? AND seq=? AND deleted=0").run(notebook, seq);
  if (res.changes === 0) fail(404, `no entry ${notebook}#${seq}`);
  return { deleted: true };
}

function cmdMemory(db, ...args) {
  const sub = ["add", "search", "show", "export", "edit", "delete"].includes(args[0]) ? args.shift() : "list";
  if (sub === "edit") {
    const [notebook, seq, field, value] = args;
    if (!notebook || !seq || !field || value === undefined) die("memory edit <notebook> <seq> <heading|body|spec_id> <value>");
    try {
      memoryEdit(db, notebook, Number(seq), { [field]: value });
      console.log(`${notebook}#${seq} updated`);
    } catch (e) { die(e.message); }
    return;
  }
  if (sub === "delete") {
    const [notebook, seq] = args;
    if (!notebook || !seq) die("memory delete <notebook> <seq>");
    try {
      memoryDelete(db, notebook, Number(seq));
      console.log(`${notebook}#${seq} deleted (its seq will not be reused)`);
    } catch (e) { die(e.message); }
    return;
  }
  if (sub === "add") {
    const [notebook, heading, body, specId] = args;
    if (!notebook || !heading) die("memory add <notebook> <heading> <body> [spec_id]");
    const seq = (db.prepare("SELECT COALESCE(MAX(seq),0) m FROM memory_entries WHERE notebook=?").get(notebook).m) + 1;
    db.prepare("INSERT INTO memory_entries (notebook,seq,heading,spec_id,body) VALUES (?,?,?,?,?)")
      .run(notebook, seq, heading, specId ?? "", body ?? "");
    console.log(`${notebook}#${seq} recorded`);
    return;
  }
  if (sub === "search") {
    const term = args[0];
    if (!term) die("memory search <term>");
    const rows = db.prepare(
      "SELECT notebook,seq,heading,spec_id FROM memory_entries WHERE (heading LIKE ? OR body LIKE ?) AND deleted=0 ORDER BY notebook,seq"
    ).all(`%${term}%`, `%${term}%`);
    if (rows.length === 0) { console.log(`No memory entries match '${term}'.`); return; }
    for (const r of rows) console.log(`${r.notebook}#${r.seq}${r.spec_id ? ` [spec ${r.spec_id}]` : ""}  ${r.heading}`);
    return;
  }
  if (sub === "show") {
    const [notebook, seq] = args;
    const r = db.prepare("SELECT * FROM memory_entries WHERE notebook=? AND seq=? AND deleted=0").get(notebook, Number(seq));
    if (!r) die(`no entry ${notebook}#${seq}`);
    console.log(`## ${r.heading}\n\n${r.body}`);
    return;
  }
  if (sub === "export") {
    const notebooks = args[0]
      ? [args[0]]
      : db.prepare("SELECT DISTINCT notebook FROM memory_entries WHERE deleted=0 ORDER BY notebook").all().map((r) => r.notebook);
    for (const nb of notebooks) {
      const rows = db.prepare("SELECT heading,body FROM memory_entries WHERE notebook=? AND deleted=0 ORDER BY seq").all(nb);
      process.stdout.write(`# ${nb}\n\n` + rows.map((r) => `## ${r.heading}\n\n${r.body}\n`).join("\n") + "\n");
    }
    return;
  }
  // list [notebook] [spec_id]
  const [notebook, specId] = args;
  let sql = "SELECT notebook,seq,heading,spec_id FROM memory_entries";
  const where = ["deleted=0"], qargs = [];
  if (notebook) { where.push("notebook=?"); qargs.push(notebook); }
  if (specId) { where.push("spec_id=?"); qargs.push(specId); }
  sql += " WHERE " + where.join(" AND ");
  const rows = db.prepare(sql + " ORDER BY notebook,seq").all(...qargs);
  if (rows.length === 0) { console.log("No memory entries recorded."); return; }
  for (const r of rows) console.log(`${r.notebook}#${r.seq}${r.spec_id ? ` [spec ${r.spec_id}]` : ""}  ${r.heading}`);
}

export function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    .replace(/-+$/, "") || "report";
}

export function findResearch(db, key) {
  return /^\d+$/.test(key)
    ? db.prepare("SELECT * FROM research_reports WHERE seq=?").get(Number(key))
    : db.prepare("SELECT * FROM research_reports WHERE slug=?").get(String(key));
}

// Core mutations shared by the CLI wrappers below and the server's PATCH/DELETE handlers
// (decisions#3: research reports are mutable; slug and seq are the stable citation keys,
// so title edits never re-slugify, and the AUTOINCREMENT seq of a deleted report is never
// reused — stale citations 404 instead of aliasing to a future report).
export function researchEdit(db, key, patch) {
  db.exec(SCHEMA); // pre-upgrade DBs lack the table; 404 beats a missing-table throw
  const r = findResearch(db, key);
  if (!r) fail(404, `no report '${key}'`);
  const allowed = ["title", "topic", "body_md", "sources"];
  const keys = Object.keys(patch ?? {});
  if (keys.length === 0) fail(400, `no editable fields in patch (editable: ${allowed.join(", ")})`);
  const sets = [], vals = [];
  for (const k of keys) {
    if (!allowed.includes(k)) fail(400, `unknown field '${k}' (editable: ${allowed.join(", ")})`);
    let v = patch[k];
    if (k === "sources") {
      if (!Array.isArray(v)) fail(400, "sources must be a JSON array of URLs");
      v = JSON.stringify(v);
    } else if (typeof v !== "string") {
      fail(400, `${k} must be a string`);
    }
    sets.push(`${k}=?`);
    vals.push(v);
  }
  db.prepare(`UPDATE research_reports SET ${sets.join(", ")} WHERE seq=?`).run(...vals, r.seq);
  return findResearch(db, String(r.seq));
}

export function researchDelete(db, key) {
  db.exec(SCHEMA);
  const r = findResearch(db, key);
  if (!r) fail(404, `no report '${key}'`);
  db.prepare("DELETE FROM research_reports WHERE seq=?").run(r.seq);
  return { deleted: true, seq: r.seq, slug: r.slug };
}

function cmdResearch(db, ...args) {
  db.exec(SCHEMA); // reports must land even on a DB created before this table existed
  const sub = ["add", "search", "show", "export", "edit", "delete"].includes(args[0]) ? args.shift() : "list";
  const bySeqOrSlug = (key) => findResearch(db, key);
  if (sub === "edit") {
    const [key, field, value] = args;
    if (!key || !field || value === undefined) die("research edit <seq|slug> <title|topic|body|sources> <value>");
    const patch = {};
    if (field === "body") {
      if (!fs.existsSync(value)) die(`body file '${value}' does not exist`);
      patch.body_md = fs.readFileSync(value, "utf8");
    } else if (field === "sources") {
      try { patch.sources = JSON.parse(value); } catch { die("sources value is not valid JSON"); }
    } else {
      patch[field] = value; // researchEdit whitelists unknown fields
    }
    try {
      const r = researchEdit(db, key, patch);
      console.log(`research#${r.seq} (${r.slug}) updated`);
    } catch (e) { die(e.message); }
    return;
  }
  if (sub === "delete") {
    const key = args[0];
    if (!key) die("research delete <seq|slug>");
    try {
      const r = researchDelete(db, key);
      console.log(`research#${r.seq} (${r.slug}) deleted`);
    } catch (e) { die(e.message); }
    return;
  }
  if (sub === "add") {
    const [topic, title, bodyFile, sourcesJson] = args;
    if (!topic || !title || !bodyFile) die("research add <topic> <title> <body-file> [sources-json]");
    if (!fs.existsSync(bodyFile)) die(`body file '${bodyFile}' does not exist`);
    const body = fs.readFileSync(bodyFile, "utf8");
    let sources = "[]";
    if (sourcesJson) {
      let parsed;
      try { parsed = JSON.parse(sourcesJson); } catch { die("sources-json is not valid JSON"); }
      if (!Array.isArray(parsed)) die("sources-json must be a JSON array of URLs");
      sources = JSON.stringify(parsed);
    }
    const base = slugify(title);
    let slug = base;
    for (let n = 2; db.prepare("SELECT 1 FROM research_reports WHERE slug=?").get(slug); n++) slug = `${base}-${n}`;
    db.prepare("INSERT INTO research_reports (slug,topic,title,body_md,sources) VALUES (?,?,?,?,?)")
      .run(slug, topic, title, body, sources);
    const seq = db.prepare("SELECT seq FROM research_reports WHERE slug=?").get(slug).seq;
    console.log(`research#${seq} (${slug}) recorded`);
    return;
  }
  if (sub === "show") {
    const key = args[0];
    if (!key) die("research show <seq|slug>");
    const r = bySeqOrSlug(key);
    if (!r) die(`no report '${key}'`);
    const sources = JSON.parse(r.sources);
    console.log(`# ${r.title}`);
    console.log(`topic: ${r.topic}`);
    console.log(`created: ${r.created_at}`);
    if (sources.length) console.log(`sources:\n${sources.map((s) => `  - ${s}`).join("\n")}`);
    console.log(`---\n${r.body_md}`);
    return;
  }
  if (sub === "search") {
    const term = args[0];
    if (!term) die("research search <term>");
    const rows = db.prepare(
      "SELECT seq,slug,topic,title,created_at FROM research_reports WHERE topic LIKE ? OR title LIKE ? OR body_md LIKE ? ORDER BY seq"
    ).all(`%${term}%`, `%${term}%`, `%${term}%`);
    if (rows.length === 0) { console.log(`No research reports match '${term}'.`); return; }
    for (const r of rows) console.log(`research#${r.seq}  ${r.created_at}  ${r.title} — ${r.topic}`);
    return;
  }
  if (sub === "export") {
    const rows = args[0]
      ? [bySeqOrSlug(args[0]) ?? die(`no report '${args[0]}'`)]
      : db.prepare("SELECT * FROM research_reports ORDER BY seq").all();
    for (const r of rows) {
      process.stdout.write(`# ${r.title}\n\ntopic: ${r.topic} · created: ${r.created_at}\n\n${r.body_md}\n\n`);
    }
    return;
  }
  // list
  const rows = db.prepare("SELECT seq,slug,topic,title,created_at FROM research_reports ORDER BY seq").all();
  if (rows.length === 0) { console.log("No research reports recorded."); return; }
  for (const r of rows) console.log(`research#${r.seq}  ${r.created_at}  ${r.title} — ${r.topic}`);
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
// Realpath-based main-module guard (mirrors the es-main npm package, kept inline —
// zero-dependency repo). Node resolves the ESM entry point to its realpath, so a naive
// `import.meta.url === file://argv[1]` comparison fails when the invocation path has a
// symlinked component (macOS tmpdir) or characters needing URL encoding, silently
// turning every CLI command into a no-op.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; }
  catch { return false; } // argv[1] not resolvable on disk → not our entry
})();
const [cmd, ...args] = process.argv.slice(2);
if (isMain) {
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
    case "memory": cmdMemory(db, ...args); break;
    case "research": cmdResearch(db, ...args); break;
    case "ledger": cmdLedger(db, args[0], args[1]); break;
    case "export": cmdExport(db, args[0], args[1]); break;
    default:
      console.error("Usage: spec-db.mjs <init|import|list|show|move|record-attempt|drift|set|memory|research|ledger|export> ...");
      process.exit(1);
  }
}
