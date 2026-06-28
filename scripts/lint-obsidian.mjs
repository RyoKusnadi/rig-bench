#!/usr/bin/env node
// Lints an external Obsidian vault for structural health — the "Lint" loop
// operation in Karpathy's LLM-wiki pattern (specs/0004-obsidian-vault-lint.md):
// deterministic, regex/mtime-only checks (no LLM judgment), the vault-side
// analogue of scripts/prune-memory.mjs for the harness's own memory store.
//
// Three finding types:
//   - Broken wikilinks  — [[wiki/slug]] or [[slug]] pointing at a page that
//     doesn't exist. The only finding that fails the run (exit 1):
//     deterministic breakage is a hard gate, per the Karpathy gist's point
//     that regex-detectable checks cost nothing compared to LLM passes.
//   - Orphan pages      — a wiki page with zero inbound [[...]] references
//     from index.md or any other wiki page. Reported, doesn't fail the run.
//   - Stale pages       — a wiki page whose most recent "## Update {date}"
//     section (or file mtime, if it has none) is older than --stale-days
//     (default 90). Reported, doesn't fail the run.
//
// Usage: node scripts/lint-obsidian.mjs [--stale-days N]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIKILINK_RE = /\[\[(?:wiki\/)?([^\]|#]+?)(?:\|[^\]]*)?\]\]/g;

/** Extract `{ slug, line }` for every [[...]] reference in `text`, accepting both [[wiki/slug]] and [[slug]] forms. */
export function extractWikilinks(text) {
  const links = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    let m;
    const re = new RegExp(WIKILINK_RE);
    while ((m = re.exec(line)) !== null) {
      links.push({ slug: m[1].trim(), line: idx + 1 });
    }
  });
  return links;
}

/** The ISO date of the most recent "## Update {date}" section, or null if the page has none. */
export function latestUpdateDate(text) {
  const matches = [...text.matchAll(/^## Update (\S+)/gm)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

function listWikiSlugs(vaultPath) {
  const wikiDir = join(vaultPath, 'wiki');
  if (!existsSync(wikiDir)) return [];
  return readdirSync(wikiDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3));
}

function readWikiPage(vaultPath, slug) {
  return readFileSync(join(vaultPath, 'wiki', `${slug}.md`), 'utf8');
}

/** Pure core: given the vault's slugs + per-source file contents, compute all three finding categories. */
export function lintVault({ slugs, sources, staleDays }) {
  const slugSet = new Set(slugs);
  const brokenLinks = [];
  const inbound = new Map(slugs.map((s) => [s, 0]));

  for (const { file, content } of sources) {
    for (const { slug, line } of extractWikilinks(content)) {
      if (!slugSet.has(slug)) {
        brokenLinks.push({ file, line, slug });
        continue;
      }
      if (file !== `wiki/${slug}.md`) {
        inbound.set(slug, (inbound.get(slug) || 0) + 1);
      }
    }
  }

  const orphanPages = slugs.filter((s) => (inbound.get(s) || 0) === 0);

  const now = Date.now();
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const stalePages = [];
  for (const { file, content, mtimeMs } of sources) {
    if (!file.startsWith('wiki/')) continue;
    const slug = file.slice('wiki/'.length, -3);
    const updateDate = latestUpdateDate(content);
    const referenceMs = updateDate ? Date.parse(updateDate) : mtimeMs;
    if (Number.isFinite(referenceMs) && now - referenceMs > staleMs) {
      stalePages.push({ slug, lastUpdated: updateDate || new Date(mtimeMs).toISOString() });
    }
  }

  return { brokenLinks, orphanPages, stalePages };
}

function formatReport({ brokenLinks, orphanPages, stalePages }) {
  if (brokenLinks.length === 0 && orphanPages.length === 0 && stalePages.length === 0) {
    return 'vault is clean — no broken links, orphan pages, or stale pages found.';
  }
  const sections = [];
  if (brokenLinks.length > 0) {
    sections.push(
      'Broken Links:\n' +
        brokenLinks.map((b) => `  - ${b.file}:${b.line} → [[${b.slug}]] (no such page)`).join('\n')
    );
  }
  if (orphanPages.length > 0) {
    sections.push('Orphan Pages:\n' + orphanPages.map((s) => `  - wiki/${s}.md (no inbound links)`).join('\n'));
  }
  if (stalePages.length > 0) {
    sections.push(
      'Stale Pages:\n' +
        stalePages.map((p) => `  - wiki/${p.slug}.md (last updated ${p.lastUpdated})`).join('\n')
    );
  }
  return sections.join('\n\n');
}

function main() {
  const vaultPath = process.env.RIGBENCH_OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    console.error('RIGBENCH_OBSIDIAN_VAULT_PATH is not set — nothing to lint.');
    process.exit(1);
  }

  const staleDaysFlagIdx = process.argv.indexOf('--stale-days');
  const staleDays = staleDaysFlagIdx !== -1 ? parseInt(process.argv[staleDaysFlagIdx + 1], 10) : 90;

  const slugs = listWikiSlugs(vaultPath);
  const sources = slugs.map((slug) => {
    const path = join(vaultPath, 'wiki', `${slug}.md`);
    return { file: `wiki/${slug}.md`, content: readWikiPage(vaultPath, slug), mtimeMs: statSync(path).mtimeMs };
  });

  const indexPath = join(vaultPath, 'index.md');
  if (existsSync(indexPath)) {
    sources.push({ file: 'index.md', content: readFileSync(indexPath, 'utf8'), mtimeMs: statSync(indexPath).mtimeMs });
  }

  const findings = lintVault({ slugs, sources, staleDays });
  console.log(formatReport(findings));

  process.exit(findings.brokenLinks.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
