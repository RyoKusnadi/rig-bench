#!/usr/bin/env node
// spec-server.mjs — HTTP layer over spec.db, plus the static frontend.
//
// Phase 3 of the DB migration: a thin JSON API over the same queries the CLI runs.
// Read-only by default — the MUTABLE allowlist below names the few endpoints that accept
// mutations, and every one of them routes through the same exported spec-db.mjs core
// functions the CLI uses, so validation (field whitelists, valid_next, dependency rules)
// is enforced identically on both surfaces (decisions#3/#4).
// Zero dependencies: node:http + node:sqlite via spec-db.mjs's exports.
//
// Endpoints:
//   GET /health
//   GET /api/states                         state machine (from workflows/state.yaml)
//   GET /api/specs?project=&status=         list
//   GET /api/specs/:project/:id             detail: spec + deps + transitions + attempts
//   GET /api/specs/:project/:id/attempts/:n full trace body
//   GET /api/specs/:project/:id/drift       latest two criteria snapshots + changed flag
//   GET /api/memory?notebook=&spec_id=       mirrored memory notebook entries
//   GET /api/research?q=                     research report list (no bodies)
//   GET /api/research/:seqOrSlug             full report incl. body_md
//   PATCH /api/research/:seqOrSlug           edit title/topic/body_md/sources (slug stable)
//   DELETE /api/research/:seqOrSlug          delete a report
//   GET /api/ledger?project=&outcome=
//   GET /api/metrics?project=               per-state counts, attempts distribution, failure rate
//   GET /                                   web/index.html (the dashboard)
//
// Usage: node scripts/spec-server.mjs [port]   (default 4870; SPECDB_PATH/SPECDB_ROOT respected)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDb, readStates, researchEdit, researchDelete } from "./spec-db.mjs";

const ROOT = process.env.SPECDB_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = path.join(ROOT, "web", "index.html");

