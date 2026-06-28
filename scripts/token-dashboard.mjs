#!/usr/bin/env node
// Local browser dashboard for scripts/token-usage.mjs — sessions list ->
// per-request breakdown (with the actual prompt text) -> per-turn raw
// transcript viewer, all viewable at http://localhost:<port>/ instead of
// a terminal. No DB, no build step; every request reads the session
// transcript files live.
//
// Usage:
//   node scripts/token-dashboard.mjs            # default port 4500
//   node scripts/token-dashboard.mjs --port 5000
//   PORT=5000 node scripts/token-dashboard.mjs

import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  projectSlug,
  findSessionFiles,
  loadSessionsSummary,
  buildSessionRequests,
} from './token-usage.mjs';

const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Token usage</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 text-gray-900 font-sans min-h-screen">
<div class="max-w-5xl mx-auto p-6">
<h1 class="text-xl font-semibold mb-4">Token usage</h1>
<div id="content">
  <div class="flex items-center gap-2 text-gray-500 text-sm py-6">
    <svg class="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
    Loading…
  </div>
</div>
</div>
<script>
const content = document.getElementById('content');
const FILTER_IDS = ['q', 'from', 'to'];
const SPINNER = '<div class="flex items-center gap-2 text-gray-500 text-sm py-6">' +
  '<svg class="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">' +
  '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
  '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Loading…</div>';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function getSessionFromUrl() {
  return new URLSearchParams(location.search).get('session');
}

function setSessionInUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  history.replaceState(null, '', url);
}

function filtersBar(q, from, to) {
  return '<div class="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3 mb-4 text-sm shadow-sm">' +
    '<input id="q" class="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="search title/request text" value="' + esc(q) + '">' +
    '<label class="flex items-center gap-1 text-gray-500">from <input id="from" type="date" class="border border-gray-300 rounded px-2 py-1 text-sm" value="' + esc(from) + '"></label>' +
    '<label class="flex items-center gap-1 text-gray-500">to <input id="to" type="date" class="border border-gray-300 rounded px-2 py-1 text-sm" value="' + esc(to) + '"></label>' +
    '</div>';
}

function usageSummaryBar(overall, today) {
  function card(label, t) {
    return '<div class="flex-1 bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3">' +
      '<div class="text-xs text-gray-500 uppercase tracking-wide">' + label + '</div>' +
      '<div class="text-lg font-semibold text-blue-700 font-mono">' + t.grandTotal.toLocaleString() + '</div>' +
      '<div class="text-xs text-gray-400 font-mono">in ' + t.input.toLocaleString() + ' · cw ' + t.cacheCreate.toLocaleString() +
      ' · cr ' + t.cacheRead.toLocaleString() + ' · out ' + t.output.toLocaleString() + '</div></div>';
  }
  return '<div class="flex flex-wrap gap-3 mb-4">' + card('Today', today) + card('All time', overall) + '</div>';
}

function emptyState(message) {
  return '<p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">' + esc(message) + '</p>';
}

function isFilterInputFocused() {
  return document.activeElement && FILTER_IDS.includes(document.activeElement.id);
}

async function renderSessions(isPolling) {
  if (isPolling && isFilterInputFocused()) return;
  setSessionInUrl(null);
  const scrollY = window.scrollY;
  if (!isPolling) content.innerHTML = SPINNER;

  const q = document.getElementById('q')?.value || '';
  const from = document.getElementById('from')?.value || '';
  const to = document.getElementById('to')?.value || '';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const res = await fetch('/api/sessions?' + params.toString());
  const data = await res.json();

  const summary = usageSummaryBar(data.overall, data.today);
  const filters = filtersBar(q, from, to);

  if (!data.sessions || data.sessions.length === 0) {
    content.innerHTML = summary + filters + emptyState(data.message || 'No sessions found.');
    wireFilters();
    return;
  }

  const rows = data.sessions.map((s) => {
    const t = s.totals;
    return '<tr class="cursor-pointer hover:bg-blue-50/60 transition-colors" data-session="' + esc(s.session) + '">' +
      '<td class="px-4 py-2 text-left">' +
      '<div class="font-medium text-gray-800">' + esc(s.title || '(untitled session)') + '</div>' +
      '<div class="text-xs text-gray-400 font-mono">' + esc(s.session) + '</div></td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-600">' + s.requestCount + '</td>' +
      '<td class="px-4 py-2 text-right font-mono font-semibold text-blue-700">' + t.grandTotal + '</td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-500">' + t.input + '</td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-500">' + t.cacheCreate + '</td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-500">' + t.cacheRead + '</td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-500">' + t.output + '</td>' +
      '<td class="px-4 py-2 text-right font-mono text-gray-400 text-xs whitespace-nowrap">' + (s.startTime || '') + '</td></tr>';
  }).join('');

  content.innerHTML = summary + filters +
    '<div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">' +
    '<table class="w-full text-sm">' +
    '<thead class="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">' +
    '<tr><th class="px-4 py-2 text-left">session</th><th class="px-4 py-2 text-right">requests</th>' +
    '<th class="px-4 py-2 text-right">total</th><th class="px-4 py-2 text-right">input</th>' +
    '<th class="px-4 py-2 text-right">cache_create</th><th class="px-4 py-2 text-right">cache_read</th>' +
    '<th class="px-4 py-2 text-right">output</th><th class="px-4 py-2 text-right">started</th></tr></thead>' +
    '<tbody class="divide-y divide-gray-100">' + rows + '</tbody></table></div>' +
    '<p class="text-gray-500 text-xs mt-3">' + data.sessions.length + ' session(s) — refreshes every 5s</p>';

  document.querySelectorAll('tr[data-session]').forEach((tr) => {
    tr.addEventListener('click', () => renderSessionDetail(tr.dataset.session));
  });
  wireFilters();
  if (isPolling) window.scrollTo(0, scrollY);
}

