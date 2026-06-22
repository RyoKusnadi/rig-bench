#!/usr/bin/env node
// Syncs one completed /research run into an external Obsidian vault,
// following Karpathy's "LLM wiki" pattern (raw sources stay immutable;
// compiled knowledge lives in a structured, cross-linked wiki/ directory
// with an index.md catalog and a log.md append-only history) as
// concretely shaped by ar9av/obsidian-wiki (specs/0002).
//
// The vault is the user's actual Obsidian vault, external to this repo —
// resolved from RIGBENCH_OBSIDIAN_VAULT_PATH (matches the existing
// RIGBENCH_* env var convention; see hooks/pre-bash-safety.mjs,
// hooks/read-budget.mjs). If unset, this script is a silent no-op so
// research/{topic}/TITLE.MD writing keeps working for anyone who hasn't
// configured a vault.
//
// Usage: node scripts/sync-obsidian.mjs <topic-slug> <generated-at-iso> <outcome> [titleMdPath] [intakeJsonPath]
//   topic-slug       same slug used for research/{topic-slug}/
//   generated-at-iso ISO 8601 timestamp — must match whatever the caller
//                     already wrote into TITLE.MD's frontmatter, so the
//                     vault page and TITLE.MD never show two different
//                     "generated at" times for one run.
//   outcome           COMPLETE | INCOMPLETE | FAILED | BLOCKED
//   titleMdPath        path to the written TITLE.MD (omit if report was
//                      null — log.md still gets an entry, no wiki page).
//   intakeJsonPath     path to intake.json (omit to skip the raw/ copy).

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTCOMES = new Set(['COMPLETE', 'INCOMPLETE', 'FAILED', 'BLOCKED']);

/** Split a TITLE.MD-style file into its YAML frontmatter block and markdown body. */
export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatterText: '', body: text };
  return { frontmatterText: m[1], body: m[2] };
}

/** Read one scalar or flow-array (`[a, b]`) field out of a frontmatter block — same minimal-YAML convention as scripts/ask-questionnaire.mjs's parseTemplateYaml. */
export function parseFrontmatterField(frontmatterText, key) {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const m = frontmatterText.match(re);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (raw.startsWith('[')) {
    const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  }
  return raw.replace(/^"(.*)"$/, '$1');
}

function formatFrontmatterValue(v) {
  if (Array.isArray(v)) return `[${v.map((s) => `"${s}"`).join(', ')}]`;
  return String(v);
}

/** Build the full wiki/{slug}.md content: a fresh frontmatter+body page on first sync, or the existing page with a new "## Update" section appended on re-runs. */
export function buildWikiPage({ existingContent, generatedAt, frontmatterFields, body }) {
  const trimmedBody = body.trim();
  if (!existingContent) {
    const fmLines = Object.entries(frontmatterFields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${formatFrontmatterValue(v)}`)
      .join('\n');
    return `---\n${fmLines}\n---\n\n${trimmedBody}\n`;
  }
  return `${existingContent.trimEnd()}\n\n## Update ${generatedAt}\n\n${trimmedBody}\n`;
}

/** Add or update (by topic slug) one line in index.md's catalog, returning the new full file content. */
export function upsertIndexLine({ existingContent, topicSlug, topic }) {
  const line = `- [[wiki/${topicSlug}]] — ${topic || topicSlug}`;
  const header = '# Research Index\n';
  const base = existingContent && existingContent.trim() !== '' ? existingContent : header;
  const lines = base.split('\n');
  const marker = `- [[wiki/${topicSlug}]]`;
  const idx = lines.findIndex((l) => l.startsWith(marker));
  if (idx !== -1) {
    lines[idx] = line;
    return lines.join('\n');
  }
  return `${base.trimEnd()}\n${line}\n`;
}

function bootstrapVault(vaultPath) {
  mkdirSync(join(vaultPath, 'wiki'), { recursive: true });
  mkdirSync(join(vaultPath, 'raw'), { recursive: true });
  const indexPath = join(vaultPath, 'index.md');
  if (!existsSync(indexPath)) writeFileSync(indexPath, '# Research Index\n');
  const logPath = join(vaultPath, 'log.md');
  if (!existsSync(logPath)) writeFileSync(logPath, '# Research Log\n');
}

function main() {
  const vaultPath = process.env.RIGBENCH_OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    console.log('RIGBENCH_OBSIDIAN_VAULT_PATH is not set — skipping Obsidian vault sync.');
    return;
  }

  const [topicSlug, generatedAt, outcome, titleMdPath, intakeJsonPath] = process.argv.slice(2);

  if (!topicSlug || !generatedAt || !outcome) {
    console.error('Usage: node scripts/sync-obsidian.mjs <topic-slug> <generated-at-iso> <outcome> [titleMdPath] [intakeJsonPath]');
    process.exit(1);
  }
  if (!OUTCOMES.has(outcome)) {
    console.error(`Unknown outcome "${outcome}" — expected one of: ${[...OUTCOMES].join(', ')}`);
    process.exit(1);
  }

  bootstrapVault(vaultPath);

  const logPath = join(vaultPath, 'log.md');
  appendFileSync(logPath, `- ${generatedAt} | ${topicSlug} | ${outcome}\n`);

  if (titleMdPath) {
    if (!existsSync(titleMdPath)) {
      console.error(`titleMdPath does not exist: ${titleMdPath}`);
      process.exit(1);
    }
    const { frontmatterText, body } = splitFrontmatter(readFileSync(titleMdPath, 'utf8'));
    const topic = parseFrontmatterField(frontmatterText, 'topic') || topicSlug;
    const frontmatterFields = {
      topic,
      target_outcome: parseFrontmatterField(frontmatterText, 'target_outcome'),
      confidence_level: parseFrontmatterField(frontmatterText, 'confidence_level'),
      validated_sources: parseFrontmatterField(frontmatterText, 'validated_sources') || [],
      generated_at: generatedAt,
    };

    const wikiPagePath = join(vaultPath, 'wiki', `${topicSlug}.md`);
    const existingContent = existsSync(wikiPagePath) ? readFileSync(wikiPagePath, 'utf8') : null;
    const newContent = buildWikiPage({ existingContent, generatedAt, frontmatterFields, body });
    writeFileSync(wikiPagePath, newContent);

    const indexPath = join(vaultPath, 'index.md');
    const newIndex = upsertIndexLine({ existingContent: readFileSync(indexPath, 'utf8'), topicSlug, topic });
    writeFileSync(indexPath, newIndex);

    console.log(`Synced wiki/${topicSlug}.md and updated index.md in ${vaultPath}`);
  } else {
    console.log(`No report for "${topicSlug}" (outcome ${outcome}) — logged the run, skipped the wiki page.`);
  }

  if (intakeJsonPath) {
    if (!existsSync(intakeJsonPath)) {
      console.error(`intakeJsonPath does not exist: ${intakeJsonPath}`);
      process.exit(1);
    }
    const rawPath = join(vaultPath, 'raw', `${topicSlug}-intake.json`);
    writeFileSync(rawPath, readFileSync(intakeJsonPath, 'utf8'));
  }
}

// Guard so this file can be imported (e.g. to unit-test the pure functions
// above) without running main()'s file I/O as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
