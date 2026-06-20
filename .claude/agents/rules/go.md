---
title: Go linting and static analysis rules
---

## Overview

The `operator` and `inspector` agents use **golangci-lint** (preferred), **staticcheck**, and **go vet** to analyze Go source files. `golint` is **deprecated** and must not be used — it was archived in 2022 and is no longer maintained.

---

### Tool priority

| Tool | Status | Purpose |
|------|--------|---------|
| `golangci-lint` | Preferred | Runs 50+ linters including `staticcheck`, `govet`, `errcheck`, `gosec` |
| `staticcheck` | Fallback | Best standalone static analyzer for Go |
| `go vet` | Always run | Detects potential bugs (always available) |
| `golint` | **Do not use** | Deprecated/archived |

---

### 1. golangci-lint invocation
```bash
golangci-lint run --out-format json ./... 2>&1
# or for specific files (golangci-lint works on packages, not single files):
golangci-lint run --out-format json $(dirname <file>) 2>&1
```

Key linters enabled by default (no config needed):
- `govet` — potential bugs (shadows, printf mismatches)
- `errcheck` — unchecked errors
- `staticcheck` — advanced static analysis
- `gosimple` — simplification opportunities
- `unused` — unused code
- `gosec` — security checks (SQL injection, hardcoded secrets, weak crypto)

---

### 2. staticcheck invocation (fallback if golangci-lint absent)
```bash
staticcheck ./... 2>&1
```
Output format: `path/to/file.go:line:col: message (SA-code)`.

---

### 3. go vet invocation (always run — ships with Go toolchain)
```bash
go vet ./... 2>&1
```
Output: `path/to/file.go:line: message`.

---

### 4. Severity mapping

| Source | Severity | Rationale |
|--------|----------|-----------|
| `go vet` | `error` | Catches real bugs (misused printf, unreachable code, mutex copy) |
| `golangci-lint` `gosec` findings | `error` | Security issues |
| `golangci-lint` `errcheck` / `staticcheck` | `warning` | Correctness risks |
| `golangci-lint` style/simplification | `info` | Non-blocking |

---

### 5. Unified finding shape
```json
{
  "file":     "path/to/file.go",
  "line":     42,
  "severity": "error | warning | info",
  "message":  "<description>",
  "tool":     "go vet | staticcheck | golangci-lint"
}
```

---

### 6. Fallback config (no golangci-lint installed)

Generate a minimal `.golangci.yml` on-the-fly in a temp dir:
```yaml
linters:
  enable:
    - govet
    - errcheck
    - staticcheck
    - gosimple
    - unused
linters-settings:
  govet:
    enable-all: true
```

---

### 7. Safety & performance
- Run `go vet` and `staticcheck`/`golangci-lint` in parallel when multiple packages are affected.
- Restrict analysis to packages containing the changed files — do not scan the entire module unless explicitly asked.