function wireFilters() {
  FILTER_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => renderSessions(false));
  });
}

function blockText(block) {
  if (!block) return '';
  if (block.type === 'text') return block.text || '';
  if (block.type === 'tool_use') return 'Tool call: ' + block.name + '(' + JSON.stringify(block.input) + ')';
  return '';
}

function contentToText(contentArr) {
  if (!Array.isArray(contentArr)) return '';
  return contentArr.map(blockText).filter(Boolean).join('\\n\\n');
}

function toolResultToText(toolResultArr) {
  if (!Array.isArray(toolResultArr)) return '';
  return toolResultArr.filter((b) => b && b.type === 'tool_result').map((b) => {
    const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
    return (b.is_error ? '[error] ' : '') + text;
  }).filter(Boolean).join('\\n\\n');
}

function captureOpenState() {
  const details = Array.from(content.querySelectorAll('details'));
  const openIdx = new Set();
  details.forEach((d, i) => { if (d.open) openIdx.add(i); });
  const visibleDetailIds = new Set(
    Array.from(content.querySelectorAll('tr[id^="detail-"]'))
      .filter((tr) => !tr.classList.contains('hidden'))
      .map((tr) => tr.id)
  );
  return { openIdx, visibleDetailIds };
}

function restoreOpenState(state) {
  const details = Array.from(content.querySelectorAll('details'));
  state.openIdx.forEach((i) => { if (details[i]) details[i].open = true; });
  state.visibleDetailIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });
}

async function renderSessionDetail(sessionId, isPolling) {
  setSessionInUrl(sessionId);
  const scrollY = window.scrollY;
  const priorState = isPolling ? captureOpenState() : null;
  if (!isPolling) content.innerHTML = SPINNER;

  const res = await fetch('/api/session/' + encodeURIComponent(sessionId));
  const data = await res.json();

  const crumb = '<button id="back" class="text-blue-600 hover:underline text-sm mb-3 inline-flex items-center gap-1">&larr; all sessions</button>';
  const heading = '<h2 class="text-lg font-semibold mb-3">' + esc(data.title || sessionId) + '</h2>';

  if (!data.requests || data.requests.length === 0) {
    content.innerHTML = crumb + heading + emptyState(data.message || 'No requests with usage data found.');
    document.getElementById('back').addEventListener('click', () => renderSessions(false));
    return;
  }

  const reqHtml = data.requests.map((r, i) => {
    const turnsHtml = r.turns.map((t, j) => {
      const detailId = 'detail-' + i + '-' + j;
      const requestText = j === 0 ? r.text : toolResultToText(r.turns[j - 1].toolResult);
      const responseText = contentToText(t.content);
      return '<tr><td class="px-3 py-1.5 text-left">turn ' + (j + 1) + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono">' + t.total + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono text-gray-500">' + t.input + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono text-gray-500">' + t.cacheCreate + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono text-gray-500">' + t.cacheRead + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono text-gray-500">' + t.output + '</td>' +
        '<td class="px-3 py-1.5 text-right font-mono text-gray-400 text-xs whitespace-nowrap">' + (t.timestamp || '') + '</td>' +
        '<td class="px-3 py-1.5 text-right"><a href="#" class="detail-toggle text-blue-600 hover:underline" data-target="' + detailId + '">view request/response</a></td></tr>' +
        '<tr id="' + detailId + '" class="hidden"><td colspan="8" class="p-0">' +
        '<div class="px-3 py-2 text-xs text-gray-500 font-semibold uppercase bg-gray-50 border-t border-gray-100">Request</div>' +
        '<div class="px-3 pb-2 text-sm text-gray-700 whitespace-pre-wrap bg-gray-50">' + esc(requestText || '(none)') + '</div>' +
        '<div class="px-3 py-2 text-xs text-gray-500 font-semibold uppercase bg-gray-50 border-t border-gray-100">Response</div>' +
        '<div class="px-3 pb-3 text-sm text-gray-700 whitespace-pre-wrap bg-gray-50">' + esc(responseText || '(no response text)') + '</div>' +
        '</td></tr>';
    }).join('');

    return '<details class="bg-white border border-gray-200 rounded-lg mb-2 open:shadow-sm">' +
      '<summary class="cursor-pointer px-4 py-3 flex items-center justify-between gap-3 select-none">' +
      '<span class="text-sm text-gray-800 truncate">#' + (i + 1) + ' — ' + esc(r.text.slice(0, 120)) +
      (r.text.length > 120 ? '…' : '') + '</span>' +
      '<span class="text-xs text-gray-400 font-mono whitespace-nowrap">' + r.total + ' tok · ' + r.turns.length + ' turn(s)</span>' +
      '</summary>' +
      '<div class="px-4 pb-4">' +
      '<div class="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded p-3 mb-3">' + esc(r.text) + '</div>' +
      '<div class="overflow-x-auto rounded border border-gray-200">' +
      '<table class="w-full text-xs">' +
      '<thead class="bg-gray-50 text-gray-500 uppercase"><tr>' +
      '<th class="px-3 py-1.5 text-left">turn</th><th class="px-3 py-1.5 text-right">total</th>' +
      '<th class="px-3 py-1.5 text-right">input</th><th class="px-3 py-1.5 text-right">cache_create</th>' +
      '<th class="px-3 py-1.5 text-right">cache_read</th><th class="px-3 py-1.5 text-right">output</th>' +
      '<th class="px-3 py-1.5 text-right">timestamp</th><th></th></tr></thead>' +
      '<tbody class="divide-y divide-gray-100">' + turnsHtml + '</tbody></table></div>' +
      '</div></details>';
  }).join('');

  content.innerHTML = crumb + heading + reqHtml;
  document.getElementById('back').addEventListener('click', () => renderSessions(false));
  document.querySelectorAll('.detail-toggle').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.target).classList.toggle('hidden');
    });
  });
  if (priorState) restoreOpenState(priorState);
  if (isPolling) window.scrollTo(0, scrollY);
}

