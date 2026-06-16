# Test Patterns

Reference for test-writer and code-reviewer. AAA pattern, test pyramid, naming, coverage targets.

---

## AAA Pattern

Every test: **Arrange → Act → Assert**

```go
// Go example
func TestCache_Get_ReturnsFalseWhenUninitialized(t *testing.T) {
    // Arrange
    c := &Cache{} // intentionally not calling Init()

    // Act
    _, ok := c.Get("key")

    // Assert
    assert.False(t, ok)
}
```

```typescript
// TypeScript / Jest
it('should return false when cache is uninitialized', () => {
    // Arrange
    const cache = new Cache() // no init

    // Act
    const result = cache.get('key')

    // Assert
    expect(result.found).toBe(false)
})
```

**One logical assertion per test.** Multiple `expect`/`assert` calls are fine when they all verify the same logical outcome. Never test two independent behaviors in one test.

---

## Test pyramid

| Layer | What to test | Coverage target | Tools |
|---|---|---|---|
| Unit | Pure functions, business logic, individual methods | **95%** | go test, jest, pytest |
| Integration | HTTP handlers, DB queries, cache interactions | **85%** | go test + httptest, supertest |
| Infrastructure | External APIs, filesystem, real DB | **80%** | go test + testcontainers, real DB in CI |

---

## Naming conventions

### Go
```go
func TestFunctionName_Condition_ExpectedBehavior(t *testing.T)

// Examples:
func TestCache_Get_ReturnsFalseWhenUninitialized(t *testing.T)
func TestRateLimiter_Allow_BlocksAfterBurst(t *testing.T)
func TestConfidenceScorer_Score_ReturnsZeroOnEmptyResponse(t *testing.T)
```

### TypeScript / Jest
```typescript
describe('Cache', () => {
    describe('get', () => {
        it('returns false when uninitialized')
        it('returns the stored value after set')
        it('returns false after TTL expires')
    })
})
```

### Python
```python
def test_cache_get_returns_false_when_uninitialized():
def test_rate_limiter_blocks_after_burst():
def test_confidence_scorer_returns_zero_on_empty_response():
```

---

## Code path coverage checklist

Before writing tests, map every path. A test suite is only complete when every row is checked:

- [ ] Happy path — normal inputs, expected output
- [ ] Empty / zero input — empty string, 0, empty slice, null
- [ ] Boundary — N-1, N, N+1 values at any limit
- [ ] Error paths — every `if err != nil` branch, every `catch` block
- [ ] nil / null / undefined — any pointer or optional that could be nil
- [ ] Concurrency — if the code uses goroutines, locks, or shared state: `go test -race`
- [ ] Timeout / cancellation — if the code accepts a context

---

## Mocking rules

**Real over mocks.** Only mock at true boundaries:

| Mock | Don't mock |
|---|---|
| External HTTP APIs | In-memory structs |
| Database (for unit tests) | Pure functions |
| File system (for unit tests) | Synchronous business logic |
| Time (`time.Now()`) | Internal dependencies |
| Third-party SDK calls | Any code you own |

---

## TDD cycle

1. **Red** — write the test first; confirm it **fails** before implementing
2. **Green** — write the minimum code to make it pass
3. **Refactor** — clean up under green tests; run suite again

If a test passes before you implement anything — the test is wrong. Stop and fix the assertion.

---

## Regression tests

For every bug fixed, add a test that:
1. **Would have caught the bug** if it had existed before
2. Uses the exact input that triggered the bug
3. Is named after the bug: `TestCache_Get_PanicsOnNilMap_Regression`
4. Lives next to the fix, not in a separate "regression" file
