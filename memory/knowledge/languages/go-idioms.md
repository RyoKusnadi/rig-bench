# Go Idioms

Conventions for Go code in this harness. Used by developer, code-reviewer, and refactorer.

---

## Error handling

```go
// ✅ Wrap with context
if err := cache.Init(); err != nil {
    return fmt.Errorf("cache init: %w", err)
}

// ❌ Swallow silently
cache.Init()

// ❌ Bare return
if err != nil {
    return err  // loses context
}
```

Use `errors.Is` / `errors.As` to check wrapped errors. Use `%w` in `fmt.Errorf`, never `%s` for errors.

---

## Nil checks

```go
// ✅ Two-value map lookup
v, ok := m[key]
if !ok {
    return "", false
}

// ❌ Direct access (panics if m is nil or key missing)
return m[key], m[key] != ""

// ✅ Guard before using a pointer
if c.store == nil {
    return "", false
}
```

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Package | lowercase, one word | `cache`, `handler`, `reliability` |
| Interface | noun or -er suffix | `Store`, `RateLimiter`, `Scorer` |
| Exported function | PascalCase | `GetTenantConfig` |
| Unexported function | camelCase | `buildPrompt` |
| Error variable | `ErrXxx` | `ErrCacheMiss`, `ErrBudgetExceeded` |
| Test | `TestFuncName_Condition_Result` | `TestCache_Get_ReturnsFalseWhenNil` |
| Constant | PascalCase (exported) or camelCase | `DefaultTokenBudget`, `maxRetries` |

---

## Testing

```go
// Table-driven tests — preferred for multiple cases
func TestConfidenceScorer_Score(t *testing.T) {
    tests := []struct {
        name     string
        input    string
        expected float64
    }{
        {"empty response", "", 0.0},
        {"low confidence", "I think maybe...", 0.3},
        {"high confidence", "The answer is X", 0.9},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Score(tt.input)
            assert.InDelta(t, tt.expected, got, 0.1)
        })
    }
}

// Always run with race detector in CI
// go test -race ./...
```

---

## Concurrency

```go
// ✅ sync.RWMutex for read-heavy maps
type Cache struct {
    mu    sync.RWMutex
    store map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.store[key]
    return v, ok
}

// ❌ Bare map access from multiple goroutines (data race)
```

---

## Package structure (tier1-support-ai pattern)

```
cmd/server/main.go          ← entry point, wires dependencies
internal/
    handler/                ← HTTP handlers (thin — delegate to services)
    reliability/            ← rate limiter, cache, budget guard
    llm/                    ← OpenAI client, retry, confidence scorer
    config/                 ← config structs, env loading
```

- `cmd/` — binaries only; no business logic
- `internal/` — not importable by other modules (enforced by Go toolchain)
- No `utils/` or `helpers/` packages — name by what the code does

---

## Common commands

```bash
gofmt -w .          # format (mandatory before commit)
go vet ./...        # static analysis (always)
go test -race ./... # tests with race detector
golangci-lint run   # comprehensive lint (if installed)
staticcheck ./...   # alternative static analysis
govulncheck ./...   # vulnerability check (if installed)
```
