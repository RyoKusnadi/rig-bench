---
title: TypeScript / JavaScript linting and type-checking rules
---

## Overview

The `operator` and `inspector` agents use **tsc** (type checking), **ESLint** (lint), and **mcp__ide__getDiagnostics** (IDE LSP) to analyze TypeScript and JavaScript files. Run all three — they catch different classes of issues.

---

### Tool priority

| Tool | Purpose | Priority |
|------|---------|----------|
| `tsc --noEmit` | Type errors, missing types, incorrect assignments | Highest — catches real bugs |
| `mcp__ide__getDiagnostics` | IDE/LSP diagnostics (type + semantic) | High — catches what tsc surfaces in the editor |
| `eslint` | Style, patterns, security rules | Medium |

---

### 1. TypeScript type-checking (run first)
```bash
npx tsc --noEmit 2>&1 | head -80
```
- Uses the project's `tsconfig.json` automatically.
- If there is no `tsconfig.json`, skip tsc and note it in the findings.
- Type errors are always `error` severity — they represent real bugs.

---

### 2. IDE diagnostics via mcp__ide__getDiagnostics

Call `mcp__ide__getDiagnostics` for every changed `.ts` / `.tsx` file. This surfaces:
- Type errors the LSP displays in the editor
- Unresolved imports
- Semantic errors not always caught by CLI tsc in watch mode

Severity mapping: `error` → `error`, `warning` → `warning`, `hint`/`information` → `info`.

---

### 3. ESLint invocation
```bash
npx eslint --format json <file1> <file2> ... 2>&1
```
- If the project has an ESLint config (`.eslintrc.*`, `eslint.config.*`, `eslint` key in `package.json`), it is used automatically.
- Fallback when no config exists:
```bash
npx eslint --no-eslintrc \
  -c '{"extends":["eslint:recommended"],"env":{"es2022":true,"node":true,"browser":true},"rules":{"no-console":"warn","no-debugger":"error","no-unused-vars":"warn"}}' \
  --format json <files>
```

---

### 4. ESLint result field mapping

| ESLint field | Unified field |
|---|---|
| `filePath` | `file` |
| `messages[].line` | `line` |
| `messages[].severity` (2=error, 1=warning, 0=info) | `severity` |
| `messages[].message` | `message` |
| `messages[].fix?.text` | `suggestion` (auto-fix text) |

---

### 5. Recommended base config (generated on-the-fly when absent)
```json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "no-console": "warn",
    "no-debugger": "error",
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "no-eval": "error",
    "no-implied-eval": "error"
  }
}
```

---

### 6. Unified finding shape
```json
{
  "file":       "path/to/file.ts",
  "line":       42,
  "severity":   "error | warning | info",
  "message":    "<description>",
  "suggestion": "<auto-fix text if available>",
  "tool":       "tsc | eslint | ide-diagnostics"
}
```

---

### 7. Severity mapping summary

| Source | Condition | Severity |
|--------|-----------|----------|
| `tsc` | Any type error | `error` |
| `mcp__ide__getDiagnostics` | `error` level | `error` |
| `mcp__ide__getDiagnostics` | `warning` level | `warning` |
| `eslint` | `severity: 2` | `error` |
| `eslint` | `severity: 1` | `warning` |
| `eslint` | `severity: 0` | `info` |

---

### 8. Safety notes
- Run linters in a sandboxed subprocess — no network access required.
- Scope analysis to the files explicitly listed — do not scan the entire project.
- ESLint plugins (e.g., `@typescript-eslint`) must already be installed in the project. If missing, fall back to the no-config mode and note the limitation.
