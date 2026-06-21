#!/usr/bin/env node
// Local browser dashboard for scripts/token-usage.mjs — same data, viewable
// at http://localhost:<port>/ instead of a terminal. No DB, no build step;
// every request reads the session transcript files live.
//
// Usage:
//   node scripts/token-dashboard.mjs            # default port 4500
//   node scripts/token-dashboard.mjs --port 5000
//   PORT=5000 node scripts/token-dashboard.mjs

import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectSlug, findSessionFiles, loadUsageRows, sumTotals } from './token-usage.mjs';

const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Token usage</title>
<style>
  body { font-family: ui-monospace, monospace; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.1rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.85rem; }
  th, td { text-align: right; padding: 0.25rem 0.6rem; border-bottom: 1px solid #ddd; }
  th:first-child, td:first-child { text-align: left; }
  th { background: #f4f4f4; position: sticky; top: 0; }
  tfoot td { font-weight: bold; border-top: 2px solid #333; border-bottom: none; }
  .session-row td { text-align: left; background: #eef3fb; font-weight: bold; padding-top: 0.5rem; }
  .session-row .meta { font-weight: normal; color: #666; }
  .meta { color: #666; font-size: 0.8rem; margin-top: 0.5rem; }
  .empty { color: #b00; margin-top: 1rem; }
  label { font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Token usage</h1>
<label><input type="checkbox" id="all"> show all sessions (not just latest)</label>
<div id="content">Loading…</div>
<script>
const content = document.getElementById('content');
const allBox = document.getElementById('all');

async function load() {
  const url = '/api/usage' + (allBox.checked ? '?all=1' : '');
  const res = await fetch(url);
  const data = await res.json();

  if (!data.rows || data.rows.length === 0) {
    content.innerHTML = '<p class="empty">' + (data.message || 'No usage data found.') + '</p>';
    return;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  let lastSession = null;
  const rowsHtml = data.rows.map((r, i) => {
    let header = '';
    if (r.session !== lastSession) {
      header = '<tr class="session-row"><td colspan="7">' + esc(r.title || '(untitled session)') +
        ' <span class="meta">(' + r.session + ')</span></td></tr>';
      lastSession = r.session;
    }
    const total = r.input + r.cacheCreate + r.cacheRead + r.output;
    return header + '<tr><td>' + (i + 1) + '</td><td>' + total + '</td><td>' + r.input +
      '</td><td>' + r.cacheCreate + '</td><td>' + r.cacheRead + '</td><td>' + r.output +
      '</td><td>' + (r.timestamp || '') + '</td></tr>';
  }).join('');

  const t = data.totals;
  content.innerHTML =
    '<table><thead><tr><th>#</th><th>total</th><th>input</th><th>cache_create</th>' +
    '<th>cache_read</th><th>output</th><th>timestamp</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '<tfoot><tr><td colspan="2">TOTAL</td><td>' + t.input + '</td><td>' + t.cacheCreate +
    '</td><td>' + t.cacheRead + '</td><td>' + t.output + '</td><td>grand: ' + t.grandTotal + '</td></tr></tfoot>' +
    '</table>' +
    '<p class="meta">' + data.sessionCount + ' session(s), ' + data.rows.length + ' request(s) — refreshes every 5s</p>';
}

allBox.addEventListener('change', load);
load();
setInterval(load, 5000);
</script>
</body>
</html>`;

function getUsageData({ all }) {
  const projectDir = join(homedir(), '.claude', 'projects', projectSlug(process.cwd()));
  const files = findSessionFiles(projectDir, { all, sessionId: undefined });

  if (files.length === 0) {
    return { rows: [], totals: sumTotals([]), sessionCount: 0, message: `No session transcripts found under ${projectDir}` };
  }

  const rows = loadUsageRows(projectDir, files);
  if (rows.length === 0) {
    return { rows: [], totals: sumTotals([]), sessionCount: files.length, message: 'No assistant turns with usage data found.' };
  }

  return { rows, totals: sumTotals(rows), sessionCount: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const portArgIdx = args.indexOf('--port');
  const port = Number(portArgIdx !== -1 ? args[portArgIdx + 1] : process.env.PORT || 4500);

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/api/usage') {
      const all = url.searchParams.get('all') === '1';
      const data = getUsageData({ all });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`Token usage dashboard: http://localhost:${port}/`);
  });
}

main();
