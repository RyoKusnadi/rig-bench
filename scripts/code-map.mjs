#!/usr/bin/env node
// Tier 1 of the Code Checkpoint Architecture (todo.md "The Structural
// Checkpoint"). Walks hooks/, lib/, scripts/, workflows/, and subagents/ and
// extracts a deterministic topology map — imports/exports for plain ESM
// files, meta.name/description for workflows, frontmatter for agents — so a
// new session can see module boundaries without Grep/Read discovery.
//
// Deliberately regex-based, not an AST parser: todo.md calls for "regex/
// simple parsing", and this repo has no build step or TS compiler to lean on
// (see CLAUDE.md "Hooks/lib/scripts are plain ESM .mjs, no build step"). A
// missed edge case here just means an incomplete map, not a wrong one — the
// agent still has Read/Grep as a fallback for anything this script misses.
//
// Usage: node scripts/code-map.mjs   (or `npm run code:map`)
// Output: .claude/session-state/structural-checkpoint.json

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const MODULE_DIRS = ['hooks', 'lib', 'scripts'];
const WORKFLOW_DIR = 'workflows';
const AGENT_DIR = 'subagents';

function walk(dir, matches) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, matches));
    else if (matches(entry)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /^import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+(\w+)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;
const EXPORT_DEFAULT_RE = /^export\s+default\b/m;

function scanModule(file) {
  const text = readFileSync(file, 'utf8');
  const imports = new Set();
  for (const m of text.matchAll(IMPORT_RE)) imports.add(m[1]);
  for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) imports.add(m[1]);

  const exports = new Set();
  for (const m of text.matchAll(EXPORT_DECL_RE)) exports.add(m[1]);
  for (const m of text.matchAll(EXPORT_LIST_RE)) {
    for (const name of m[1].split(',')) {
      const trimmed = name.trim().split(/\s+as\s+/).pop().trim();
      if (trimmed) exports.add(trimmed);
    }
  }
  if (EXPORT_DEFAULT_RE.test(text)) exports.add('default');

  return { imports: [...imports].sort(), exports: [...exports].sort() };
}

const WORKFLOW_META_RE = /export\s+const\s+meta\s*=\s*\{[^]*?name:\s*['"]([^'"]+)['"][^]*?description:\s*['"]([^'"]+)['"]/;

function scanWorkflow(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(WORKFLOW_META_RE);
  return { name: m ? m[1] : null, description: m ? m[2] : null };
}

const FRONTMATTER_RE = /^---\n([^]*?)\n---/;

// Agent frontmatter `description` is a YAML block scalar (`description: |`)
// spanning many indented lines (the full prompt-routing blurb, examples
// included) — a plain `key: value` regex only captures the `|` marker. Pull
// the first indented line after it instead, as a short summary.
function scanAgent(file) {
  const text = readFileSync(file, 'utf8');
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return {};
  const body = fm[1];
  const field = (key) => (body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [, null])[1];

  const name = field('name');
  const model_tier = field('model_tier');

  let description = field('description');
  if (description === '|' || description === '>') {
    const blockMatch = body.match(/^description:\s*[|>]\n( +)(.+)$/m);
    description = blockMatch ? blockMatch[2].trim() : null;
  }

  return { name, description, model_tier };
}

function main() {
  const modules = [];
  for (const dir of MODULE_DIRS) {
    const files = walk(join(root, dir), (name) => extname(name) === '.mjs' || extname(name) === '.js');
    for (const file of files) {
      const { imports, exports } = scanModule(file);
      modules.push({ path: relative(root, file), imports, exports });
    }
  }

  const workflows = [];
  for (const file of walk(join(root, WORKFLOW_DIR), (name) => extname(name) === '.js')) {
    const { name, description } = scanWorkflow(file);
    workflows.push({ path: relative(root, file), name, description });
  }

  const agents = [];
  for (const file of walk(join(root, AGENT_DIR), (name) => extname(name) === '.md')) {
    const meta = scanAgent(file);
    if (meta.name) agents.push({ path: relative(root, file), ...meta });
  }

  const checkpoint = {
    generated_at: new Date().toISOString(),
    modules,
    workflows,
    agents,
  };

  const stateDir = join(root, '.claude', 'session-state');
  mkdirSync(stateDir, { recursive: true });
  const outPath = join(stateDir, 'structural-checkpoint.json');
  writeFileSync(outPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  console.log(`Wrote structural checkpoint (${modules.length} modules, ${workflows.length} workflows, ${agents.length} agents) to ${outPath}`);
}

main();