function load(isPolling) {
  const sessionId = getSessionFromUrl();
  if (sessionId) renderSessionDetail(sessionId, isPolling);
  else renderSessions(isPolling);
}

load(false);
setInterval(() => load(true), 5000);
</script>
</body>
</html>`;

function getProjectDir() {
  return join(homedir(), '.claude', 'projects', projectSlug(process.cwd()));
}

function sumSessionTotals(sessions) {
  const totals = { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 };
  for (const s of sessions) {
    totals.input += s.totals.input;
    totals.cacheCreate += s.totals.cacheCreate;
    totals.cacheRead += s.totals.cacheRead;
    totals.output += s.totals.output;
  }
  totals.grandTotal = totals.input + totals.cacheCreate + totals.cacheRead + totals.output;
  return totals;
}

function filterToToday(sessions) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  return sessions.filter((s) => s.startTime && s.endTime && s.startTime <= endOfDay && s.endTime >= startOfDay);
}

function getSessionsData({ q, from, to }) {
  const projectDir = getProjectDir();
  const files = findSessionFiles(projectDir, { all: true, sessionId: undefined });

  const emptyTotals = sumSessionTotals([]);
  if (files.length === 0) {
    return { sessions: [], overall: emptyTotals, today: emptyTotals, message: `No session transcripts found under ${projectDir}` };
  }

  const allSessions = loadSessionsSummary(projectDir, files);
  if (allSessions.length === 0) {
    return { sessions: [], overall: emptyTotals, today: emptyTotals, message: 'No requests with usage data found.' };
  }

  const overall = sumSessionTotals(allSessions);
  const today = sumSessionTotals(filterToToday(allSessions));

  let sessions = allSessions;
  if (q) {
    const needle = q.toLowerCase();
    sessions = sessions.filter((s) => {
      if ((s.title || '').toLowerCase().includes(needle)) return true;
      const { requests } = buildSessionRequests(projectDir, `${s.session}.jsonl`);
      return requests.some((r) => r.text.toLowerCase().includes(needle));
    });
  }
  if (from) sessions = sessions.filter((s) => !s.endTime || s.endTime >= from);
  if (to) sessions = sessions.filter((s) => !s.startTime || s.startTime <= to + 'T23:59:59.999Z');

  if (sessions.length === 0) {
    return { sessions: [], overall, today, message: 'No sessions match the current filters.' };
  }

  sessions.sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''));
  return { sessions, overall, today };
}

function getSessionDetail(sessionId) {
  const projectDir = getProjectDir();
  const file = `${sessionId}.jsonl`;
  const files = findSessionFiles(projectDir, { all: false, sessionId });

  if (files.length === 0) {
    return { title: sessionId, requests: [], message: `Session ${sessionId} not found.` };
  }

  const { title, requests } = buildSessionRequests(projectDir, file);
  if (requests.length === 0) {
    return { title, requests: [], message: 'No requests with usage data found.' };
  }
  return { title, requests };
}

function main() {
  const args = process.argv.slice(2);
  const portArgIdx = args.indexOf('--port');
  const port = Number(portArgIdx !== -1 ? args[portArgIdx + 1] : process.env.PORT || 4500);

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/api/sessions') {
      const data = getSessionsData({
        q: url.searchParams.get('q') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (url.pathname.startsWith('/api/session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/api/session/'.length));
      const data = getSessionDetail(sessionId);
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
