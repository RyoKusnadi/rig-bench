#!/usr/bin/env node
// Reads intake/research-questionnaire.yaml, interactively prompts for any
// field still at its placeholder/empty value, validates the result against
// config/schemas/research-intake.schema.json, and writes it to
// research/{topic-slug}/intake.json.
//
// Zero-dependency by design (same constraint as every other script/workflow
// in this repo — see package.json's description and README's "Local
// Tooling" section): no js-yaml, no inquirer. parseTemplateYaml() below
// understands exactly the shape of research-questionnaire.yaml (one level
// of nested mapping, scalars, and flow-style `[]` arrays) — it is not a
// general-purpose YAML parser and isn't meant to become one.
//
// Usage: node scripts/ask-questionnaire.mjs [--file path/to/template.yaml]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { validate } from '../lib/schema-validator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(root, 'config', 'schemas', 'research-intake.schema.json');

function parseScalar(raw) {
  const t = raw.trim();
  if (t === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^"(.*)"$/, '$1');
}

function parseFlowArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') return [];
  return inner.split(',').map((s) => parseScalar(s.trim()));
}

/** Parse the constrained subset of YAML used by research-questionnaire.yaml. */
export function parseTemplateYaml(text) {
  const lines = text.split('\n').filter((l) => !/^\s*#/.test(l) && l.trim() !== '');
  const result = {};
  let currentParent = null;

  for (const line of lines) {
    const indented = /^\s+/.test(line);
    const match = line.match(/^\s*([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const valueRaw = match[2].replace(/\s+#.*$/, '');

    if (!indented) {
      currentParent = null;
      if (valueRaw === '' || valueRaw.trim() === '') {
        result[key] = {};
        currentParent = key;
      } else if (valueRaw.trim().startsWith('[')) {
        result[key] = parseFlowArray(valueRaw);
      } else {
        result[key] = parseScalar(valueRaw);
      }
    } else if (currentParent) {
      const value = valueRaw.trim().startsWith('[') ? parseFlowArray(valueRaw) : parseScalar(valueRaw);
      result[currentParent][key] = value;
    }
  }

  return result;
}

function isUnfilled(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function slugify(topic) {
  return topic.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function promptFor(rl, label) {
  return new Promise((resolve) => {
    rl.question(`${label}: `, (answer) => resolve(answer.trim()));
  });
}

async function fillUnfilledFields(intake, rl) {
  const scalarPrompts = [
    ['topic', 'Topic'],
    ['current_baseline', 'Current baseline (what you already use/know)'],
  ];
  for (const [key, label] of scalarPrompts) {
    if (isUnfilled(intake[key])) {
      intake[key] = await promptFor(rl, label);
    }
  }

  if (isUnfilled(intake.focus_areas)) {
    const raw = await promptFor(rl, 'Focus areas (comma-separated)');
    intake.focus_areas = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  if (intake.constraints && isUnfilled(intake.constraints.tech_stack)) {
    const raw = await promptFor(rl, 'Tech stack constraints (comma-separated)');
    intake.constraints.tech_stack = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileFlagIndex = args.indexOf('--file');
  const templatePath = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : join(root, 'intake', 'research-questionnaire.yaml');

  if (!existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  const intake = parseTemplateYaml(readFileSync(templatePath, 'utf-8'));

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await fillUnfilledFields(intake, rl);
    rl.close();
  }

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  const { valid, errors } = validate(schema, intake);
  if (!valid) {
    console.error('Intake failed schema validation:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (!intake.topic) {
    console.error('No topic provided — cannot determine research/{topic}/ directory.');
    process.exit(1);
  }

  const outDir = join(root, 'research', slugify(intake.topic));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'intake.json');
  writeFileSync(outPath, JSON.stringify(intake, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();
