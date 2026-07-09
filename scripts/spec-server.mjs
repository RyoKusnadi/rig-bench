#!/usr/bin/env node
// spec-server.mjs — read-only HTTP layer over spec.db, plus the static frontend.
//
// Phase 3 of the DB migration: a thin JSON API over the same queries the CLI runs.
// Deliberately read-only — every mutation still goes through scripts/spec-db.mjs (the
// gate that enforces valid_next and the dependency rule); this server only observes.
// Zero dependencies: node:http + node:sqlite via spec-db.mjs's exports.
//
// Endpoints:
//   GET /health
//   GET /api/states                         state machine (from workflows/state.yaml)
//   GET /api/specs?project=&status=         list
//   GET /api/specs/:project/:id             detail: spec + deps + transitions + attempts
//   GET /api/specs/:project/:id/attempts/:n full trace body
//   GET /api/specs/:project/:id/drift       latest two criteria snapshots + changed flag
//   GET /api/ledger?project=&outcome=
//   GET /api/metrics?project=               per-state counts, attempts distribution, failure rate
//   GET /                                   web/index.html (the dashboard)
//
// Usage: node scripts/spec-server.mjs [port]   (default 4870; SPECDB_PATH/SPECDB_ROOT respected)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, readStates } from "./spec-db.mjs";

const ROOT = process.env.SPECDB_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = path.join(ROOT, "web", "index.html");

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
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

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname.replace(/\/+$/, "") || "/";
    const q = u.searchParams;
    try {
      if (req.method !== "GET") return json(res, 405, { error: "read-only server" });
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
      if (p === "/api/ledger") return json(res, 200, h.ledger(q.get("project"), q.get("outcome")));
      if (p === "/api/metrics") return json(res, 200, h.metrics(q.get("project")));
      if (p === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(INDEX_HTML));
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: String(e.message ?? e) });
    }
  });

  server.listen(port);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4870);
  const server = startServer({ port });
  server.on("listening", () => console.log(`spec-server: http://localhost:${server.address().port}`));
}