function safeParseArray(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// pre-upgrade DBs lack research_reports; the dashboard should see [] there, not a 500
function hasResearchTable(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_reports'").get();
}

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// JSON body reader for the mutation endpoints: capped, parsed, and required to be a
// plain object — a bad body is a 400 from here, never a 500 from destructuring later.
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw httpErr(400, "body too large (1 MB cap)");
    chunks.push(c);
  }
  let v;
  try { v = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw httpErr(400, "invalid JSON body"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw httpErr(400, "body must be a JSON object");
  return v;
}

export function buildHandlers(db) {
  return {
    states: () => readStates(path.join(ROOT, "workflows", "state.yaml")),

    specs: (project, status) => {
      let sql = "SELECT project,id,title,status,verify_attempts,axis,branch,pr,updated_at FROM specs";
      const where = [], args = [];
      if (project) { where.push("project=?"); args.push(project); }
      if (status) { where.push("status=?"); args.push(status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      return db.prepare(sql + " ORDER BY project,id").all(...args);
    },

    spec: (project, id) => {
      const spec = db.prepare("SELECT * FROM specs WHERE project=? AND id=?").get(project, id);
      if (!spec) return null;
      return {
        ...spec,
        depends_on: db.prepare("SELECT depends_on FROM dependencies WHERE project=? AND id=? ORDER BY depends_on")
          .all(project, id).map((r) => r.depends_on),
        transitions: db.prepare("SELECT from_state,to_state,actor,at FROM transitions WHERE project=? AND id=? ORDER BY seq")
          .all(project, id),
        attempts: db.prepare("SELECT n,overall,at FROM attempts WHERE project=? AND id=? ORDER BY n")
          .all(project, id),
      };
    },

    attempt: (project, id, n) =>
      db.prepare("SELECT n,overall,trace_md,at FROM attempts WHERE project=? AND id=? AND n=?").get(project, id, Number(n)) ?? null,

    drift: (project, id) => {
      const revs = db.prepare(
        "SELECT at_state,criteria_md,at FROM criteria_revisions WHERE project=? AND id=? ORDER BY seq DESC LIMIT 2"
      ).all(project, id);
      if (revs.length < 2) return { comparable: false };
      const [latest, prev] = revs;
      return { comparable: true, changed: latest.criteria_md !== prev.criteria_md, latest, prev };
    },

    memory: (notebook, specId) => {
      let sql = "SELECT notebook,seq,heading,spec_id,body FROM memory_entries";
      const where = [], args = [];
      if (notebook) { where.push("notebook=?"); args.push(notebook); }
      if (specId) { where.push("spec_id=?"); args.push(specId); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      return db.prepare(sql + " ORDER BY notebook,seq").all(...args);
    },

    research: (q) => {
      if (!hasResearchTable(db)) return [];
      let sql = "SELECT seq,slug,topic,title,created_at,sources FROM research_reports";
      const args = [];
      if (q) { sql += " WHERE topic LIKE ? OR title LIKE ? OR body_md LIKE ?"; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      return db.prepare(sql + " ORDER BY seq DESC").all(...args)
        .map((r) => ({ ...r, sources: safeParseArray(r.sources) }));
    },

    researchOne: (key) => {
      if (!hasResearchTable(db)) return null;
      const r = /^\d+$/.test(key)
        ? db.prepare("SELECT * FROM research_reports WHERE seq=?").get(Number(key))
        : db.prepare("SELECT * FROM research_reports WHERE slug=?").get(key);
      return r ? { ...r, sources: safeParseArray(r.sources) } : null;
    },

    // mutation delegates — validation lives in spec-db.mjs's exported cores, never here
    researchEdit: (key, patch) => {
      const r = researchEdit(db, key, patch);
      return { ...r, sources: safeParseArray(r.sources) };
    },
    researchDelete: (key) => researchDelete(db, key),

    ledger: (project, outcome) => {
      let sql = "SELECT project,id,title,outcome,verify_attempts,axis,at FROM ledger";
      const where = [], args = [];
      if (project) { where.push("project=?"); args.push(project); }
      if (outcome) { where.push("outcome=?"); args.push(outcome); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      return db.prepare(sql + " ORDER BY seq").all(...args);
    },

    metrics: (project) => {
      const w = project ? " WHERE project=?" : "";
      const a = project ? [project] : [];
      const byState = Object.fromEntries(
        db.prepare(`SELECT status, COUNT(*) c FROM specs${w} GROUP BY status`).all(...a).map((r) => [r.status, r.c])
      );
      const attemptsDist = Object.fromEntries(
        db.prepare(`SELECT verify_attempts k, COUNT(*) c FROM specs${w} GROUP BY verify_attempts`).all(...a).map((r) => [r.k, r.c])
      );
      const fin = db.prepare(`SELECT COUNT(*) c FROM specs${w}${w ? " AND" : " WHERE"} status='finished'`).all(...a)[0].c;
      const finFailed = db.prepare(
        `SELECT COUNT(*) c FROM specs${w}${w ? " AND" : " WHERE"} status='finished' AND verify_attempts>0`
      ).all(...a)[0].c;
      return {
        by_state: byState,
        attempts_distribution: attemptsDist,
        finished: fin,
        finished_with_failed_attempts: finFailed,
        failure_rate_pct: fin ? Math.round((100 * finFailed) / fin) : 0,
      };
    },
  };
}

export function startServer({ port = 4870 } = {}) {
  const db = openDb();
  const h = buildHandlers(db);

  // Routes that accept mutations; everything else stays GET-only. OPTIONS is deliberately
  // NOT handled anywhere: PATCH/DELETE (and POST with a JSON content-type) always trigger
  // a CORS preflight, so browsers refuse cross-origin mutation — only the same-origin
  // dashboard and local non-browser tools can mutate. Do not "fix" OPTIONS support.
  const MUTABLE = [
    /^\/api\/research\/[^/]+$/, // PATCH, DELETE
  ];

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname.replace(/\/+$/, "") || "/";
    const q = u.searchParams;
    try {
      if (req.method !== "GET" && !MUTABLE.some((re) => re.test(p)))
        return json(res, 405, { error: "read-only endpoint" });
      if (p === "/health") return json(res, 200, { ok: true });
      if (p === "/api/states") return json(res, 200, h.states());
      if (p === "/api/specs") return json(res, 200, h.specs(q.get("project"), q.get("status")));
      let m;
      if ((m = p.match(/^\/api\/specs\/([^/]+)\/([^/]+)\/attempts\/(\d+)$/))) {
        const r = h.attempt(m[1], m[2], m[3]);
        return r ? json(res, 200, r) : json(res, 404, { error: "no such attempt" });
      }
      if ((m = p.match(/^\/api\/specs\/([^/]+)\/([^/]+)\/drift$/))) return json(res, 200, h.drift(m[1], m[2]));
      if ((m = p.match(/^\/api\/specs\/([^/]+)\/([^/]+)$/))) {
        const r = h.spec(m[1], m[2]);
        return r ? json(res, 200, r) : json(res, 404, { error: "no such spec" });
      }
      if (p === "/api/memory") return json(res, 200, h.memory(q.get("notebook"), q.get("spec_id")));
      if ((m = p.match(/^\/api\/research\/([^/]+)$/))) {
        if (req.method === "PATCH") return json(res, 200, h.researchEdit(m[1], await readJson(req)));
        if (req.method === "DELETE") return json(res, 200, h.researchDelete(m[1]));
        if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
        const r = h.researchOne(m[1]);
        return r ? json(res, 200, r) : json(res, 404, { error: "no such report" });
      }
      if (p === "/api/research") return json(res, 200, h.research(q.get("q")));
      if (p === "/api/ledger") return json(res, 200, h.ledger(q.get("project"), q.get("outcome")));
      if (p === "/api/metrics") return json(res, 200, h.metrics(q.get("project")));
      if (p === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(INDEX_HTML));
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, e.status ?? 500, { error: String(e.message ?? e) });
    }
  });

  server.listen(port);
  return server;
}

// Realpath-based main-module guard — same rationale and shape as spec-db.mjs's; kept
// inline because these are separate processes and the repo has no shared lib module.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; }
  catch { return false; } // argv[1] not resolvable on disk → not our entry
})();
if (isMain) {
  const port = Number(process.argv[2] ?? 4870);
  const server = startServer({ port });
  server.on("listening", () => console.log(`spec-server: http://localhost:${server.address().port}`));
}
